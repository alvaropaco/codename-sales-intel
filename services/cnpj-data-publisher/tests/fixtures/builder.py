"""Builds small but realistic CNPJ fixtures for tests.

Two snapshots (2026-06 and 2026-07) exercise every diff scenario from the spec:
new active, unchanged, updated, reactivated, inactivated, new inactive, plus
malformed rows (bad date, bad capital, short row).
"""

from __future__ import annotations

import zipfile
from pathlib import Path

DELIM = ";"
ENC = "latin-1"


def _q(value: str) -> str:
    return f'"{value}"'


def _row(*values: str) -> str:
    return DELIM.join(_q(v) for v in values)


# ---------------------------------------------------------------------
# Lookup tables (shared by both snapshots)
# ---------------------------------------------------------------------
CNAES = "\n".join(
    [
        _row("6201501", "Desenvolvimento de programas de computador sob encomenda"),
        _row("6202300", "Desenvolvimento e licenciamento de programas customizaveis"),
        _row("4711302", "Comercio varejista de mercadorias em geral"),
    ]
)

MUNICIPIOS = "\n".join(
    [_row("7107", "SAO PAULO"), _row("6001", "RIO DE JANEIRO"), _row("4123", "BELO HORIZONTE")]
)

NATUREZAS = "\n".join(
    [_row("2062", "Sociedade Empresaria Limitada"), _row("2135", "Empresario Individual")]
)

PAISES = "\n".join([_row("105", "BRASIL")])

QUALIFICACOES = "\n".join([_row("49", "Socio-Administrador"), _row("10", "Diretor")])

MOTIVOS = "\n".join(
    [_row("00", "SEM MOTIVO"), _row("01", "EXTINCAO POR ENCERRAMENTO LIQUIDACAO VOLUNTARIA")]
)


# ---------------------------------------------------------------------
# Companies (empresas): cnpj_basic, legal_name, nature, qual, capital, size, entity
# ---------------------------------------------------------------------
def empresas(snapshot: str) -> str:
    capital_acme = "150000,00" if snapshot == "2026-07" else "100000,00"
    rows = [
        _row("11111111", "ACME SOFTWARE LTDA", "2062", "49", capital_acme, "03", ""),
        _row("22222222", "ESTAVEL COMERCIO LTDA", "2062", "49", "50000,00", "03", ""),
        _row("33333333", "RENASCE SERVICOS LTDA", "2062", "49", "80000,00", "03", ""),
        _row("44444444", "ENCERRADA INDUSTRIA LTDA", "2062", "49", "20000,00", "03", ""),
        _row("55555555", "NOVA EMPRESA ATIVA LTDA", "2062", "49", "10000,00", "01", ""),
        _row("66666666", "NOVA EMPRESA INATIVA LTDA", "2062", "49", "5000,00", "01", ""),
        # Malformed capital: must be rejected into NULL but keep the row.
        _row("77777777", "CAPITAL INVALIDO LTDA", "2062", "49", "abc,xx", "03", ""),
    ]
    return "\n".join(rows)


# ---------------------------------------------------------------------
# Establishments (estabelecimentos): 30 columns
# ---------------------------------------------------------------------
def _estab(
    basic: str,
    status: str,
    *,
    order: str = "0001",
    dv: str = "90",
    hq: str = "1",
    trade: str = "",
    status_date: str = "20260701",
    reason: str = "00",
    opening: str = "20200115",
    main_cnae: str = "6201501",
    secondary: str = "6202300",
    state: str = "SP",
    city: str = "7107",
    email: str = "contato@empresa.com.br",
    phone: str = "999999999",
    area: str = "11",
) -> str:
    return _row(
        basic,
        order,
        dv,
        hq,
        trade,
        status,
        status_date,
        reason,
        "",
        "105",
        opening,
        main_cnae,
        secondary,
        "RUA",
        "EXEMPLO",
        "100",
        "",
        "CENTRO",
        "01000000",
        state,
        city,
        area,
        phone,
        "",
        "",
        "",
        "",
        email,
        "",
        "",
    )


def estabelecimentos(snapshot: str) -> str:
    is_july = snapshot == "2026-07"
    rows = [
        # 1) Updated: email + capital change between snapshots.
        _estab(
            "11111111",
            "02",
            email="novo@acme.com.br" if is_july else "antigo@acme.com.br",
        ),
        # 2) Unchanged in both snapshots -> must produce no event.
        _estab("22222222", "02", trade="ESTAVEL", main_cnae="4711302", secondary=""),
        # 3) Reactivated: SUSPENDED in June, ACTIVE in July.
        _estab("33333333", "02" if is_july else "03"),
        # 4) Inactivated: ACTIVE in June, CLOSED in July.
        _estab(
            "44444444",
            "08" if is_july else "02",
            reason="01" if is_july else "00",
            status_date="20260720" if is_july else "20260601",
        ),
        # 5) New active company: only present in July.
        *(
            [_estab("55555555", "02", opening="20260610", state="RJ", city="6001")]
            if is_july
            else []
        ),
        # 6) New inactive company: only in July, must produce no event.
        *(
            [_estab("66666666", "04", opening="20260615", state="MG", city="4123")]
            if is_july
            else []
        ),
        # 7) Invalid opening date -> normalized to NULL, row still processed.
        _estab("77777777", "02", opening="00000000", state="SP"),
        # 8) Row with too few columns -> ignored by the parser.
        _q("88888888") + DELIM + _q("0001"),
    ]
    return "\n".join(rows)


# ---------------------------------------------------------------------
# Simples: cnpj_basic, simples, date, exclusion, mei, date, exclusion
# ---------------------------------------------------------------------
SIMPLES = "\n".join(
    [
        _row("11111111", "S", "20200201", "", "N", "", ""),
        _row("22222222", "S", "20190101", "", "N", "", ""),
        _row("33333333", "N", "", "", "N", "", ""),
        _row("55555555", "S", "20260615", "", "S", "20260615", ""),
    ]
)


def _write_zip(path: Path, member: str, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(member, content.encode(ENC, errors="replace"))
    return path


def build_snapshot_fixture(directory: Path, snapshot: str) -> Path:
    """Create the full set of ZIP archives for one snapshot version."""
    target = directory / snapshot
    target.mkdir(parents=True, exist_ok=True)

    _write_zip(target / "Empresas0.zip", "K3241.K03200Y0.D50111.EMPRECSV", empresas(snapshot))
    _write_zip(
        target / "Estabelecimentos0.zip",
        "K3241.K03200Y0.D50111.ESTABELE",
        estabelecimentos(snapshot),
    )
    _write_zip(target / "Simples.zip", "F.K03200$W.SIMPLES.CSV.D50111", SIMPLES)
    _write_zip(target / "Cnaes.zip", "F.K03200$Z.D50111.CNAECSV", CNAES)
    _write_zip(target / "Municipios.zip", "F.K03200$Z.D50111.MUNICCSV", MUNICIPIOS)
    _write_zip(target / "Naturezas.zip", "F.K03200$Z.D50111.NATJUCSV", NATUREZAS)
    _write_zip(target / "Paises.zip", "F.K03200$Z.D50111.PAISCSV", PAISES)
    _write_zip(target / "Qualificacoes.zip", "F.K03200$Z.D50111.QUALSCSV", QUALIFICACOES)
    _write_zip(target / "Motivos.zip", "F.K03200$Z.D50111.MOTICSV", MOTIVOS)

    return target


#: Expected diff outcome between 2026-06 and 2026-07.
EXPECTED_DIFF = {
    "discovered": {"55555555000190"},
    "updated": {"11111111000190"},
    "reactivated": {"33333333000190"},
    "inactivated": {"44444444000190"},
    "unchanged": {"22222222000190", "77777777000190"},
    "no_event": {"66666666000190"},
}
