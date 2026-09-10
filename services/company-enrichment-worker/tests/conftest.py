"""Pytest configuration and shared fixtures."""
import os
import sys

# Ensure the project root is importable.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def pytest_configure(config):
    config.addinivalue_line("markers", "integration: integration tests requiring NATS/Postgres")
