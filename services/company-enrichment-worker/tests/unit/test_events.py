"""Event contract unit tests."""
import uuid

import pytest
from pydantic import ValidationError

from company_enrichment.events.contracts import (
    CompanyResultEventV1,
    EnrichmentRequestedV1,
    EnrichmentRequestStatus,
)


def test_requested_event_defaults():
    ev = EnrichmentRequestedV1(company_id=uuid.uuid4(), cnpj="12345678000199")
    assert ev.version == "1"
    assert ev.event_id is not None
    assert ev.tenant_id is None


def test_requested_event_requires_cnpj_and_company():
    with pytest.raises(ValidationError):
        EnrichmentRequestedV1()


def test_result_event_fields():
    req = EnrichmentRequestedV1(company_id=uuid.uuid4(), cnpj="12345678000199")
    res = CompanyResultEventV1(
        request_event_id=req.event_id,
        company_id=req.company_id,
        cnpj=req.cnpj,
        status=EnrichmentRequestStatus.COMPLETED,
        enrichment_version=2,
    )
    assert res.request_event_id == req.event_id
    assert res.status == EnrichmentRequestStatus.COMPLETED


def test_result_event_roundtrip_json():
    req = EnrichmentRequestedV1(company_id=uuid.uuid4(), cnpj="1")
    res = CompanyResultEventV1(
        request_event_id=req.event_id,
        company_id=req.company_id,
        cnpj=req.cnpj,
        status=EnrichmentRequestStatus.PARTIAL,
    )
    data = res.model_dump(mode="json")
    assert data["status"] == "PARTIAL"
