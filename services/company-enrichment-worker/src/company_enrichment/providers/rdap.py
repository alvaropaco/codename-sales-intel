"""RDAP provider: registration data and domain age."""
from __future__ import annotations

import httpx

from company_enrichment.providers.base import Provider, ProviderError
from company_enrichment.providers.circuit_breaker import CircuitBreaker


class RDAPResult:
    def __init__(self) -> None:
        self.registered = False
        self.registrar: str | None = None
        self.created: str | None = None
        self.updated: str | None = None
        self.expires: str | None = None
        self.status: list[str] = []


# Bootstrap RDAP servers per TLD (common ones). Extend as needed.
_BOOTSTRAP = {
    "com": "https://rdap.verisign.com/com/v1/domain/",
    "net": "https://rdap.verisign.com/net/v1/domain/",
    "org": "https://rdap.org/domain/",
    "br": "https://rdap.registro.br/domain/",
}


class RDAPProvider(Provider):
    name = "rdap"

    def __init__(self, circuit: CircuitBreaker | None = None, timeout: float = 10.0) -> None:
        super().__init__(circuit)
        self._client = httpx.AsyncClient(timeout=timeout)

    def base_for(self, domain: str) -> str | None:
        tld = domain.rsplit(".", 1)[-1].lower()
        return _BOOTSTRAP.get(tld)

    async def lookup(self, domain: str) -> RDAPResult:
        return await self._execute(self._do_lookup, domain)

    async def _do_lookup(self, domain: str) -> RDAPResult:
        result = RDAPResult()
        base = self.base_for(domain)
        if not base:
            # No bootstrap server known for this TLD; try generic IANA/rdap.org.
            base = "https://rdap.org/domain/"
        url = f"{base}{domain}"
        try:
            resp = await self._client.get(url)
            if resp.status_code == 404:
                result.registered = False
                return result
            resp.raise_for_status()
            data = resp.json()
            result.registered = True
            events = {e.get("eventAction"): e.get("eventDate") for e in data.get("events", [])}
            result.created = events.get("registration")
            result.updated = events.get("last changed")
            result.expires = events.get("expiration")
            entities = data.get("entities", [])
            for ent in entities:
                vcard = ent.get("vcardArray", [None, []])[1] if ent.get("vcardArray") else []
                for item in vcard:
                    if item and len(item) > 3 and item[0] == "fn":
                        result.registrar = str(item[3])
                        break
                if result.registrar:
                    break
            result.status = data.get("status", [])
        except httpx.HTTPStatusError as exc:
            raise ProviderError("HTTP_ERROR", f"RDAP {exc.response.status_code} for {domain}", transient=True) from exc
        except httpx.HTTPError as exc:
            raise ProviderError("NETWORK", f"RDAP network error: {exc}", transient=True) from exc
        return result

    async def close(self) -> None:
        await self._client.aclose()
