"""E-mail notifications for ingest/embedding outcomes.

Stdlib-only SMTP client (``smtplib`` + ``EmailMessage``) so the pipeline
carries no extra dependency. Every send is best-effort: a notification
failure is logged and never propagates — the ingest result is already
durable in Postgres/NATS before any e-mail is attempted.

Configuration (see ``config.Settings``): ``NOTIFY_EMAIL_ENABLED`` gates the
whole feature; ``SMTP_*`` describes the relay; ``NOTIFY_EMAIL_TO`` is a
comma-separated recipient list.
"""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from cnpj_data_publisher.config import Settings, get_settings
from cnpj_data_publisher.logging import get_logger

logger = get_logger(__name__)


def _fmt_duration(value: object) -> str:
    seconds = float(value) if isinstance(value, (int, float)) and value > 0 else 0.0
    if seconds <= 0:
        return "—"
    total = int(seconds)
    if total < 60:
        return f"{total}s"
    if total < 3600:
        return f"{total // 60}m{total % 60:02d}s"
    return f"{total // 3600}h{(total % 3600) // 60:02d}m"


class NotificationService:
    """Sends operational e-mails about the monthly pipeline. Never raises."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    # -- public API ---------------------------------------------------------
    @property
    def enabled(self) -> bool:
        s = self.settings
        return bool(s.notify_email_enabled and s.smtp_host and s.notify_email_to)

    def send_ingest_success(self, *, version: str, statistics: dict[str, object]) -> bool:
        stats = statistics or {}
        rows = [
            ("Snapshot", version),
            ("Empresas ativas normalizadas", f"{stats.get('active_rows', 0):,}".replace(",", ".")),
            ("Descobertas", stats.get("discovered", 0)),
            ("Atualizadas", stats.get("updated", 0)),
            ("Reativadas", stats.get("reactivated", 0)),
            ("Inativadas", stats.get("inactivated", 0)),
            ("Linhas no sink (pgvector)", stats.get("sink_rows_loaded", "—")),
            ("Eventos criados", stats.get("events_created", 0)),
            ("Duração do download", _fmt_duration(stats.get("download_seconds"))),
            ("Duração total", _fmt_duration(stats.get("total_seconds"))),
        ]
        sink_error = stats.get("sink_error")
        if sink_error:
            rows.append(("⚠️ Sink (pgvector)", f"FALHOU: {str(sink_error)[:300]}"))
            subject = f"[cnpj-data-publisher] ⚠️ ingestão {version} concluída com sink com falha"
        else:
            subject = f"[cnpj-data-publisher] ✅ ingestão {version} concluída"
        return self._send(subject, self._render(rows, footer=self._footer()))

    def send_ingest_failure(self, *, version: str, stage: str, code: str, message: str) -> bool:
        rows: list[tuple[str, object]] = [
            ("Snapshot", version or "—"),
            ("Estágio", stage),
            ("Código de erro", code),
            ("Mensagem", (message or "")[:1500]),
        ]
        subject = f"[cnpj-data-publisher] ❌ ingestão {version or '?'} FALHOU em {stage}"
        return self._send(subject, self._render(rows, footer=self._footer()))

    def send_embed_report(
        self, *, version: str, rows_embedded: int, batches: int, coverage: dict[str, int]
    ) -> bool:
        total = coverage.get("total", 0)
        pending = coverage.get("pending", 0)
        done = coverage.get("embedded", 0)
        pct = f"{(done / total * 100):.2f}%" if total else "—"
        rows = [
            ("Snapshot base", version),
            ("Vetores gerados nesta execução", f"{rows_embedded:,}".replace(",", ".")),
            ("Lotes", batches),
            ("Cobertura de embeddings", f"{done:,}/{total:,} ({pct})".replace(",", ".")),
            ("Pendentes", f"{pending:,}".replace(",", ".")),
        ]
        if pending > 0:
            subject = f"[cnpj-data-publisher] ⚠️ embedding incompleto ({pending:,} pendentes)"
        else:
            subject = f"[cnpj-data-publisher] ✅ embedding/indexação pgvector concluída ({version})"
        return self._send(subject, self._render(rows, footer=self._footer()))

    # -- internals ----------------------------------------------------------
    def _recipients(self) -> list[str]:
        return [r.strip() for r in self.settings.notify_email_to.split(",") if r.strip()]

    def _footer(self) -> str:
        return (
            f"host: {self.settings.service_name} · env: {self.settings.app_env}<br>"
            "Eventos NATS: company.br.cnpj.ingest.* — automação mensal (CronJob do dia 15)."
        )

    @staticmethod
    def _render(rows: list[tuple[str, object]], footer: str) -> tuple[str, str]:
        """Returns (text, html) bodies for the same content."""
        text_lines = [f"{k}: {v}" for k, v in rows]
        text_body = "\n".join(text_lines)
        html_rows = "".join(
            f"<tr><td style='padding:4px 12px 4px 0;color:#666'>{k}</td>"
            f"<td style='padding:4px 0'><b>{v}</b></td></tr>"
            for k, v in rows
        )
        html_body = (
            "<div style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px'>"
            f"<table style='border-collapse:collapse'>{html_rows}</table>"
            f"<p style='color:#999;font-size:12px;margin-top:16px'>{footer}</p></div>"
        )
        return text_body, html_body

    def _send(self, subject: str, bodies: tuple[str, str]) -> bool:
        if not self.enabled:
            logger.info("notification_disabled", subject=subject)
            return False
        s = self.settings
        text_body, html_body = bodies
        msg = EmailMessage()
        msg["Subject"] = subject
        sender = s.smtp_from or s.smtp_user
        if sender:
            msg["From"] = formataddr(("cnpj-data-publisher", sender))
        recipients = self._recipients()
        msg["To"] = ", ".join(recipients)
        msg.set_content(text_body)
        msg.add_alternative(html_body, subtype="html")

        try:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=30) as smtp:
                if s.smtp_starttls:
                    smtp.starttls()
                if s.smtp_user:
                    smtp.login(s.smtp_user, s.smtp_password)
                smtp.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:
            # A notification must never break the pipeline outcome.
            logger.error("notification_failed", subject=subject, error=str(exc))
            return False
        logger.info("notification_sent", subject=subject, to=recipients)
        return True
