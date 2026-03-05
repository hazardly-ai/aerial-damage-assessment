from fastapi import APIRouter, Depends, HTTPException
import psycopg

from app.db import get_conn
from app.schemas.disasters import DisasterResponse
from app.services.disasters import fetch_all_disasters, fetch_disaster_by_id

router = APIRouter(prefix="/disasters", tags=["disasters"])


@router.get("", response_model=list[DisasterResponse])
def get_disasters(conn: psycopg.Connection = Depends(get_conn)):
    rows = fetch_all_disasters(conn)
    return [DisasterResponse(**row) for row in rows]


@router.get("/{disaster_id}", response_model=DisasterResponse)
def get_disaster(disaster_id: int, conn: psycopg.Connection = Depends(get_conn)):
    row = fetch_disaster_by_id(conn, disaster_id)
    if not row:
        raise HTTPException(status_code=404, detail="Disaster not found")
    return DisasterResponse(**row)
