import sys
from pathlib import Path

# Ensure the backend directory is on sys.path so `app` is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app.config import db_settings_configured
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def pytest_runtest_setup(item):
    if not db_settings_configured() and item.name != "test_health":
        pytest.skip("DB settings are not configured; skipping database-backed endpoint tests")
