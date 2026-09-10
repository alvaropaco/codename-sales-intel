"""DNS provider: A/AAAA, MX, and basic domain checks."""
from __future__ import annotations

import dns.asyncresolver
import dns.resolver

from company_enrichment.providers.base import Provider
from company_enrichment.providers.circuit_breaker import CircuitBreaker


class DNSResult:
    def __init__(self) -> None:
        self.has_a = False
        self.has_mx = False
        self.mx_hosts: list[str] = []
        self.ns: list[str] = []
        self.txt_spf: list[str] = []
        self.error: str | None = None
        self.registrant_domain_check: str | None = None


class DNSProvider(Provider):
    name = "dns"

    def __init__(self, circuit: CircuitBreaker | None = None, timeout: float = 5.0) -> None:
        super().__init__(circuit)
        self._timeout = timeout

    async def lookup(self, domain: str) -> DNSResult:
        return await self._execute(self._do_lookup, domain)

    async def _do_lookup(self, domain: str) -> DNSResult:
        result = DNSResult()
        resolver = dns.asyncresolver.Resolver()
        resolver.timeout = self._timeout
        resolver.lifetime = self._timeout
        try:
            answers = await resolver.resolve(domain, "A")
            result.has_a = bool(answers)
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            result.has_a = False
        except Exception as exc:  # noqa: BLE001
            result.has_a = False
            result.error = str(exc)

        try:
            mx = await resolver.resolve(domain, "MX")
            result.has_mx = bool(mx)
            result.mx_hosts = sorted({str(r.exchange).rstrip(".") for r in mx})
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            result.has_mx = False
        except Exception:  # noqa: BLE001
            result.has_mx = False

        try:
            ns = await resolver.resolve(domain, "NS")
            result.ns = sorted({str(r).rstrip(".") for r in ns})
        except Exception:  # noqa: BLE001
            pass

        try:
            txt = await resolver.resolve(domain, "TXT")
            result.txt_spf = [
                " ".join(t.strings).decode() if isinstance(t.strings[0], bytes) else " ".join(t.strings)
                for t in txt
            ]
        except Exception:  # noqa: BLE001
            pass
        return result

    async def mx_for(self, domain: str) -> list[str]:
        res = await self.lookup(domain)
        return res.mx_hosts

    async def close(self) -> None:
        # dns.asyncresolver does not maintain a persistent client to close.
        return None
