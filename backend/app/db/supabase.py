import psycopg
from fastapi import HTTPException
from psycopg.rows import dict_row
from supabase import Client, create_client

from config import (
    DB_HOST,
    DB_NAME,
    DB_PASSWORD,
    DB_PORT,
    DB_USER,
    SUPABASE_SERVICE_KEY,
    SUPABASE_URL,
    db_settings_configured,
    missing_db_settings,
)


def create_supabase_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_conn():
    """FastAPI dependency that yields a psycopg connection.

    Raises a descriptive error when required DB environment variables are not set.
    """
    if not db_settings_configured():
        missing = ", ".join(missing_db_settings())
        raise HTTPException(status_code=503, detail=f"Database configuration is incomplete. Missing: {missing}")

    conn = psycopg.connect(
        host=DB_HOST,
        port=int(DB_PORT),
        user=DB_USER,
        password=DB_PASSWORD,
        dbname=DB_NAME,
        row_factory=dict_row,
    )
    try:
        yield conn
    finally:
        conn.close()
