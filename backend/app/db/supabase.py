import psycopg
from psycopg.rows import dict_row
from supabase import Client, create_client

from app.config import (
    DB_HOST,
    DB_NAME,
    DB_PASSWORD,
    DB_PORT,
    DB_USER,
    SUPABASE_SERVICE_KEY,
    SUPABASE_URL,
)


def create_supabase_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_conn():
    """FastAPI dependency that yields a psycopg connection to the Supabase
    PostgreSQL database, then closes it after the request."""
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
