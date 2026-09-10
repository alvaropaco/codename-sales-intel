from __future__ import annotations

import logging
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog

from cnpj_data_publisher.config import get_settings

_SENSITIVE_KEYS = {
    "password",
    "passwd",
    "secret",
    "token",
    "credentials",
    "creds",
    "database_url",
    "s3_secret_key",
    "s3_access_key",
    "nats_creds_file",
    "authorization",
}


def _redact_sensitive(
    _logger: Any, _method: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """Never emit secrets to logs (spec section 32)."""
    for key in list(event_dict):
        if key.lower() in _SENSITIVE_KEYS:
            event_dict[key] = "***REDACTED***"
    return event_dict


def _add_service_context(
    _logger: Any, _method: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    event_dict.setdefault("service", get_settings().service_name)
    return event_dict


def configure_logging(component: str | None = None) -> None:
    """Configure structlog for JSON output (spec section 33)."""
    settings = get_settings()
    level = logging.getLevelName(settings.log_level.upper())
    if not isinstance(level, int):
        level = logging.INFO

    renderer: Any = (
        structlog.dev.ConsoleRenderer()
        if settings.log_format == "console"
        else structlog.processors.JSONRenderer()
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            _add_service_context,
            _redact_sensitive,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(sys.stdout),
        cache_logger_on_first_use=True,
    )

    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    for noisy in ("httpx", "httpcore", "asyncio", "botocore", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    if component:
        structlog.contextvars.bind_contextvars(component=component)


def get_logger(name: str) -> Any:
    return structlog.get_logger(name)
