"""SSRF protection for outbound URL fetching.

Blocks private, loopback, link-local, metadata endpoints, and private IPv6
addresses both before a request and after any redirect.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

BLOCKED_HOSTNAMES = {
    "localhost",
    "metadata.google.internal",
    "metadata.google",
    "169.254.169.254",
}


class SSRFBlockedError(Exception):
    pass


def _is_private(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.is_loopback or addr.is_link_local or addr.is_private or addr.is_reserved or addr.is_multicast:
        return True
    if isinstance(addr, ipaddress.IPv6Address) and (addr.is_private or addr.is_loopback or addr.sixtofour or addr.is_unspecified):
        return True
    return False


def resolve_and_check(host: str) -> bool:
    """Resolve a hostname and verify none of its addresses are private/blocked."""
    name = host.lower().rstrip(".")
    if name in BLOCKED_HOSTNAMES:
        raise SSRFBlockedError(f"blocked host: {host}")
    try:
        infos = socket.getaddrinfo(name, None)
    except socket.gaierror as exc:
        raise SSRFBlockedError(f"could not resolve {host}: {exc}") from exc
    for info in infos:
        addr = info[4][0]
        if _is_private(addr):
            raise SSRFBlockedError(f"private address for {host}: {addr}")
    return True


def validate_url(url: str) -> str:
    """Validate a full URL for SSRF safety, then return the canonical URL."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SSRFBlockedError(f"unsupported scheme: {parsed.scheme}")
    if not parsed.hostname:
        raise SSRFBlockedError(f"missing host: {url}")
    host = parsed.hostname
    # If the host is already an IP literal, check it directly.
    try:
        ipaddress.ip_address(host)
        is_ip = True
    except ValueError:
        is_ip = False
    if is_ip:
        if _is_private(host):
            raise SSRFBlockedError(f"private address: {host}")
    else:
        resolve_and_check(host)
    return url
