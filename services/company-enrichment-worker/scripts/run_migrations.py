#!/usr/bin/env python3
"""Run database migrations (alembic upgrade head)."""
from __future__ import annotations

import os

from alembic import command
from alembic.config import Config


def main() -> None:
    cfg = Config("alembic.ini")
    cfg.set_main_option("script_location", "migrations")
    url = os.getenv("DATABASE_URL", "postgresql+asyncpg://localhost/postgres")
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    print("migrations applied")


if __name__ == "__main__":
    main()
