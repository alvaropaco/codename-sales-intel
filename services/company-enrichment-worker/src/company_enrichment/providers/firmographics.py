"""Deterministic firmographics lookup from the existing CNPJ data warehouse.

Reuses `cnpj-postgres.cnpj-data.svc.cluster.local` (the `companies` table
maintained by the cnpj-data-publisher). This is a deterministic SQL lookup, not
an LLM call. If `CNPJ_DATABASE_URL` is unset, the provider is a no-op so the
worker still runs in environments without the warehouse.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

import asyncpg

from company_enrichment.config.settings import Settings
from company_enrichment.models.outputs.results import Firmographics
from company_enrichment.observability.otel import get_logger

log = get_logger("firmographics")

_SIZE_TO_PORTE = {
    "01": "ME",  # Micro empresa
    "03": "EPP",  # Empresa de pequeno porte
    "05": "DEMAIS",
    "": None,
}

_COLUMNS = (
    "cnpj",
    "legal_name",
    "trade_name",
    "registration_status",
    "opening_date",
    "legal_nature_description",
    "main_cnae",
    "main_cnae_description",
    "company_size_code",
    "share_capital",
    "simple_tax_option",
    "mei_option",
    "city_name",
    "state",
    "email",
)


def normalize_cnpj(cnpj: str | None) -> str | None:
    """Return the 14-digit CNPJ, or None when it is not 14 digits."""
    if not cnpj:
        return None
    digits = re.sub(r"\D", "", cnpj)
    return digits if len(digits) == 14 else None


class FirmographicsProvider:
    """Async lookup of a company by CNPJ in the existing cnpj warehouse."""

    def __init__(self, database_url: str | None, timeout_seconds: float = 5.0) -> None:
        self._database_url = database_url
        self._timeout_seconds = timeout_seconds
        self._pool: asyncpg.Pool | None = None

    @property
    def enabled(self) -> bool:
        return bool(self._database_url)

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            if not self._database_url:
                raise RuntimeError("CNPJ_DATABASE_URL not configured")
            self._pool = await asyncpg.create_pool(
                self._database_url,
                min_size=1,
                max_size=5,
                command_timeout=self._timeout_seconds,
            )
        return self._pool

    async def lookup(self, cnpj: str | None) -> Firmographics | None:
        """Return firmographics for the CNPJ, or None when absent/unreachable."""
        if not self.enabled:
            return None
        digits = normalize_cnpj(cnpj)
        if not digits:
            return None
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    f"SELECT {', '.join(_COLUMNS)} FROM companies WHERE cnpj = $1",
                    digits,
                )
        except Exception as exc:  # noqa: BLE001 - warehouse outage must not fail the job
            log.warning("firmographics_lookup_failed", cnpj=cnpj, error=str(exc)[:300])
            return None
        if row is None:
            return None
        return self._to_firmographics(dict(row))

    @staticmethod
    def _to_firmographics(row: dict[str, Any]) -> Firmographics:
        cnae_code = row.get("main_cnae")
        cnae_desc = row.get("main_cnae_description")
        main_cnae = (
            f"{cnae_code} - {cnae_desc}" if cnae_code and cnae_desc else (cnae_code or cnae_desc)
        )
        opening = row.get("opening_date")
        if isinstance(opening, date):
            opening = opening.isoformat()
        share_capital = row.get("share_capital")
        return Firmographics(
            legal_name=row.get("legal_name"),
            trade_name=row.get("trade_name"),
            cnpj=row.get("cnpj"),
            opening_date=str(opening) if opening else None,
            legal_nature=row.get("legal_nature_description"),
            porte=_SIZE_TO_PORTE.get(row.get("company_size_code") or ""),
            capital_social=float(share_capital) if share_capital is not None else None,
            main_cnae=main_cnae,
            cnae_secondary=[],
            city=row.get("city_name"),
            state=row.get("state"),
            email=row.get("email"),
            status=row.get("registration_status"),
        )

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None


class QsaProvider:
    """Deterministic QSA (quadro societário) lookup from the CNPJ warehouse.

    The warehouse schema for QSA/partners is not yet confirmed, so this provider
    is **disabled by default** (`CNPJ_QSA_TABLE` unset). When the table name is
    confirmed in `cnpj-postgres`, set `CNPJ_QSA_TABLE` and it becomes active. It
    returns `[{"name", "role", "share", "document"}]` rows; absence is a no-op
    (the `registry` capability still surfaces people from `hints["qsa"]`).
    """

    def __init__(
        self,
        database_url: str | None,
        table: str | None = None,
        timeout_seconds: float = 5.0,
    ) -> None:
        self._database_url = database_url
        self._table = table
        self._timeout_seconds = timeout_seconds
        self._pool: asyncpg.Pool | None = None

    @property
    def enabled(self) -> bool:
        return bool(self._database_url and self._table)

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            if not self._database_url:
                raise RuntimeError("CNPJ_DATABASE_URL not configured")
            self._pool = await asyncpg.create_pool(
                self._database_url,
                min_size=1,
                max_size=3,
                command_timeout=self._timeout_seconds,
            )
        return self._pool

    async def lookup(self, cnpj: str | None) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        digits = normalize_cnpj(cnpj)
        if not digits:
            return []
        # Column names are conventional; the table name is the configurable part.
        query = (
            f'SELECT partner_name, partner_role, share, partner_document '
            f'FROM "{self._table}" WHERE cnpj = $1'
        )
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                rows = await conn.fetch(query, digits)
        except Exception as exc:  # noqa: BLE001 - warehouse outage must not fail the job
            log.warning("qsa_lookup_failed", cnpj=cnpj, error=str(exc)[:300])
            return []
        return [
            {
                "name": r["partner_name"],
                "role": r["partner_role"],
                "share": r["share"],
                "document": r["partner_document"],
            }
            for r in rows
        ]

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None


def build_firmographics_provider(settings: Settings) -> FirmographicsProvider:
    return FirmographicsProvider(
        settings.cnpj_database_url,
        timeout_seconds=settings.cnpj_query_timeout_seconds,
    )
