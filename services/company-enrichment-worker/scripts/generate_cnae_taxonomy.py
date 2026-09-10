#!/usr/bin/env python3
"""Regenerate the CNAE taxonomy JSON consumed by the SalesIntel web UI.

Reads `docs/CNAE_2_3_por_ramos_e_categorias.xlsx` (sheet "CNAEs completos")
and writes a friendly Ramo → Categoria → atividades hierarchy to the
salesintel-platform repo. Requires `openpyxl`.

Usage:
    python scripts/generate_cnae_taxonomy.py \
        --xlsx docs/CNAE_2_3_por_ramos_e_categorias.xlsx \
        --out /Users/alvaropaco/salesintel-platform/apps/web/src/data/cnae-taxonomy.json
"""
from __future__ import annotations

import argparse
import collections
import json
import os

import openpyxl


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--xlsx",
        default="docs/CNAE_2_3_por_ramos_e_categorias.xlsx",
        help="Path to the source workbook",
    )
    parser.add_argument(
        "--out",
        default=(
            "/Users/alvaropaco/salesintel-platform/apps/web/src/data/cnae-taxonomy.json"
        ),
        help="Destination JSON path",
    )
    args = parser.parse_args()

    wb = openpyxl.load_workbook(args.xlsx, data_only=True)
    ws = wb["CNAEs completos"]
    rows = ws.iter_rows(min_row=2, values_only=True)

    ramos: collections.OrderedDict[str, dict] = collections.OrderedDict()
    for row in rows:
        (
            secao,
            ramo,
            secao_oficial,
            divisao,
            categoria,
            _grupo,
            _subcategoria,
            _classe,
            _classe_ativ,
            cnae,
            cnae_sem,
            atividade,
        ) = row[0:12]
        if not cnae_sem:
            continue
        rmo = ramos.setdefault(
            secao,
            {
                "secao": secao,
                "nome": ramo,
                "oficial": secao_oficial,
                "categorias": collections.OrderedDict(),
            },
        )
        cat = rmo["categorias"].setdefault(
            str(divisao),
            {"divisao": str(divisao), "nome": categoria, "atividades": []},
        )
        cat["atividades"].append(
            {
                "cnae": cnae,
                "codigo": str(cnae_sem).zfill(7),
                "atividade": atividade,
            }
        )

    doc = {
        "version": "CNAE-Subclasses 2.3",
        "source": "https://concla.ibge.gov.br/classificacoes/download-concla.html",
        "ramos": [
            {
                "secao": r["secao"],
                "nome": r["nome"],
                "oficial": r["oficial"],
                "categorias": [
                    {
                        "divisao": c["divisao"],
                        "nome": c["nome"],
                        "atividades": c["atividades"],
                    }
                    for c in r["categorias"].values()
                ],
            }
            for r in ramos.values()
        ],
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(doc, handle, ensure_ascii=False)

    total = sum(
        len(a)
        for r in doc["ramos"]
        for c in r["categorias"]
        for a in c["atividades"]
    )
    print(
        f"wrote {args.out}: "
        f"{len(doc['ramos'])} ramos, "
        f"{sum(len(r['categorias']) for r in doc['ramos'])} categorias, "
        f"{total} CNAEs"
    )


if __name__ == "__main__":
    main()
