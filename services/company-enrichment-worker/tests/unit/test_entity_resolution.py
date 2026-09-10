"""Unit tests for entity resolution (normalization/dedup keys)."""
from __future__ import annotations

import pytest

from company_enrichment.services.entity_resolution import (
    entity_key_for,
    normalize_domain,
    normalize_email,
    normalize_person_name,
    normalize_phone,
    normalize_url,
    social_key,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("WWW.Acme.com.br/", "acme.com.br"),
        ("https://Acme.com.br/home", "acme.com.br"),
        ("ACME.COM.br.", "acme.com.br"),
        ("foo", None),
        ("not a domain", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_domain(value, expected):
    assert normalize_domain(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("  FOO@ACMECOM.br ", "foo@acmecom.br"),
        ("mailto:bar@x.com", "bar@x.com"),
        ("baz", None),
        ("no-at-sign", None),
        (None, None),
    ],
)
def test_normalize_email(value, expected):
    assert normalize_email(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("(11) 99999-0000", "5511999990000"),
        ("+55 11 98888-7777", "5511988887777"),
        ("123", None),  # too short
        (None, None),
    ],
)
def test_normalize_phone(value, expected):
    assert normalize_phone(value) == expected


def test_normalize_url():
    assert normalize_url("example.com/about") == "https://example.com/about"
    assert normalize_url("https://a.com#frag") == "https://a.com"
    assert normalize_url("nope") is None


def test_normalize_person_name():
    assert normalize_person_name("  joão  DA silva ") == "João Da Silva"


def test_social_key():
    assert social_key("linkedin", "https://www.linkedin.com/company/AcmeBrasil") == "linkedin:acmebrasil"
    assert social_key("instagram", "Instagram") == "instagram:instagram"
    assert social_key("linkedin", None) is None


def test_entity_key_for_kinds():
    assert entity_key_for("COMPANY", "12.345.678/0001-99") == "12345678000199"
    assert entity_key_for("EMAIL", "X@Y.com") == "x@y.com"
    assert entity_key_for("DOMAIN", "Acme.com") == "acme.com"
    assert entity_key_for("PHONE", "11999990000") == "5511999990000"
    assert entity_key_for("TECHNOLOGY", "Cloudflare") == "cloudflare"
    assert entity_key_for("DOMAIN", None) is None
