"""Centralized file layouts for the Receita Federal CSV exports (spec section 9).

No magic indexes anywhere else in the codebase. Every file's column order is
declared exactly once, here.
"""

from __future__ import annotations

from dataclasses import dataclass

CSV_DELIMITER = ";"
CSV_ENCODING = "latin-1"
CSV_QUOTECHAR = '"'


@dataclass(frozen=True, slots=True)
class Layout:
    """Describes one exported file type."""

    name: str
    columns: tuple[str, ...]
    #: File name prefix used by the portal, lowercased.
    file_prefix: str

    @property
    def column_count(self) -> int:
        return len(self.columns)


# ---------------------------------------------------------------------
# K3241.K03200Y*.D*.EMPRECSV
# ---------------------------------------------------------------------
EMPRESAS_COLUMNS: tuple[str, ...] = (
    "cnpj_basic",
    "legal_name",
    "legal_nature_code",
    "responsible_qualification_code",
    "share_capital",
    "company_size_code",
    "responsible_federative_entity",
)

EMPRESAS = Layout(name="empresas", columns=EMPRESAS_COLUMNS, file_prefix="empresas")


# ---------------------------------------------------------------------
# K3241.K03200Y*.D*.ESTABELE
# ---------------------------------------------------------------------
ESTABELECIMENTOS_COLUMNS: tuple[str, ...] = (
    "cnpj_basic",
    "cnpj_order",
    "cnpj_check_digits",
    "headquarters_branch",
    "trade_name",
    "registration_status_code",
    "registration_status_date",
    "registration_status_reason",
    "foreign_city",
    "country_code",
    "opening_date",
    "main_cnae",
    "secondary_cnaes",
    "street_type",
    "street",
    "number",
    "complement",
    "district",
    "postal_code",
    "state",
    "city_code",
    "area_code_1",
    "phone_1",
    "area_code_2",
    "phone_2",
    "fax_area_code",
    "fax",
    "email",
    "special_status",
    "special_status_date",
)

ESTABELECIMENTOS = Layout(
    name="estabelecimentos",
    columns=ESTABELECIMENTOS_COLUMNS,
    file_prefix="estabelecimentos",
)


# ---------------------------------------------------------------------
# F.K03200$W.SIMPLES.CSV.*
# ---------------------------------------------------------------------
SIMPLES_COLUMNS: tuple[str, ...] = (
    "cnpj_basic",
    "simple_tax_option",
    "simple_tax_option_date",
    "simple_tax_exclusion_date",
    "mei_option",
    "mei_option_date",
    "mei_exclusion_date",
)

SIMPLES = Layout(name="simples", columns=SIMPLES_COLUMNS, file_prefix="simples")


# ---------------------------------------------------------------------
# K3241.K03200Y*.D*.SOCIOCSV (optional)
# ---------------------------------------------------------------------
SOCIOS_COLUMNS: tuple[str, ...] = (
    "cnpj_basic",
    "partner_type",
    "partner_name",
    "partner_document",
    "partner_qualification_code",
    "entry_date",
    "country_code",
    "legal_representative_document",
    "legal_representative_name",
    "legal_representative_qualification_code",
    "age_range_code",
)

SOCIOS = Layout(name="socios", columns=SOCIOS_COLUMNS, file_prefix="socios")


# ---------------------------------------------------------------------
# Lookup tables: all share a (code, description) shape.
# ---------------------------------------------------------------------
LOOKUP_COLUMNS: tuple[str, ...] = ("code", "description")

CNAES = Layout(name="cnaes", columns=LOOKUP_COLUMNS, file_prefix="cnaes")
MUNICIPIOS = Layout(name="municipios", columns=LOOKUP_COLUMNS, file_prefix="municipios")
NATUREZAS = Layout(name="naturezas", columns=LOOKUP_COLUMNS, file_prefix="naturezas")
PAISES = Layout(name="paises", columns=LOOKUP_COLUMNS, file_prefix="paises")
QUALIFICACOES = Layout(name="qualificacoes", columns=LOOKUP_COLUMNS, file_prefix="qualificacoes")
MOTIVOS = Layout(name="motivos", columns=LOOKUP_COLUMNS, file_prefix="motivos")

LOOKUP_LAYOUTS: tuple[Layout, ...] = (
    CNAES,
    MUNICIPIOS,
    NATUREZAS,
    PAISES,
    QUALIFICACOES,
    MOTIVOS,
)

ALL_LAYOUTS: tuple[Layout, ...] = (
    EMPRESAS,
    ESTABELECIMENTOS,
    SIMPLES,
    SOCIOS,
    *LOOKUP_LAYOUTS,
)


# ---------------------------------------------------------------------
# Extracted-file classification
# ---------------------------------------------------------------------
#: Suffixes the portal uses inside the ZIP archives, mapped to a layout name.
_SUFFIX_HINTS: dict[str, str] = {
    "EMPRECSV": "empresas",
    "ESTABELE": "estabelecimentos",
    "SIMPLES": "simples",
    "SOCIOCSV": "socios",
    "CNAECSV": "cnaes",
    "MUNICCSV": "municipios",
    "NATJUCSV": "naturezas",
    "PAISCSV": "paises",
    "QUALSCSV": "qualificacoes",
    "MOTICSV": "motivos",
}

_BY_NAME: dict[str, Layout] = {layout.name: layout for layout in ALL_LAYOUTS}


def get_layout(name: str) -> Layout:
    try:
        return _BY_NAME[name]
    except KeyError as exc:
        raise KeyError(f"unknown layout {name!r}") from exc


def classify_file(file_name: str) -> Layout | None:
    """Map an extracted file name to its layout, or None when unrecognized."""
    upper = file_name.upper()
    for suffix, layout_name in _SUFFIX_HINTS.items():
        if upper.endswith(suffix) or f".{suffix}" in upper:
            return _BY_NAME[layout_name]

    # Fallback: match on the archive prefix (e.g. "Empresas0.csv").
    lower = file_name.lower()
    for layout in ALL_LAYOUTS:
        if lower.startswith(layout.file_prefix):
            return layout
    return None


def group_by_layout(file_names: list[str]) -> dict[str, list[str]]:
    """Group extracted files by layout name, ignoring unknown files."""
    grouped: dict[str, list[str]] = {}
    for name in sorted(file_names):
        layout = classify_file(name)
        if layout is None:
            continue
        grouped.setdefault(layout.name, []).append(name)
    return grouped
