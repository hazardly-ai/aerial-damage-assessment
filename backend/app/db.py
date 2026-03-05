from collections.abc import Generator

import psycopg
from psycopg.rows import dict_row

from app.config import DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER


def get_conn() -> Generator[psycopg.Connection, None, None]:
    conn = psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        dbname=DB_NAME,
        row_factory=dict_row,
    )
    try:
        yield conn
    finally:
        conn.close()
