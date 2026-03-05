import psycopg


def fetch_all_disasters(conn: psycopg.Connection) -> list[dict]:
    # TODO (Shiv): query disasters table, return list of dicts with id, name, type
    pass


def fetch_disaster_by_id(conn: psycopg.Connection, disaster_id: int) -> dict | None:
    # TODO (Shiv): query disasters table by id, return dict or None
    pass
