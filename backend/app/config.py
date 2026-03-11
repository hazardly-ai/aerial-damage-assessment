from pathlib import Path
import os

from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parent.parent
_env = dotenv_values(BACKEND_DIR / ".env")


def _setting(name: str, default: str = "") -> str:
    return os.getenv(name, _env.get(name, default))


DB_HOST = _setting("DB_HOST")
DB_PORT = _setting("DB_PORT")
DB_USER = _setting("DB_USER")
DB_PASSWORD = _setting("DB_PASSWORD")
DB_NAME = _setting("DB_NAME")

SUPABASE_URL = _setting("SUPABASE_URL")
SUPABASE_ANON_KEY = _setting("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = _setting("SUPABASE_SERVICE_KEY")

LABELS_DIR = BACKEND_DIR.parent / "data" / "test" / "labels"


_REQUIRED_DB_SETTINGS = {
    "DB_HOST": DB_HOST,
    "DB_PORT": DB_PORT,
    "DB_USER": DB_USER,
    "DB_PASSWORD": DB_PASSWORD,
    "DB_NAME": DB_NAME,
}


def missing_db_settings() -> list[str]:
    return [name for name, value in _REQUIRED_DB_SETTINGS.items() if not value]


def db_settings_configured() -> bool:
    return not missing_db_settings()
