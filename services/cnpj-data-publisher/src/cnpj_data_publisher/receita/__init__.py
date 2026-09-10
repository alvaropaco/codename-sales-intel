"""Receita Federal CNPJ open-data source integration.

Handles discovery of monthly snapshots, download of zipped CSVs,
extraction, and manifest tracking.
"""

__all__ = ["discovery", "downloader", "extractor", "manifest"]
