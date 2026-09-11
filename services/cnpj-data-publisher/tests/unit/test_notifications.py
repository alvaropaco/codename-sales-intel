"""NotificationService: SMTP rendering, gating and best-effort semantics."""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from typing import Any

import pytest

from cnpj_data_publisher.notifications import NotificationService

pytestmark = pytest.mark.unit


class FakeSMTP:
    """Records the last sent message; raises if ``fail`` is set."""

    last: Any = None
    fail: Exception | None = None
    started_tls: bool = False
    logged_in: bool = False

    def __init__(self, host: str, port: int, timeout: float | None = None) -> None:
        FakeSMTP.host = host

    def __enter__(self) -> FakeSMTP:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def starttls(self) -> None:
        FakeSMTP.started_tls = True

    def login(self, user: str, password: str) -> None:
        FakeSMTP.logged_in = True

    def send_message(self, msg: EmailMessage) -> None:
        if FakeSMTP.fail:
            raise FakeSMTP.fail
        FakeSMTP.last = msg


@pytest.fixture(autouse=True)
def _fake_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSMTP.last = None
    FakeSMTP.fail = None
    FakeSMTP.started_tls = False
    FakeSMTP.logged_in = False
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)


@pytest.fixture
def enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NOTIFY_EMAIL_ENABLED", "true")
    monkeypatch.setenv("SMTP_HOST", "smtp.test.local")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USER", "noreply@test.local")
    monkeypatch.setenv("SMTP_PASSWORD", "secret")
    monkeypatch.setenv("SMTP_FROM", "noreply@test.local")
    monkeypatch.setenv("NOTIFY_EMAIL_TO", "ops@test.local, boss@test.local")
    from cnpj_data_publisher.config import reset_settings

    reset_settings()


def test_disabled_by_default() -> None:
    assert NotificationService().enabled is False
    assert NotificationService().send_ingest_success(version="2026-08", statistics={}) is False
    assert FakeSMTP.last is None


def test_ingest_success_sends_rendered_email(enabled: None) -> None:  # noqa: ARG001
    service = NotificationService()
    assert service.enabled is True

    sent = service.send_ingest_success(
        version="2026-08",
        statistics={
            "active_rows": 4_284_878,
            "discovered": 12_345,
            "updated": 1000,
            "reactivated": 5,
            "inactivated": 7,
            "sink_rows_loaded": 4_284_878,
            "events_created": 13_359,
        },
    )

    assert sent is True
    msg = FakeSMTP.last
    assert msg is not None
    assert "ingestão 2026-08 concluída" in msg["Subject"]
    assert "✅" in msg["Subject"]
    assert sorted(str(msg["To"]).split(", ")) == ["boss@test.local", "ops@test.local"]
    text = msg.get_body(preferencelist=("plain",)).get_content()
    assert "4.284.878" in text  # pt-BR thousands separator
    assert "Descobertas: 12345" in text
    assert FakeSMTP.started_tls is True
    assert FakeSMTP.logged_in is True


def test_ingest_success_flags_sink_failure(enabled: None) -> None:  # noqa: ARG001
    sent = NotificationService().send_ingest_success(
        version="2026-08",
        statistics={"sink_error": "connection refused"},
    )
    assert sent is True
    assert "⚠️" in FakeSMTP.last["Subject"]
    assert "connection refused" in FakeSMTP.last.get_body(preferencelist=("plain",)).get_content()


def test_ingest_failure_email(enabled: None) -> None:  # noqa: ARG001
    sent = NotificationService().send_ingest_failure(
        version="2026-08",
        stage="DOWNLOADING",
        code="INTEGRITY_FAILED",
        message="size mismatch for Empresas0.zip",
    )
    assert sent is True
    assert "❌" in FakeSMTP.last["Subject"]
    assert "DOWNLOADING" in FakeSMTP.last["Subject"]
    text = FakeSMTP.last.get_body(preferencelist=("plain",)).get_content()
    assert "INTEGRITY_FAILED" in text
    assert "size mismatch" in text


def test_embed_report_success_and_incomplete(enabled: None) -> None:  # noqa: ARG001
    service = NotificationService()

    service.send_embed_report(
        version="2026-08",
        rows_embedded=10,
        batches=1,
        coverage={"total": 10, "embedded": 10, "pending": 0},
    )
    assert "✅" in FakeSMTP.last["Subject"]
    assert "100.00%" in FakeSMTP.last.get_body(preferencelist=("plain",)).get_content()

    service.send_embed_report(
        version="2026-08",
        rows_embedded=8,
        batches=1,
        coverage={"total": 10, "embedded": 8, "pending": 2},
    )
    assert "⚠️" in FakeSMTP.last["Subject"]
    assert "2 pendentes" in FakeSMTP.last["Subject"]


def test_embed_failure_email(enabled: None) -> None:  # noqa: ARG001
    sent = NotificationService().send_embed_failure(
        version="2026-08", message="EMBEDDING_BASE_URL is not configured"
    )
    assert sent is True
    assert "❌" in FakeSMTP.last["Subject"]
    assert "embedding FALHOU" in FakeSMTP.last["Subject"]
    assert "EMBEDDING_BASE_URL" in FakeSMTP.last.get_body(preferencelist=("plain",)).get_content()


def test_smtp_failure_is_swallowed(enabled: None) -> None:  # noqa: ARG001
    FakeSMTP.fail = smtplib.SMTPException("relay down")
    sent = NotificationService().send_ingest_failure(
        version="2026-08", stage="NORMALIZING", code="NORMALIZATION_FAILED", message="boom"
    )
    assert sent is False  # logged, never raised
