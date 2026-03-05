from pathlib import Path

from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parent.parent
_env = dotenv_values(BACKEND_DIR / ".env")

DB_HOST = _env["DB_HOST"]
DB_PORT = _env["DB_PORT"]
DB_USER = _env["DB_USER"]
DB_PASSWORD = _env["DB_PASSWORD"]
DB_NAME = _env["DB_NAME"]

SUPABASE_URL = _env.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = _env.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_KEY = _env.get("SUPABASE_SERVICE_KEY", "")

LABELS_DIR = BACKEND_DIR.parent / "data" / "test" / "labels"
