"""Unit tests for snapshot discovery."""

from __future__ import annotations

import httpx
import pytest

from cnpj_data_publisher.receita.discovery import (
    DiscoveryError,
    SnapshotDiscovery,
)

pytestmark = pytest.mark.unit

BASE = "https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj"

INDEX_HTML = """
<html><body>
<a href="../">../</a>
<a href="2026-05/">2026-05/</a>
<a href="2026-06/">2026-06/</a>
<a href="2026-07/">2026-07/</a>
<a href="notes.txt">notes.txt</a>
</body></html>
"""

COMPLETE_LISTING = """
<html><body>
<a href="Empresas0.zip">Empresas0.zip</a>
<a href="Empresas1.zip">Empresas1.zip</a>
<a href="Estabelecimentos0.zip">Estabelecimentos0.zip</a>
<a href="Cnaes.zip">Cnaes.zip</a>
<a href="Municipios.zip">Municipios.zip</a>
<a href="Naturezas.zip">Naturezas.zip</a>
<a href="Paises.zip">Paises.zip</a>
<a href="Qualificacoes.zip">Qualificacoes.zip</a>
<a href="Simples.zip">Simples.zip</a>
</body></html>
"""

INCOMPLETE_LISTING = """
<html><body>
<a href="Empresas0.zip">Empresas0.zip</a>
<a href="Cnaes.zip">Cnaes.zip</a>
</body></html>
"""


def _client(routes: dict[str, str]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.method == "HEAD":
            return httpx.Response(
                200,
                headers={
                    "content-length": "1024",
                    "etag": '"abc123"',
                    "last-modified": "Mon, 01 Jul 2026 00:00:00 GMT",
                },
            )
        if url in routes:
            return httpx.Response(200, text=routes[url])
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


def test_list_versions_sorted() -> None:
    client = _client({f"{BASE}/": INDEX_HTML})
    discovery = SnapshotDiscovery(base_url=BASE, client=client)
    assert discovery.list_versions() == ["2026-05", "2026-06", "2026-07"]


def test_list_versions_raises_when_unreachable() -> None:
    client = _client({})
    discovery = SnapshotDiscovery(base_url=BASE, client=client)
    with pytest.raises(DiscoveryError):
        discovery.list_versions()


def test_get_snapshot_complete() -> None:
    client = _client({f"{BASE}/2026-07/": COMPLETE_LISTING})
    discovery = SnapshotDiscovery(base_url=BASE, client=client)
    info = discovery.get_snapshot("2026-07")

    assert info is not None
    assert info.complete is True
    assert info.missing_prefixes == ()
    assert len(info.files) == 9
    assert info.files[0].size == 1024
    assert info.files[0].etag == '"abc123"'
    assert info.total_size == 9 * 1024


def test_get_snapshot_incomplete_reports_missing() -> None:
    client = _client({f"{BASE}/2026-06/": INCOMPLETE_LISTING})
    discovery = SnapshotDiscovery(base_url=BASE, client=client)
    info = discovery.get_snapshot("2026-06")

    assert info is not None
    assert info.complete is False
    assert "estabelecimentos" in info.missing_prefixes
    assert "simples" in info.missing_prefixes


def test_partners_required_when_enabled() -> None:
    client = _client({f"{BASE}/2026-07/": COMPLETE_LISTING})
    discovery = SnapshotDiscovery(base_url=BASE, include_partners=True, client=client)
    info = discovery.get_snapshot("2026-07")

    assert info is not None
    assert info.complete is False
    assert info.missing_prefixes == ("socios",)


def test_get_latest_complete_skips_incomplete() -> None:
    client = _client(
        {
            f"{BASE}/": INDEX_HTML,
            f"{BASE}/2026-07/": INCOMPLETE_LISTING,
            f"{BASE}/2026-06/": COMPLETE_LISTING,
        }
    )
    discovery = SnapshotDiscovery(base_url=BASE, client=client)
    info = discovery.get_latest_complete()

    assert info is not None
    assert info.version == "2026-06"


def test_resolve_latest_and_explicit() -> None:
    client = _client({f"{BASE}/": INDEX_HTML, f"{BASE}/2026-07/": COMPLETE_LISTING})
    discovery = SnapshotDiscovery(base_url=BASE, client=client)

    assert discovery.resolve("latest") is not None
    explicit = discovery.resolve("2026-07")
    assert explicit is not None
    assert explicit.version == "2026-07"


def test_invalid_version_rejected() -> None:
    discovery = SnapshotDiscovery(base_url=BASE, client=_client({}))
    with pytest.raises(ValueError, match="expected YYYY-MM"):
        discovery.get_snapshot("2026/07")


# --- Dated mirror folders (casadosdados: YYYY-MM-DD) -----------------------

MIRROR = "https://dados-abertos-rf-cnpj.casadosdados.com.br/arquivos"

MIRROR_INDEX_HTML = """
<html><body>
<a href="/arquivos/">Parent Directory</a>
<a href="2026-05-10/">2026-05-10/</a>
<a href="2026-06-14/">2026-06-14/</a>
<a href="2026-07-12/">2026-07-12/</a>
</body></html>
"""


def test_list_versions_canonicalizes_dated_folders() -> None:
    client = _client({f"{MIRROR}/": MIRROR_INDEX_HTML})
    discovery = SnapshotDiscovery(base_url=MIRROR, client=client)
    assert discovery.list_versions() == ["2026-05", "2026-06", "2026-07"]


def test_get_snapshot_by_dated_folder() -> None:
    client = _client({f"{MIRROR}/2026-07-12/": COMPLETE_LISTING})
    discovery = SnapshotDiscovery(base_url=MIRROR, client=client)
    info = discovery.get_snapshot("2026-07-12")

    assert info is not None
    assert info.version == "2026-07"
    assert info.complete is True
    assert len(info.files) == 9


def test_get_snapshot_by_month_resolves_dated_folder() -> None:
    client = _client(
        {
            f"{MIRROR}/": MIRROR_INDEX_HTML,
            f"{MIRROR}/2026-07-12/": COMPLETE_LISTING,
        }
    )
    discovery = SnapshotDiscovery(base_url=MIRROR, client=client)
    info = discovery.get_snapshot("2026-07")

    assert info is not None
    assert info.version == "2026-07"
    assert info.source_url == f"{MIRROR}/2026-07-12/"
    assert info.complete is True


def test_resolve_latest_on_mirror() -> None:
    client = _client(
        {
            f"{MIRROR}/": MIRROR_INDEX_HTML,
            f"{MIRROR}/2026-07-12/": COMPLETE_LISTING,
        }
    )
    discovery = SnapshotDiscovery(base_url=MIRROR, client=client)
    info = discovery.resolve("latest")

    assert info is not None
    assert info.version == "2026-07"


def test_host_allowlist_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RECEITA_ALLOWED_HOSTS", "arquivos.receitafederal.gov.br")
    from cnpj_data_publisher.config import reset_settings

    reset_settings()

    discovery = SnapshotDiscovery(base_url="https://evil.example.com/cnpj", client=_client({}))
    with pytest.raises(DiscoveryError, match="not in RECEITA_ALLOWED_HOSTS"):
        discovery.list_versions()
