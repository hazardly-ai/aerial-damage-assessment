from __future__ import annotations

"""
Minimal RAG plus tool-calling demo for spatial damage queries.

Setup:
- backend/.env must define:
  - DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
  - MAPBOX_API_KEY
  - NEMOTRON_URL
  - NEMOTRON_API_KEY

Run from the repo root:
    backend\\.venv\\Scripts\\python.exe -m app.rag_location_mvp ^
      --question "Show predicted major damage near 123 Main St"

Example output shape:
    Question: Show predicted major damage near 123 Main St
    Parsed address: 123 Main St
    Parsed damage filter: major-damage

    Tool Trace:
    1. geocode_address(address='123 Main St')
       -> {'formatted_address': '...', 'lon': ..., 'lat': ...}
    2. get_buildings_near(lon=..., lat=..., radius_m=5000, damage_filter='major-damage')
       -> 7 rows

    Evidence:
    - uid=... xbd_id=... disaster=hurricane-harvey damage=major-damage distance_m=...

    Agent Answer:
    ...

    RAG Answer:
    ...

Validation notes:
- This script is intentionally narrow. It validates one location-query flow.
- It will raise if the agent does not call both required tools in order:
  1. geocode_address(...)
  2. get_buildings_near(...)
"""

import argparse
import json
import os
import re
from dataclasses import dataclass
from typing import Any

import psycopg
import requests
from llama_index.core import Document, SummaryIndex
from llama_index.core.agent import ReActAgent
from llama_index.core.llms import CompletionResponse, CustomLLM
from llama_index.core.tools import FunctionTool
from psycopg.rows import dict_row

from app.config import DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER, db_settings_configured, missing_db_settings


DEFAULT_MODEL = "mistralai/mistral-nemotron"
DEFAULT_RADIUS_M = 5000
DEFAULT_LIMIT = 25


@dataclass
class ToolTraceEntry:
    name: str
    arguments: dict[str, Any]
    preview: str


TRACE_LOG: list[ToolTraceEntry] = []
LAST_GEOCODE_RESULT: dict[str, Any] | None = None
LAST_BUILDING_RESULTS: list[dict[str, Any]] = []


def reset_trace() -> None:
    TRACE_LOG.clear()
    global LAST_GEOCODE_RESULT, LAST_BUILDING_RESULTS
    LAST_GEOCODE_RESULT = None
    LAST_BUILDING_RESULTS = []


def record_tool_call(name: str, arguments: dict[str, Any], preview: str) -> None:
    TRACE_LOG.append(ToolTraceEntry(name=name, arguments=arguments, preview=preview))


def ensure_db_configured() -> None:
    if db_settings_configured():
        return
    missing = ", ".join(missing_db_settings())
    raise RuntimeError(f"Database configuration is incomplete. Missing: {missing}")


def get_db_connection() -> psycopg.Connection:
    ensure_db_configured()
    return psycopg.connect(
        host=DB_HOST,
        port=int(DB_PORT),
        user=DB_USER,
        password=DB_PASSWORD,
        dbname=DB_NAME,
        row_factory=dict_row,
    )


def call_nemotron(prompt: str) -> str:
    url = os.getenv("NEMOTRON_URL")
    api_key = os.getenv("NEMOTRON_API_KEY")

    if not url or not api_key:
        raise RuntimeError("Nemotron configuration is incomplete. Set NEMOTRON_URL and NEMOTRON_API_KEY.")

    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": DEFAULT_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 300,
        },
        timeout=30,
    )

    if response.status_code != 200:
        raise RuntimeError(f"Nemotron request failed: {response.status_code} {response.text}")

    data = response.json()
    content = data["choices"][0]["message"]["content"].strip().strip('"')
    if not content:
        raise RuntimeError("Nemotron returned an empty completion.")
    return content


class NemotronLLM(CustomLLM):
    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "context_window": 4096,
            "num_output": 256,
            "model_name": "nemotron",
        }

    def complete(self, prompt: str, **kwargs: Any) -> CompletionResponse:
        return CompletionResponse(text=call_nemotron(prompt))

    def stream_complete(self, prompt: str, **kwargs: Any):
        yield CompletionResponse(text=self.complete(prompt, **kwargs).text)


def parse_location_query(question: str) -> tuple[str, str | None]:
    q = question.lower()
    damage_filter = None
    if "destroyed" in q:
        damage_filter = "destroyed"
    elif "major" in q:
        damage_filter = "major-damage"
    elif "minor" in q:
        damage_filter = "minor-damage"
    elif any(token in q for token in ["no damage", "no-damage", "undamaged"]):
        damage_filter = "no-damage"

    match = re.search(r"\bnear\s+(.+?)(?:\?|$)", question, flags=re.IGNORECASE)
    if not match:
        raise ValueError("This MVP expects a location query containing 'near <address>'.")

    address = match.group(1).strip(" ?,.")
    if not address:
        raise ValueError("Could not parse an address from the question.")

    return address, damage_filter


def geocode_address(address: str) -> dict[str, Any]:
    api_key = os.getenv("MAPBOX_API_KEY")
    if not api_key:
        raise RuntimeError("MAPBOX_API_KEY is not configured.")

    response = requests.get(
        f"https://api.mapbox.com/geocoding/v5/mapbox.places/{address}.json",
        params={"access_token": api_key, "limit": 1},
        timeout=20,
    )

    if response.status_code != 200:
        raise RuntimeError(f"Mapbox geocoding failed: {response.status_code} {response.text}")

    data = response.json()
    if not data.get("features"):
        raise RuntimeError(f"Mapbox returned no result for address: {address}")

    feature = data["features"][0]
    result = {
        "formatted_address": feature["place_name"],
        "lon": feature["center"][0],
        "lat": feature["center"][1],
        "bbox": feature.get("bbox"),
    }

    global LAST_GEOCODE_RESULT
    LAST_GEOCODE_RESULT = result
    record_tool_call("geocode_address", {"address": address}, json.dumps(result, default=str))
    return result


def get_buildings_near(
    lon: float,
    lat: float,
    radius_m: int = DEFAULT_RADIUS_M,
    damage_filter: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[dict[str, Any]]:
    sql = """
    SELECT
      b.uid,
      b.predicted_damage,
      ST_AsGeoJSON(b.geom) AS geom_geojson,
      ip.id AS image_pair_id,
      ip.xbd_id,
      ip.capture_date,
      ip.sensor,
      d.id AS disaster_id,
      d.name AS disaster_name,
      d.type AS disaster_type,
      ROUND(
        CAST(
          ST_Distance(
            b.geom::geography,
            ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
          ) AS numeric
        ),
        2
      ) AS distance_m
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    JOIN disasters d ON ip.disaster_id = d.id
    WHERE ST_DWithin(
      b.geom::geography,
      ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
      %s
    )
    """

    params: list[Any] = [lon, lat, lon, lat, radius_m]
    if damage_filter:
        sql += " AND b.predicted_damage = %s"
        params.append(damage_filter)

    sql += " ORDER BY distance_m ASC LIMIT %s"
    params.append(limit)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            rows = cur.fetchall()

    results: list[dict[str, Any]] = []
    for row in rows:
        result = dict(row)
        geom_geojson = result.get("geom_geojson")
        if isinstance(geom_geojson, str):
            result["geometry"] = json.loads(geom_geojson)
        else:
            result["geometry"] = geom_geojson
        result.pop("geom_geojson", None)
        results.append(result)

    global LAST_BUILDING_RESULTS
    LAST_BUILDING_RESULTS = results
    record_tool_call(
        "get_buildings_near",
        {
            "lon": lon,
            "lat": lat,
            "radius_m": radius_m,
            "damage_filter": damage_filter,
            "limit": limit,
        },
        f"{len(results)} rows",
    )
    return results


def build_retrieval_documents(
    question: str,
    resolved_address: str,
    buildings: list[dict[str, Any]],
    damage_filter: str | None,
    radius_m: int,
) -> list[Document]:
    unique_disasters = sorted({str(row["disaster_name"]) for row in buildings})
    intro_lines = [
        f"User question: {question}",
        f"Resolved address: {resolved_address}",
        f"Spatial radius meters: {radius_m}",
        f"Requested predicted damage filter: {damage_filter or 'none'}",
        f"Matching buildings returned: {len(buildings)}",
        f"Disasters represented in evidence: {', '.join(unique_disasters) if unique_disasters else 'none'}",
    ]

    documents = [Document(text="\n".join(intro_lines))]

    for row in buildings[:10]:
        documents.append(
            Document(
                text="\n".join(
                    [
                        f"Building UID: {row['uid']}",
                        f"Predicted damage: {row['predicted_damage']}",
                        f"Distance meters: {row['distance_m']}",
                        f"Disaster: {row['disaster_name']} ({row['disaster_type']})",
                        f"Image pair ID: {row['image_pair_id']}",
                        f"xBD ID: {row['xbd_id']}",
                        f"Capture date: {row['capture_date']}",
                        f"Sensor: {row['sensor']}",
                    ]
                ),
                metadata={
                    "uid": str(row["uid"]),
                    "xbd_id": row["xbd_id"],
                    "disaster_name": row["disaster_name"],
                    "predicted_damage": row["predicted_damage"],
                },
            )
        )

    return documents


def build_rag_answer(
    llm: NemotronLLM,
    question: str,
    resolved_address: str,
    buildings: list[dict[str, Any]],
    damage_filter: str | None,
    radius_m: int,
) -> str:
    documents = build_retrieval_documents(
        question=question,
        resolved_address=resolved_address,
        buildings=buildings,
        damage_filter=damage_filter,
        radius_m=radius_m,
    )
    index = SummaryIndex.from_documents(documents)
    query_engine = index.as_query_engine(llm=llm, response_mode="compact")
    prompt = f"""
Use only the retrieved evidence to answer the user's question.

User question: {question}
Resolved address: {resolved_address}
Requested damage filter: {damage_filter or "none"}

Requirements:
- State how many matching buildings were found.
- Mention the damage filter if one was requested.
- Mention up to three building UIDs from the evidence.
- Do not invent IDs, counts, or locations.
- Keep the answer concise.
"""
    return str(query_engine.query(prompt))


def create_agent(llm: NemotronLLM, radius_m: int, limit: int) -> ReActAgent:
    geocode_tool = FunctionTool.from_defaults(
        fn=geocode_address,
        name="geocode_address",
        description="Resolve a user-provided address into longitude, latitude, and a formatted address using Mapbox.",
    )
    buildings_tool = FunctionTool.from_defaults(
        fn=get_buildings_near,
        name="get_buildings_near",
        description=(
            "Query PostGIS for buildings near a lon/lat point. "
            "Use radius_m in meters and predicted damage labels like major-damage."
        ),
    )

    system_prompt = f"""
You are an aerial damage assessment agent.

For location-based questions:
1. Call geocode_address first.
2. Then call get_buildings_near using the geocoded lon/lat.
3. Use radius_m={radius_m} unless the user specifies another radius.
4. If the user asks for predicted major damage, use damage_filter="major-damage".
5. Do not invent tool outputs.
6. Keep the final answer short and factual.

The SQL tool already handles spatial filtering and optional predicted_damage filtering.
Tool result limit is {limit}.
"""
    return ReActAgent.from_tools(
        [geocode_tool, buildings_tool],
        llm=llm,
        verbose=True,
        system_prompt=system_prompt,
    )


def print_tool_trace() -> None:
    print("\nTool Trace:")
    if not TRACE_LOG:
        print("  (no tool calls recorded)")
        return

    for index, entry in enumerate(TRACE_LOG, start=1):
        rendered_args = ", ".join(f"{key}={value!r}" for key, value in entry.arguments.items())
        print(f"{index}. {entry.name}({rendered_args})")
        print(f"   -> {entry.preview}")


def validate_required_tool_flow() -> None:
    tool_names = [entry.name for entry in TRACE_LOG]
    expected = ["geocode_address", "get_buildings_near"]

    if len(tool_names) < 2:
        raise RuntimeError(
            f"Expected tool flow {expected}, but recorded only {tool_names}."
        )

    if tool_names[:2] != expected:
        raise RuntimeError(
            f"Expected first tool calls {expected}, but recorded {tool_names[:2]}."
        )


def print_evidence(buildings: list[dict[str, Any]]) -> None:
    print("\nEvidence:")
    if not buildings:
        print("  (no buildings found)")
        return

    for row in buildings[:10]:
        print(
            "  - "
            f"uid={row['uid']} "
            f"xbd_id={row['xbd_id']} "
            f"disaster={row['disaster_name']} "
            f"damage={row['predicted_damage']} "
            f"distance_m={row['distance_m']}"
        )


def run_demo(question: str, radius_m: int, limit: int) -> None:
    reset_trace()
    address, damage_filter = parse_location_query(question)
    llm = NemotronLLM()
    agent = create_agent(llm=llm, radius_m=radius_m, limit=limit)

    print(f"Question: {question}")
    print(f"Parsed address: {address}")
    print(f"Parsed damage filter: {damage_filter or 'none'}")

    agent_response = str(agent.chat(question))
    geocode_result = LAST_GEOCODE_RESULT
    buildings = LAST_BUILDING_RESULTS
    validate_required_tool_flow()

    if not geocode_result:
        raise RuntimeError("The agent did not record a geocode result.")

    rag_answer = build_rag_answer(
        llm=llm,
        question=question,
        resolved_address=geocode_result["formatted_address"],
        buildings=buildings,
        damage_filter=damage_filter,
        radius_m=radius_m,
    )

    print_tool_trace()
    print_evidence(buildings)
    print("\nAgent Answer:")
    print(agent_response)
    print("\nRAG Answer:")
    print(rag_answer)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the RAG plus tool-calling location-query MVP.")
    parser.add_argument(
        "--question",
        default="Show predicted major damage near 123 Main St",
        help="Natural-language query to execute.",
    )
    parser.add_argument(
        "--radius-m",
        type=int,
        default=DEFAULT_RADIUS_M,
        help="Spatial search radius in meters for the PostGIS query.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help="Maximum number of building rows to retrieve.",
    )
    args = parser.parse_args()
    run_demo(question=args.question, radius_m=args.radius_m, limit=args.limit)


if __name__ == "__main__":
    main()
