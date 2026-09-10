"""SSRF guard unit tests."""
import pytest

from company_enrichment.providers.ssrf import SSRFBlockedError, validate_url


def test_reject_localhost():
    with pytest.raises(SSRFBlockedError):
        validate_url("http://localhost:8080/foo")


def test_reject_private_ip():
    for ip in ("10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254"):
        with pytest.raises(SSRFBlockedError):
            validate_url(f"http://{ip}/")


def test_reject_link_local_ipv6():
    with pytest.raises(SSRFBlockedError):
        validate_url("http://[::1]/")
    with pytest.raises(SSRFBlockedError):
        validate_url("http://[fe80::1]/")


def test_reject_metadata_hostname():
    with pytest.raises(SSRFBlockedError):
        validate_url("http://metadata.google.internal/computeMetadata/v1/")


def test_reject_bad_scheme():
    with pytest.raises(SSRFBlockedError):
        validate_url("file:///etc/passwd")
    with pytest.raises(SSRFBlockedError):
        validate_url("ftp://example.com")


def test_accept_public_url():
    # example.com resolves to a public address and should pass.
    validate_url("https://example.com/")
    validate_url("https://www.example.com/path?q=1")


def test_reject_missing_host():
    with pytest.raises(SSRFBlockedError):
        validate_url("https://")
