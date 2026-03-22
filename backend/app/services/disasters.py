import psycopg


def fetch_all_disasters(conn: psycopg.Connection) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT id, name, type FROM disasters ORDER BY id")
        return cur.fetchall()


def fetch_disaster_by_id(conn: psycopg.Connection, disaster_id: int) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, type FROM disasters WHERE id = %s",
            (disaster_id,),
        )
        return cur.fetchone()
