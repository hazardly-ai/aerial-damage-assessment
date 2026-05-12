# importing libraries needed for database, API calls, and environment variables
import psycopg  # used to connect to PostgreSQL (Supabase)
import requests  # used to make HTTP API calls (Mapbox + Nemotron)
import os  # used to access environment variables
import json  # used to convert GeoJSON text from PostGIS into a real Python dictionary
import random
import re
from pathlib import Path
from urllib.parse import quote  # used to safely encode values inside frontend route URLs
from dotenv import load_dotenv  # used to load .env file

# importing llamaindex components for LLM integration
from llama_index.core import Settings
from llama_index.core.llms import CustomLLM, CompletionResponse



# storing conversation history for context
chat_history = []

# storing conversation history for context
def save_turn(question, answer):
    chat_history.append({"role": "user", "content": question})
    chat_history.append({"role": "assistant", "content": answer})

# loading environment variables from backend/.env file so secrets are not hardcoded
BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env", override=True)


# default disaster name used when building frontend map routes
# frontend route example: /map/hurricane-harvey/3?building=<building_uid>
# this can be changed later through backend/.env if needed
DEFAULT_DISASTER_NAME = os.getenv("DEFAULT_DISASTER_NAME", "hurricane-harvey")


# function to connect to database using environment variables
def get_db_connection():
    return psycopg.connect(
        host=os.getenv("DB_HOST"),  # database host from Supabase
        port=os.getenv("DB_PORT", "5432"),  # default postgres port
        dbname=os.getenv("DB_NAME", "postgres"),  # database name
        user=os.getenv("DB_USER"),  # database user
        password=os.getenv("DB_PASSWORD"),  # database password
    )




# function to convert SQL rows into Python dictionary format
# this format is easier for the chatbot and frontend to use
def rows_to_buildings(rows):
    buildings = []  # list that will store all building dictionaries

    for r in rows:
        building_uid = str(r[0])  # convert UUID to string so frontend/JSON can use it
        xbd_id = r[1]  # xBD image pair/scene id used in the frontend route
        damage = r[2]  # predicted damage label from the database
        geometry = r[3]  # building polygon geometry from PostGIS as GeoJSON text

        # ST_AsGeoJSON returns geometry as a string, so convert it into a real JSON object
        # this makes it easier for Mapbox/frontend to draw the polygon
        if isinstance(geometry, str):
            geometry = json.loads(geometry)

        buildings.append({
            "id": building_uid,  # keep id for general backend/frontend use
            "uid": building_uid,  # exact field frontend uses for building route
            "xbd_id": xbd_id,  # image pair id used in /map/:disasterName/:xbd_id
            "damage": damage,  # damage level used for filtering/color-coding
            "geometry": geometry  # GeoJSON polygon object for Mapbox
        })

    return buildings





# function to parse user question (very simple NLP logic for MVP)
def parse_question(question):

    q = question.lower()

    # detect damage type
    if any(word in q for word in [ "fine", "no damage", "no-damage", "no damaged", "undamaged", "okay", "ok", "good", "unaffected"
]):
        damage = "no-damage"
    elif "minor" in q:
        damage = "minor-damage"
    elif "destroyed" in q:
        damage = "destroyed"
    else:
        damage = "major-damage"

    # extract location from common location phrases
    location_match = re.search(
        r"\b(?:near|in)\s+(.+?)(?:\?|$)",
        q,
        flags=re.IGNORECASE,
    )

    if location_match:
        address = location_match.group(1).strip()

        for word in ["damage", "damaged", "buildings", "building", "area", "locations", "location"]:
            address = re.sub(rf"\b{word}\b", "", address, flags=re.IGNORECASE).strip()

        address = re.sub(r"\s+", " ", address).strip(" ,?")

        # fix vague location like "me"
        if address in ["me", "here", "my", "", "?"]:
            address = "Houston Texas"

    else:
        address = None

        # try to get location from chat history
        for msg in reversed(chat_history):
            content = msg.get("content", "").lower()

            if "houston" in content:
                address = "Houston Texas"
                break

        # final fallback
        if not address:
            address = "Houston Texas"

    return address, damage


def extract_address_filter_text(question):
    q = question.strip()

    patterns = [
        r"have\s+an?\s+(.+?)\s+address",
        r"with\s+an?\s+(.+?)\s+address",
        r"in\s+(.+?)\s+by\s+address",
    ]

    for pattern in patterns:
        match = re.search(pattern, q, flags=re.IGNORECASE)
        if not match:
            continue
        address_text = match.group(1).strip(" ?,.")
        address_text = re.sub(r"\b(buildings?|properties|records)\b", "", address_text, flags=re.IGNORECASE).strip(" ,")
        return address_text or None

    return None


def extract_in_location_text(question):
    match = re.search(r"\bin\s+(.+?)(?:\?|$)", question, flags=re.IGNORECASE)
    if not match:
        return None

    address_text = match.group(1).strip(" ?,.")
    address_text = re.sub(
        r"\b(damage|damaged|buildings?|properties|records|locations?)\b",
        "",
        address_text,
        flags=re.IGNORECASE,
    ).strip(" ,")
    return address_text or None


def extract_on_location_text(question):
    match = re.search(r"\bon\s+(.+?)(?:\?|$)", question, flags=re.IGNORECASE)
    if not match:
        return None

    address_text = match.group(1).strip(" ?,.")
    address_text = re.sub(
        r"\b(damage|damaged|buildings?|properties|records|locations?)\b",
        "",
        address_text,
        flags=re.IGNORECASE,
    ).strip(" ,")
    return address_text or None


def extract_general_location_text(question):
    patterns = [
        r"tell me about\s+(.+?)(?:\?|$)",
        r"what about\s+(.+?)(?:\?|$)",
        r"give me stats for\s+(.+?)(?:\?|$)",
        r"give me information about\s+(.+?)(?:\?|$)",
        r"overview of\s+(.+?)(?:\?|$)",
    ]

    for pattern in patterns:
        match = re.search(pattern, question, flags=re.IGNORECASE)
        if not match:
            continue
        location_text = match.group(1).strip(" ?,.")
        location_text = re.sub(
            r"\b(damage|damaged|buildings?|properties|records|stats|statistics|information)\b",
            "",
            location_text,
            flags=re.IGNORECASE,
        ).strip(" ,")
        return location_text or None

    return None




# function to convert address → latitude/longitude using Mapbox API
def geocode_address(address):

    api_key = os.getenv("MAPBOX_API_KEY")  # getting API key

    # building Mapbox API URL
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{address}.json"

    params = {
        "access_token": api_key,
        "limit": 1  # only need top result
    }

    # sending request to Mapbox
    response = requests.get(url, params=params)

    # if API fails, return None
    if response.status_code != 200:
        return None

    data = response.json()

    # if no results found
    if len(data["features"]) == 0:
        return None

    feature = data["features"][0]
    coords = feature["center"]
    bbox = feature.get("bbox")

    return {
        "lon": coords[0],  # longitude
        "lat": coords[1],  # latitude
        "formatted_address": feature["place_name"],  # clean address
        "bbox": bbox,
    }




# this function checks if the user is asking a "decision-type" question
# like safety, travel, repairs, rebuilding etc basically detecting advisory intent using simple keyword matching
def detect_advisory(question):

    q = question.lower() # converting to lowercase so matching is easier

    # checking if user is asking about safety
    if "safe" in q:
        return "safety"

     # checking if user is asking about travel conditions
    if "travel" in q:
        return "travel"

     # checking if user is asking about repair or fixing buildings
    if "repair" in q or "fix" in q:
        return "repair"

    # checking if user is asking about rebuilding / reconstruction
    if "rebuild" in q or "reconstruct" in q:
        return "rebuild"

    #if none then it is not an advisory 
    return None



# this function generates a smart response using LLM
# it combines actual building damage data with general reasoning so it acts like a "decision-support" layer, not just raw data output
def advisory_response(question, buildings, address):

    # creating a dictionary to count how many buildings per damage type
    counts = {}

    for b in buildings:
        d = b["damage"] # getting damage label
        counts[d] = counts.get(d, 0) + 1

    # building a prompt for the LLM
    # we pass structured data + user question so model can reason
    prompt = f"""
You are a disaster assessment assistant.

Location: {address}
Damage breakdown: {counts}
User question: {question}

Give a short, realistic answer.

- Do NOT say "assistant"
- Do NOT refer to yourself
- Speak directly
- Use cautious reasoning (e.g., "based on damage levels", "may require")

Keep it 1–2 sentences.



"""
     # calling Nemotron LLM to generate final answer
    return call_nemotron(prompt) or fallback_advisory_response(buildings, address)




# function to query buildings near a location using PostGIS
def get_buildings_near(lon, lat, radius_m, damage_filter):

    conn = get_db_connection()  # connecting to database
    cur = conn.cursor()  # creating a cursor so we can run SQL queries

    # SQL query using spatial filtering with ST_DWithin
    # b.uid is the building UID used by the frontend route
    # ip.xbd_id is the xBD image pair id used by the frontend route
    # b.predicted_damage is the stored damage label
    # ST_AsGeoJSON converts the building polygon into GeoJSON text
    query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE ST_DWithin(
        b.geom::geography,
        ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
        %s
    )
    AND b.predicted_damage = %s
    ORDER BY ST_Distance(
        b.geom::geography,
        ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
    ) ASC
    """

    # executing query safely using parameters
    cur.execute(query, (lon, lat, radius_m, damage_filter, lon, lat))

    rows = cur.fetchall()  # getting all matching building rows

    cur.close()  # closing cursor
    conn.close()  # closing database connection

    return rows_to_buildings(rows)  # converting SQL rows into dictionaries




# function to query all buildings near a location, without filtering by damage type
# this is used for summaries and advisory questions because those need all damage levels
def get_all_buildings_near(lon, lat, radius_m):
    conn = get_db_connection()  # connecting to database
    cur = conn.cursor()  # creating cursor to run SQL

    # SQL query using spatial filtering only
    # b.uid is the building UID used by the frontend route
    # ip.xbd_id is the xBD image pair id used by the frontend route
    # b.predicted_damage is used for summaries and color-coding
    # ST_AsGeoJSON converts the building polygon into GeoJSON text
    query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE ST_DWithin(
        b.geom::geography,
        ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
        %s
    )
    ORDER BY ST_Distance(
        b.geom::geography,
        ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
    ) ASC
    """

    cur.execute(query, (lon, lat, radius_m, lon, lat))  # safely passing lon, lat, and radius into SQL
    rows = cur.fetchall()  # getting all matching nearby buildings

    cur.close()  
    conn.close()  # closing database connection

    return rows_to_buildings(rows)  # converting SQL rows into frontend-friendly dictionaries


def get_buildings_in_bbox(min_lon, min_lat, max_lon, max_lat, damage_filter):
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE b.predicted_damage = %s
      AND ST_Intersects(
        b.geom,
        ST_MakeEnvelope(%s, %s, %s, %s, 4326)
      )
    """

    cur.execute(query, (damage_filter, min_lon, min_lat, max_lon, max_lat))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


def get_all_buildings_in_bbox(min_lon, min_lat, max_lon, max_lat):
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE ST_Intersects(
        b.geom,
        ST_MakeEnvelope(%s, %s, %s, %s, 4326)
    )
    """

    cur.execute(query, (min_lon, min_lat, max_lon, max_lat))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


def fetch_city_damage_stats(limit=20):
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT
      TRIM(SPLIT_PART(b.address, ',', 2)) AS city,
      COUNT(*) AS total,
      SUM(CASE WHEN b.predicted_damage = 'no-damage' THEN 1 ELSE 0 END) AS no_damage,
      SUM(CASE WHEN b.predicted_damage = 'minor-damage' THEN 1 ELSE 0 END) AS minor_damage,
      SUM(CASE WHEN b.predicted_damage = 'major-damage' THEN 1 ELSE 0 END) AS major_damage,
      SUM(CASE WHEN b.predicted_damage = 'destroyed' THEN 1 ELSE 0 END) AS destroyed
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    JOIN disasters d ON ip.disaster_id = d.id
    WHERE b.address IS NOT NULL
      AND d.name = %s
      AND POSITION(',' IN b.address) > 0
      AND POSITION(',' IN SUBSTRING(b.address FROM POSITION(',' IN b.address) + 1)) > 0
    GROUP BY TRIM(SPLIT_PART(b.address, ',', 2))
    HAVING TRIM(SPLIT_PART(b.address, ',', 2)) <> ''
    ORDER BY total DESC, city ASC
    LIMIT %s
    """

    cur.execute(query, (DEFAULT_DISASTER_NAME, limit))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows


def resolve_location_buildings(location_text):
    normalized_location = location_text.strip()
    has_explicit_region = "," in normalized_location
    geocode_query = normalized_location

    if not has_explicit_region:
        buildings = get_all_buildings_by_address_text(normalized_location)
        if len(buildings) > 0:
            return None, normalized_location, buildings
        if DEFAULT_DISASTER_NAME == "hurricane-harvey":
            geocode_query = f"{normalized_location}, Texas"

    geo = geocode_address(geocode_query)
    buildings = []

    if geo and geo.get("bbox") and len(geo["bbox"]) == 4:
        min_lon, min_lat, max_lon, max_lat = geo["bbox"]
        buildings = get_all_buildings_in_bbox(min_lon, min_lat, max_lon, max_lat)

    if len(buildings) == 0:
        buildings = get_all_buildings_by_address_text(normalized_location)

    if len(buildings) > 0 and not has_explicit_region:
        label_text = normalized_location
    else:
        label_text = geo["formatted_address"] if geo else normalized_location

    return geo, label_text, buildings


def filter_buildings_by_damage(buildings, damage_type):
    return [b for b in buildings if b.get("damage") == damage_type]


def extract_percentage_location_text(question):
    patterns = [
        r"percentage of\s+(.+?)\s+buildings",
        r"share of\s+(.+?)\s+buildings",
        r"what percentage of\s+(.+?)\s+is",
        r"what percent of\s+(.+?)\s+is",
    ]

    for pattern in patterns:
        match = re.search(pattern, question, flags=re.IGNORECASE)
        if not match:
            continue
        location_text = match.group(1).strip(" ?,.")
        return location_text or None

    return None


def extract_comparison_locations(question):
    patterns = [
        r"compare\s+(.+?)\s+and\s+(.+?)(?:\?|$)",
        r"compare\s+(.+?)\s+to\s+(.+?)(?:\?|$)",
        r"which is worse,\s+(.+?)\s+or\s+(.+?)(?:\?|$)",
        r"which is worse:\s+(.+?)\s+or\s+(.+?)(?:\?|$)",
    ]

    for pattern in patterns:
        match = re.search(pattern, question, flags=re.IGNORECASE)
        if not match:
            continue
        first = match.group(1).strip(" ?,.")
        second = match.group(2).strip(" ?,.")
        if first and second:
            return first, second

    return None


def is_city_comparison_query(question):
    q = question.lower()
    return "compare " in q or "which is worse" in q


def is_city_ranking_query(question):
    q = question.lower()
    ranking_signals = [
        "top ",
        "most ",
        "least ",
        "hardest-hit",
        "hardest hit",
        "hit hardest",
        "where is major damage concentrated",
        "which cities have",
        "what areas have",
    ]
    return any(signal in q for signal in ranking_signals)


def extract_top_n(question, default=5):
    match = re.search(r"\btop\s+(\d+)\b", question, flags=re.IGNORECASE)
    if not match:
        return default
    try:
        return max(1, min(int(match.group(1)), 10))
    except ValueError:
        return default


def get_ranking_metric(question):
    q = question.lower()
    if any(term in q for term in ["destroyed", "hardest-hit", "hardest hit", "hit hardest"]):
        return "destroyed"
    if "major" in q:
        return "major-damage"
    if "minor" in q:
        return "minor-damage"
    if any(term in q for term in ["no damage", "no-damage", "undamaged", "least damage"]):
        return "no-damage"
    return "total"


def sort_city_rows(rows, metric):
    metric_index = {
        "total": 1,
        "no-damage": 2,
        "minor-damage": 3,
        "major-damage": 4,
        "destroyed": 5,
    }[metric]
    return sorted(rows, key=lambda row: (-row[metric_index], row[0]))


def format_city_ranking(rows, metric, limit):
    if len(rows) == 0:
        return "I couldn't find any city-level data for the active disaster dataset."

    sorted_rows = sort_city_rows(rows, metric)[:limit]
    metric_label = {
        "total": "total buildings",
        "no-damage": "no-damage buildings",
        "minor-damage": "minor-damage buildings",
        "major-damage": "major-damage buildings",
        "destroyed": "destroyed buildings",
    }[metric]

    lines = [f"Top cities by {metric_label}:"]
    for row in sorted_rows:
        city = row[0]
        value = row[{ "total": 1, "no-damage": 2, "minor-damage": 3, "major-damage": 4, "destroyed": 5 }[metric]]
        total = row[1]
        lines.append(f"- {city}: {value} {metric_label}, {total} total")

    return "\n".join(lines)


def format_percentage_response(location_text, damage_type, total, matching_total):
    if total == 0:
        return f"I couldn't find damage assessment data for {location_text}."

    percentage = round((matching_total / total) * 100, 1)
    damage_label = damage_type.replace("-", " ")

    lines = [
        f"Here's the percentage breakdown for {location_text}:",
        f"- Total buildings: {total}",
        f"- {damage_label.title()}: {matching_total}",
        f"- Share of total: {percentage}%",
    ]
    return "\n".join(lines)


def format_location_comparison(first_label, first_buildings, second_label, second_buildings):
    first_counts = count_damage_levels(first_buildings)
    second_counts = count_damage_levels(second_buildings)
    first_total = sum(first_counts.values())
    second_total = sum(second_counts.values())
    first_severe = first_counts.get("major-damage", 0) + first_counts.get("destroyed", 0)
    second_severe = second_counts.get("major-damage", 0) + second_counts.get("destroyed", 0)

    if first_total == 0 and second_total == 0:
        return "I couldn't find damage assessment data for either location."

    if first_total == 0:
        return f"I couldn't find damage assessment data for {first_label}, but I did for {second_label}."

    if second_total == 0:
        return f"I couldn't find damage assessment data for {second_label}, but I did for {first_label}."

    if first_severe > second_severe:
        worse_line = f"- Higher severe-damage load: {first_label}"
    elif second_severe > first_severe:
        worse_line = f"- Higher severe-damage load: {second_label}"
    else:
        worse_line = "- Higher severe-damage load: tied"

    lines = [
        f"Comparison of {first_label} and {second_label}:",
        f"- {first_label}: {first_total} total, {first_counts.get('major-damage', 0)} major-damage, {first_counts.get('destroyed', 0)} destroyed",
        f"- {second_label}: {second_total} total, {second_counts.get('major-damage', 0)} major-damage, {second_counts.get('destroyed', 0)} destroyed",
        worse_line,
    ]
    return "\n".join(lines)


def normalize_street_query_parts(address_text):
    parts = [part.strip() for part in address_text.split(",") if part.strip()]
    if not parts:
        return []

    normalized_parts = []
    for index, part in enumerate(parts):
        lower_part = part.lower()
        if lower_part in {"united states", "usa", "us"}:
            continue
        if index == 0:
            normalized_parts.append(part)
            continue
        zip_match = re.search(r"\b\d{5}\b", part)
        if zip_match:
            normalized_parts.append(zip_match.group(0))
        elif lower_part == "texas":
            normalized_parts.append("Texas")
        elif lower_part == "tx":
            normalized_parts.append("TX")
        else:
            normalized_parts.append(part)

    return normalized_parts


def get_buildings_on_address_text(address_text, damage_filter=None):
    conn = get_db_connection()
    cur = conn.cursor()

    address_parts = normalize_street_query_parts(address_text)
    if not address_parts:
        return []

    street_part = address_parts[0]
    street_core = re.sub(
        r"\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|way)\b",
        "",
        street_part,
        flags=re.IGNORECASE,
    ).strip()
    city_part = address_parts[1] if len(address_parts) > 1 else None
    state_or_zip_parts = address_parts[2:]

    base_query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE b.address IS NOT NULL
    """

    strict_query = base_query
    strict_params = []
    for part in address_parts:
        strict_query += " AND b.address ILIKE %s"
        strict_params.append(f"%{part}%")
    if damage_filter:
        strict_query += " AND b.predicted_damage = %s"
        strict_params.append(damage_filter)

    cur.execute(strict_query, tuple(strict_params))
    rows = cur.fetchall()

    if len(rows) == 0:
        relaxed_query = base_query
        relaxed_params = []

        if street_core:
            relaxed_query += " AND b.address ILIKE %s"
            relaxed_params.append(f"%{street_core}%")
        else:
            relaxed_query += " AND b.address ILIKE %s"
            relaxed_params.append(f"%{street_part}%")

        if city_part:
            relaxed_query += " AND b.address ILIKE %s"
            relaxed_params.append(f"%{city_part}%")

        for part in state_or_zip_parts:
            if re.fullmatch(r"\d{5}", part):
                continue
            relaxed_query += " AND b.address ILIKE %s"
            relaxed_params.append(f"%{part}%")

        if damage_filter:
            relaxed_query += " AND b.predicted_damage = %s"
            relaxed_params.append(damage_filter)

        cur.execute(relaxed_query, tuple(relaxed_params))
        rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


def get_buildings_by_address_text(address_text, damage_filter):
    conn = get_db_connection()
    cur = conn.cursor()

    address_clean = address_text.strip()
    address_parts = [part.strip() for part in address_clean.split(",") if part.strip()]
    city_part = address_parts[0] if len(address_parts) > 0 else address_clean
    region_part = address_parts[1] if len(address_parts) > 1 else None
    region_aliases: dict[str, list[str]] = {
        "texas": ["texas", "tx"],
    }
    city_pattern = re.escape(city_part)
    region_values: list[str] = []
    if region_part:
        normalized_region_part = str(region_part)
        region_values = region_aliases.get(
            normalized_region_part.lower(),
            [normalized_region_part],
        )
    region_patterns = [re.escape(alias) for alias in region_values]
    city_state_pattern = (
        rf"\b{city_pattern}\b(?:\s*,\s*|\s+)(?:{'|'.join(region_patterns)})\b"
        if region_patterns
        else rf"\b{city_pattern}\b"
    )

    query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE b.address IS NOT NULL
      AND b.address ~* %s
      AND b.predicted_damage = %s
    """
    params = [city_state_pattern, damage_filter]

    cur.execute(query, tuple(params))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


def get_all_buildings_by_address_text(address_text):
    conn = get_db_connection()
    cur = conn.cursor()

    address_clean = address_text.strip()
    address_parts = [part.strip() for part in address_clean.split(",") if part.strip()]
    city_part = address_parts[0] if len(address_parts) > 0 else address_clean
    region_part = address_parts[1] if len(address_parts) > 1 else None
    region_aliases: dict[str, list[str]] = {
        "texas": ["texas", "tx"],
    }
    city_pattern = re.escape(city_part)
    region_values: list[str] = []
    if region_part:
        normalized_region_part = str(region_part)
        region_values = region_aliases.get(
            normalized_region_part.lower(),
            [normalized_region_part],
        )
    region_patterns = [re.escape(alias) for alias in region_values]
    city_state_pattern = (
        rf"\b{city_pattern}\b(?:\s*,\s*|\s+)(?:{'|'.join(region_patterns)})\b"
        if region_patterns
        else rf"\b{city_pattern}\b"
    )

    query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE b.address IS NOT NULL
      AND b.address ~* %s
    """
    params = [city_state_pattern]

    cur.execute(query, tuple(params))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


def build_map_action_from_buildings(buildings, address_text=None, primary_xbd_id=None):
    primary_xbd_id = primary_xbd_id if primary_xbd_id is not None else get_primary_xbd_id(buildings)

    return {
        "type": "navigate",
        "target": "map",
        "reason": "address_query" if address_text else "building_query",
        "url": build_map_route(DEFAULT_DISASTER_NAME, primary_xbd_id),
        "params": {
            "disaster_name": DEFAULT_DISASTER_NAME,
            "xbd_id": primary_xbd_id,
            "address": address_text,
            "building_ids": [b["uid"] for b in buildings],
        }
    }


def get_primary_xbd_id(buildings):
    xbd_ids = sorted({
        building.get("xbd_id")
        for building in buildings
        if building.get("xbd_id") is not None
    })

    if not xbd_ids:
        return None

    return random.choice(xbd_ids)


def get_dominant_xbd_id(buildings):
    counts: dict[int, int] = {}

    for building in buildings:
        xbd_id = building.get("xbd_id")
        if xbd_id is None:
            continue
        counts[xbd_id] = counts.get(xbd_id, 0) + 1

    if not counts:
        return None

    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]


def get_nearest_xbd_id(buildings):
    for building in buildings:
        xbd_id = building.get("xbd_id")
        if xbd_id is not None:
            return xbd_id
    return None


def is_all_buildings_query(question):
    q = question.lower()
    return any(phrase in q for phrase in [
        "all buildings",
        "all properties",
        "all records",
        "all damage levels",
    ])


def get_buildings_for_primary_scene(buildings, primary_xbd_id=None):
    primary_xbd_id = primary_xbd_id if primary_xbd_id is not None else get_primary_xbd_id(buildings)
    if primary_xbd_id is None:
        return []

    return [b for b in buildings if b.get("xbd_id") == primary_xbd_id]




def get_full_dataset_damage_counts():
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT predicted_damage, COUNT(*)
    FROM buildings
    GROUP BY predicted_damage
    """

    cur.execute(query)
    rows = cur.fetchall()

    cur.close()
    conn.close()

    counts = {
        "no-damage": 0,
        "minor-damage": 0,
        "major-damage": 0,
        "destroyed": 0
    }

    for damage, count in rows:
        counts[damage] = count

    return counts


def count_damage_levels(buildings):
    counts = {
        "no-damage": 0,
        "minor-damage": 0,
        "major-damage": 0,
        "destroyed": 0
    }

    for b in buildings:
        damage = b["damage"]
        counts[damage] = counts.get(damage, 0) + 1

    return counts


def format_damage_count_response(counts, location_text):
    total = sum(counts.values())

    if total == 0:
        return f"I couldn't find damage assessment data for {location_text}."

    known_total = (
        counts.get("no-damage", 0)
        + counts.get("minor-damage", 0)
        + counts.get("major-damage", 0)
        + counts.get("destroyed", 0)
    )

    other_total = total - known_total

    response = (
        f"For {location_text}, I found {total} buildings total: "
        f"{counts.get('no-damage', 0)} no-damage, "
        f"{counts.get('minor-damage', 0)} minor-damage, "
        f"{counts.get('major-damage', 0)} major-damage, and "
        f"{counts.get('destroyed', 0)} destroyed"
    )

    if other_total > 0:
        response += f", with {other_total} other or unlabeled records"

    return response + "."


def format_damage_bullet_summary(counts, location_text):
    total = sum(counts.values())

    if total == 0:
        return f"I couldn't find damage assessment data for {location_text}."

    known_total = (
        counts.get("no-damage", 0)
        + counts.get("minor-damage", 0)
        + counts.get("major-damage", 0)
        + counts.get("destroyed", 0)
    )
    other_total = total - known_total

    lines = [
        f"Here's the dataset summary for {location_text}:",
        f"- Total buildings: {total}",
        f"- No damage: {counts.get('no-damage', 0)}",
        f"- Minor damage: {counts.get('minor-damage', 0)}",
        f"- Major damage: {counts.get('major-damage', 0)}",
        f"- Destroyed: {counts.get('destroyed', 0)}",
    ]

    if other_total > 0:
        lines.append(f"- Other or unlabeled: {other_total}")

    return "\n".join(lines)




# function used when there is no frontend navigation action
# this keeps the response format consistent for every chatbot answer
def build_no_action():
    return {
        "type": "none",  # tells frontend there is no route to open
        "target": None,  # no map/building/image-pair target
        "reason": "no_navigation_target",  # explains why no action is included
        "url": None,  # no URL for frontend to navigate to
        "params": {}  # no route parameters
    }


# function to build the base frontend map route
# frontend route format: /map/:disasterName/:xbd_id
def build_map_route(disaster_name, xbd_id):
    if not disaster_name or not xbd_id:
        return None  # cannot build route if disaster name or xbd_id is missing

    return f"/map/{quote(str(disaster_name))}/{quote(str(xbd_id))}"


# function to build the frontend building route
# frontend route format: /map/:disasterName/:xbd_id?building=:buildingUid
def build_building_route(disaster_name, xbd_id, building_uid):
    base_route = build_map_route(disaster_name, xbd_id)  # create base map route first

    if not base_route or not building_uid:
        return None  # cannot build building route if base route or building uid is missing

    return f"{base_route}?building={quote(str(building_uid))}"


# function to create a navigation action for map-level results
# this is used when the chatbot finds multiple relevant buildings
def build_map_action(geo, buildings):
    xbd_ids = sorted({
        b.get("xbd_id")  # collect xbd_id values from returned buildings
        for b in buildings
        if b.get("xbd_id") is not None  # ignore missing xbd_id values
    })

    primary_xbd_id = xbd_ids[0] if len(xbd_ids) == 1 else get_dominant_xbd_id(buildings)

    return {
        "type": "navigate",  # tells frontend this action should navigate somewhere
        "target": "map",  # frontend should open/focus a map view
        "reason": "location_or_damage_query",  # explains why this action exists
        "url": build_map_route(DEFAULT_DISASTER_NAME, primary_xbd_id),  # route if one xbd_id is clear
        "params": {
            "disaster_name": DEFAULT_DISASTER_NAME,  # disaster name used by frontend route
            "xbd_id": primary_xbd_id,  # xBD scene id, if one clear scene exists
            "lat": geo["lat"],  # latitude for map focus
            "lon": geo["lon"],  # longitude for map focus
            "address": geo["formatted_address"],  # readable location name
            "building_ids": [b["uid"] for b in buildings]  # matching building UIDs for highlighting
        }
    }


# function to create a navigation action for one specific building
# this is used when the chatbot result clearly identifies one building
def build_building_action(building):
    return {
        "type": "navigate",  # tells frontend to navigate
        "target": "building",  # frontend should open/focus a building view
        "reason": "single_building_match",  # explains why this is building-level
        "url": build_building_route(
            DEFAULT_DISASTER_NAME,  # disaster name used by frontend route
            building.get("xbd_id"),  # xBD scene id for this building
            building.get("uid")  # building UID for the query parameter
        ),
        "params": {
            "disaster_name": DEFAULT_DISASTER_NAME,  # disaster name for route
            "xbd_id": building.get("xbd_id"),  # xBD scene id for route
            "building_uid": building.get("uid"),  # building UID for route
            "damage": building.get("damage")  # damage label for frontend context
        }
    }


# FRONTEND MAP / ROUTING HANDOFF:
# Frontend can use:
#   answer/response -> chatbot text
#   focus -> zoom or pan map
#   highlighted_buildings -> draw/highlight building polygons
#   action -> navigate to map/building route
def build_map_payload(answer, geo, buildings, action=None):
    return {
        "answer": answer,  # chatbot answer text
        "response": answer,  # duplicate key in case frontend expects "response"
        "focus": {
            "lat": geo["lat"],  # latitude for map focus
            "lon": geo["lon"],  # longitude for map focus
            "address": geo["formatted_address"]  # readable address/location
        },
        "highlighted_buildings": buildings,  # building objects for frontend highlighting
        "action": action or build_no_action()  # navigation instruction for frontend
    }


# Testing purpose only
def print_map_payload_preview(payload):
    print("[Map Focus]")
    print(f"Address: {payload['focus']['address']}")
    print(f"Lat/Lon: {payload['focus']['lat']}, {payload['focus']['lon']}")
    print(f"Buildings to highlight: {len(payload['highlighted_buildings'])}")

    for b in payload["highlighted_buildings"][:5]:
        print(f"  - Building ID: {b['id']}, Damage: {b['damage']}")

# ///////////////////////// #




# function to call NVIDIA Nemotron API
def call_nemotron(prompt):

    url = os.getenv("NEMOTRON_URL")  # API endpoint
    api_key = os.getenv("NEMOTRON_API_KEY")  # API key

    # checking if config exists
    if not url or not api_key:
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # send only the current prompt to Nemotron
    # save_turn() already handles chatbot conversation history separately
    messages = [
        {"role": "user", "content": prompt}
    ]

    payload = {
        "model": "mistralai/mistral-nemotron",
        "messages": messages,
        "max_tokens": 300
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)

        if response.status_code != 200:
            return None

        data = response.json()
        content = data["choices"][0]["message"]["content"].strip('"')
        return content if content else None
    except Exception:
        return None


def fallback_damage_answer(total, address, damage_type):
    clean_damage = damage_type.replace("-", " ")
    building_label = "building" if total == 1 else "buildings"
    return f"I found {total} {clean_damage} {building_label} near {address}."


def fallback_advisory_response(buildings, address):
    counts = count_damage_levels(buildings)
    total = sum(counts.values())
    severe_total = counts.get("major-damage", 0) + counts.get("destroyed", 0)

    if total == 0:
        return f"I couldn't find enough nearby damage data to assess conditions around {address}."
    if severe_total > 0:
        return (
            f"Damage near {address} includes {severe_total} severely affected buildings, "
            "so responders should expect disrupted conditions and verify access before deployment."
        )
    return (
        f"Damage near {address} appears limited in this dataset, but field conditions should still be "
        "verified before making operational decisions."
    )


def fallback_damage_summary(buildings, address):
    counts = count_damage_levels(buildings)
    total = sum(counts.values())

    if total == 0:
        return f"I couldn't find damage assessment data for {address}."

    return (
        f"For {address}, I found {total} buildings total: "
        f"{counts.get('no-damage', 0)} no-damage, "
        f"{counts.get('minor-damage', 0)} minor-damage, "
        f"{counts.get('major-damage', 0)} major-damage, and "
        f"{counts.get('destroyed', 0)} destroyed."
    )




# creating custom LLM wrapper for llamaindex
class NemotronLLM(CustomLLM):

    @property
    def metadata(self):
        return {
            "context_window": 4096,
            "num_output": 256,
            "model_name": "nemotron"
        }

    def complete(self, prompt, **kwargs):
        result = call_nemotron(prompt) or ""
        return CompletionResponse(text=result)

    def stream_complete(self, prompt, **kwargs):
        yield CompletionResponse(text=self.complete(prompt).text)


    

# registering LLM inside llamaindex
Settings.llm = NemotronLLM()




# function to generate final AI answer using LLM
def generate_llm_answer(buildings, address, damage_type):

    total = len(buildings)
    clean_damage = damage_type.replace("-", " ")

    prompt = f"""
You are Hazardly, a disaster damage assessment chatbot.

Use the exact facts below:
Location: {address}
Damage type: {clean_damage}
Number of buildings: {total}

Write one short, clear sentence for the user.

Rules:
- Do NOT mention VLM, model, prediction data, database, SQL, backend, or LLM.
- Do NOT change the number.
- Do NOT add extra numbers.
- Do NOT say the area is completely safe.
- Sound professional and natural.
"""

    result = str(Settings.llm.complete(prompt)).strip('"').split(")*")[0].strip()
    if not result:
        return fallback_damage_answer(total, address, damage_type)
    return result


def is_disaster_related(question):

    q = question.lower()

    keywords = [
        # damage + building
        "damage", "building", "structure", "collapse", "destruction", "minor", "major", "destroyed",

        # disaster types
        "disaster", "hurricane", "flood", "earthquake", "storm", "harvey", "natural disaster",

        # safety + advisory
        "safe", "danger", "risk", "travel", "evacuate", "return", "inspection",

        # repair + recovery
        "repair", "fix", "rebuild", "reconstruct", "recovery", "restoration", "infrastructure",

        # data / queries
        "how many", "count", "stats", "analysis", "impact", "dataset", "full dataset", "all buildings",

        # location words
        "near", "area", "region", "city", "street",

        # image / VLM related
        "image", "photo", "picture", "pre", "post", "before", "after", "compare", "upload", "evaluate"
    ]

    return any(k in q for k in keywords)


def is_vlm_query(q):

    q = q.lower()
    return any(k in q for k in [
        "image", "images", "photo", "picture", "upload image", "upload photo",
        "compare images", "pre-disaster image", "post-disaster image",
        "before image", "after image", "evaluate image" , "evaluate photo", "evaluate picture"
    ])
  

def vlm_guidance_response():

    return (
        "To evaluate damage using images, please upload a pre-disaster and post-disaster image pair "
        "in the VLM Evaluation page. The system will analyze the images and classify the damage level "
        "(No Damage, Minor, Major, or Destroyed)."
    )


def is_data_summary_query(question):
    q = question.lower()
    return any(k in q for k in [
        "summary of damage", "summarize damage", "how bad", "overall damage", "damage summary",
        "summarize the situation", "overview of damage", "damage situation", "damage breakdown","damage levels"
    ])


def is_full_dataset_query(question):
    q = question.lower()
    has_dataset_phrase = any(k in q for k in [
        "full dataset",
        "whole dataset",
        "entire dataset",
        "all buildings",
        "overall dataset",
        "dataset summary",
        "overall damage in the dataset"
    ])
    if not has_dataset_phrase:
        return False

    scoped_location_phrases = [" near ", " in ", " on ", " around ", " at "]
    return not any(phrase in q for phrase in scoped_location_phrases)


def is_conversation_summary_query(question):
    q = question.lower()
    return any(k in q for k in [
        "summarize conversation",
        "what have we discussed",
        "recap",
        "conversation summary"
        
    ])


def is_city_list_query(question):
    q = question.lower()
    return any(k in q for k in [
        "what cities are in the dataset",
        "which cities are in the dataset",
        "what cities are in the data",
        "which cities are in the data",
        "what cities are in data",
        "which cities are in data",
        "what cities are affected",
        "which cities were affected",
        "what cities were affected",
        "which cities are affected",
        "list the affected cities",
        "list cities in the dataset",
        "list cities in the data",
        "what locations are in the dataset",
        "what locations are in the data",
    ])


def is_city_count_query(question):
    q = question.lower()
    return any(k in q for k in [
        "how many cities are represented",
        "how many cities are in the data",
        "how many cities are in the dataset",
        "how many locations are in the data",
        "how many locations are in the dataset",
    ])


def is_damage_label_query(question):
    q = question.lower()
    return any(k in q for k in [
        "what kinds of damage labels exist",
        "what damage labels exist",
        "what damage levels exist",
        "what labels are in the dataset",
    ])


def format_city_damage_stats(rows):
    if len(rows) == 0:
        return "I couldn't find any city-level address data in the dataset."

    summary_parts = []
    for row in rows[:8]:
        city = row[0]
        total = row[1]
        destroyed = row[5]
        major = row[4]
        summary_parts.append(
            f"{city} ({total} total, {major} major-damage, {destroyed} destroyed)"
        )

    return "Cities in the dataset include: " + "; ".join(summary_parts) + "."

def summarize_damage_data(buildings, address):

    counts = {}

    for b in buildings:
        d = b["damage"]
        counts[d] = counts.get(d, 0) + 1

    prompt = f"""
You are summarizing disaster damage data.

Location: {address}
Damage breakdown: {counts}

Write a short, clear summary of the situation.

- Do NOT say "assistant"
- Do NOT refer to yourself
- Speak directly
- Describe severity and impact

Keep it 1–2 sentences.
"""

    return call_nemotron(prompt) or fallback_damage_summary(buildings, address)


def summarize_conversation():

    if len(chat_history) == 0:
        return "No conversation to summarize yet."

    recent_text = "\n".join([
        f"{m['role']}: {m['content']}"
        for m in chat_history[-20:]
    ])

    prompt = f"""
You are Hazardly, a disaster damage assessment chatbot.

Summarize only the actual user and chatbot conversation below.
Do not mention system instructions, prompt rules, formatting rules, or hidden instructions.

Conversation:
{recent_text}

Write a short plain-English recap in 2-3 sentences.
Do not use bullet points.
"""

    fallback_lines = [
        m["content"]
        for m in chat_history[-6:]
        if m.get("content")
    ]
    fallback = " ".join(fallback_lines)[:280].strip()

    return call_nemotron(prompt) or (
        fallback if fallback else "No conversation to summarize yet."
    )


def fallback_damage_summary(buildings, address):
    counts = count_damage_levels(buildings)
    return format_damage_bullet_summary(counts, address)


def format_city_damage_stats(rows):
    if len(rows) == 0:
        return "I couldn't find any city-level address data in the dataset."

    lines = ["Cities in the dataset include:"]
    for row in rows[:8]:
        city = row[0]
        total = row[1]
        destroyed = row[5]
        major = row[4]
        lines.append(
            f"- {city}: {total} total, {major} major-damage, {destroyed} destroyed"
        )

    return "\n".join(lines)


def summarize_damage_data(buildings, address):
    counts = {}

    for b in buildings:
        d = b["damage"]
        counts[d] = counts.get(d, 0) + 1

    prompt = f"""
You are summarizing disaster damage data.

Location: {address}
Damage breakdown: {counts}

Write a concise summary of the situation.

- Do NOT say "assistant"
- Do NOT refer to yourself
- Speak directly
- Describe severity and impact
- Prefer 3-5 short bullet points when the breakdown is multi-part

Keep it concise.
"""

    return call_nemotron(prompt) or fallback_damage_summary(buildings, address)



# BACKEND HANDLER FOR FRONTEND/API USE
# This function does the same chatbot routing as main(), but returns a JSON-style payload instead of only printing text
# Frontend can use:
#   payload["answer"] -> chatbot message
#   payload["focus"] -> map zoom/pan location
#   payload["highlighted_buildings"] -> building polygons to highlight
def handle_chat_query(question):
    question = question.strip()

    if not question:
        answer = "Please enter a disaster-related question."
        return {
            "answer": answer,
            "response": answer,  # same text for frontend compatibility
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()  # no navigation action
        }

    # detect VLM/image-related queries
    if is_vlm_query(question):
        answer = vlm_guidance_response()
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,  # same text for frontend compatibility
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()  # no navigation action
        }

    # conversation summary
    if is_conversation_summary_query(question):
        answer = summarize_conversation()
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,  # same text for frontend compatibility
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()  # no navigation action
        }

    if is_city_count_query(question):
        rows = fetch_city_damage_stats(limit=500)
        city_total = len(rows)
        answer = (
            f"The active disaster dataset includes {city_total} cities or named locations with address data."
        )
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    if is_damage_label_query(question):
        answer = "\n".join([
            "The dataset uses these damage labels:",
            "- No damage",
            "- Minor damage",
            "- Major damage",
            "- Destroyed",
        ])
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    if is_city_list_query(question):
        rows = fetch_city_damage_stats()
        answer = format_city_damage_stats(rows)
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    if is_city_ranking_query(question):
        rows = fetch_city_damage_stats()
        answer = format_city_ranking(
            rows,
            get_ranking_metric(question),
            extract_top_n(question),
        )
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    comparison_locations = extract_comparison_locations(question)
    if comparison_locations and is_city_comparison_query(question):
        first_location, second_location = comparison_locations
        first_geo, first_label, first_buildings = resolve_location_buildings(first_location)
        second_geo, second_label, second_buildings = resolve_location_buildings(second_location)

        answer = format_location_comparison(
            first_label,
            first_buildings,
            second_label,
            second_buildings,
        )
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    percentage_location_text = extract_percentage_location_text(question)
    if percentage_location_text:
        _, damage_type = parse_question(question)
        geo, label_text, all_buildings = resolve_location_buildings(percentage_location_text)
        matching_buildings = filter_buildings_by_damage(all_buildings, damage_type)
        answer = format_percentage_response(
            label_text,
            damage_type,
            len(all_buildings),
            len(matching_buildings),
        )
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    general_location_text = extract_general_location_text(question)
    if general_location_text:
        geo, label_text, all_buildings = resolve_location_buildings(general_location_text)

        if len(all_buildings) == 0:
            answer = f"I could not find relevant damage data for {general_location_text}."
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action(),
            }

        counts = count_damage_levels(all_buildings)
        answer = format_damage_bullet_summary(counts, label_text)

        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    # block non-disaster queries
    if not is_disaster_related(question):
        answer = "I can only answer disaster-related queries about damage, safety, and assessments."
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,  # same text for frontend compatibility
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()  # no navigation action
        }
            

    # full dataset summary does not have a single map focus
    if is_full_dataset_query(question):
        counts = get_full_dataset_damage_counts()
        answer = format_damage_bullet_summary(counts, "the full dataset")
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,  # same text for frontend compatibility
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()  # full dataset does not navigate to one route
        }

    _, damage_type = parse_question(question)
    wants_all_buildings = is_all_buildings_query(question)

    on_location_text = extract_on_location_text(question)
    if on_location_text and "near" not in question.lower():
        requested_damage = None if wants_all_buildings else damage_type
        buildings = get_buildings_on_address_text(on_location_text, requested_damage)
        primary_xbd_id = get_dominant_xbd_id(buildings)
        scene_buildings = get_buildings_for_primary_scene(buildings, primary_xbd_id)
        geo = geocode_address(on_location_text)

        if len(buildings) == 0:
            answer = f"I could not find relevant damage data for addresses on {on_location_text}."
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": {
                    "lat": geo["lat"],
                    "lon": geo["lon"],
                    "address": geo["formatted_address"]
                } if geo else None,
                "highlighted_buildings": [],
                "action": build_no_action()
            }

        label_text = geo["formatted_address"] if geo else on_location_text
        if wants_all_buildings:
            counts = count_damage_levels(buildings)
            answer = format_damage_bullet_summary(counts, f"addresses on {label_text}")
        elif damage_type == "no-damage":
            answer = f"{len(buildings)} buildings on {label_text} appear to have no visible damage."
        else:
            answer = generate_llm_answer(buildings, label_text, damage_type)

        action = (
            build_building_action(buildings[0])
            if len(buildings) == 1
            else build_map_action_from_buildings(buildings, label_text, primary_xbd_id)
        )

        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": {
                "lat": geo["lat"],
                "lon": geo["lon"],
                "address": geo["formatted_address"]
            } if geo else None,
            "highlighted_buildings": scene_buildings if len(buildings) > 1 else buildings,
            "action": action
        }

    address_filter_text = extract_address_filter_text(question)
    if address_filter_text:
        buildings = get_buildings_by_address_text(address_filter_text, damage_type)
        primary_xbd_id = get_dominant_xbd_id(buildings)
        scene_buildings = get_buildings_for_primary_scene(buildings, primary_xbd_id)
        geo = geocode_address(address_filter_text)

        if len(buildings) == 0:
            answer = f"I could not find relevant damage data for addresses matching {address_filter_text}."
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": {
                    "lat": geo["lat"],
                    "lon": geo["lon"],
                    "address": geo["formatted_address"]
                } if geo else None,
                "highlighted_buildings": [],
                "action": build_no_action()
            }

        label_text = geo["formatted_address"] if geo else address_filter_text
        if damage_type == "no-damage":
            answer = f"{len(buildings)} buildings with addresses matching {label_text} appear to have no visible damage."
        else:
            answer = generate_llm_answer(buildings, label_text, damage_type)

        action = (
            build_building_action(buildings[0])
            if len(buildings) == 1
            else build_map_action_from_buildings(buildings, label_text, primary_xbd_id)
        )

        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": scene_buildings if len(buildings) > 1 else buildings,
            "action": action
        }

    in_location_text = extract_in_location_text(question)
    if in_location_text and "near" not in question.lower():
        geo = geocode_address(in_location_text)
        buildings = []
        if geo and geo.get("bbox") and len(geo["bbox"]) == 4:
            min_lon, min_lat, max_lon, max_lat = geo["bbox"]
            buildings = get_buildings_in_bbox(
                min_lon,
                min_lat,
                max_lon,
                max_lat,
                damage_type,
            )
        if len(buildings) == 0:
            buildings = get_buildings_by_address_text(in_location_text, damage_type)
        primary_xbd_id = get_dominant_xbd_id(buildings)
        scene_buildings = get_buildings_for_primary_scene(buildings, primary_xbd_id)

        if len(buildings) == 0:
            answer = f"I could not find relevant damage data for {in_location_text}."
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action()
            }

        label_text = geo["formatted_address"] if geo else in_location_text
        if damage_type == "no-damage":
            answer = f"{len(buildings)} buildings in {label_text} appear to have no visible damage."
        else:
            answer = generate_llm_answer(buildings, label_text, damage_type)

        action = (
            build_building_action(buildings[0])
            if len(buildings) == 1
            else build_map_action_from_buildings(buildings, label_text, primary_xbd_id)
        )

        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": scene_buildings if len(buildings) > 1 else buildings,
            "action": action
        }

    # location-based queries
    address, damage_type = parse_question(question)
    geo = geocode_address(address)

    if not geo:
        all_buildings = get_all_buildings_by_address_text(address)
        filtered_buildings = [
            b for b in all_buildings
            if b.get("damage") == damage_type
        ]
        primary_all_xbd_id = get_dominant_xbd_id(all_buildings)
        primary_filtered_xbd_id = get_dominant_xbd_id(filtered_buildings)
        scene_all_buildings = get_buildings_for_primary_scene(all_buildings, primary_all_xbd_id)
        scene_filtered_buildings = get_buildings_for_primary_scene(filtered_buildings, primary_filtered_xbd_id)

        if is_data_summary_query(question):
            counts = count_damage_levels(all_buildings)
            answer = format_damage_count_response(counts, address)
            action = (
                build_map_action_from_buildings(all_buildings, address, primary_all_xbd_id)
                if len(all_buildings) > 0
                else build_no_action()
            )
            payload = {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": scene_all_buildings,
                "action": action,
            }
            save_turn(question, answer)
            return payload

        advisory = detect_advisory(question)
        if advisory:
            if len(all_buildings) == 0:
                answer = f"I couldn't find enough nearby damage data to give a reliable advisory for {address}."
                action = build_no_action()
            else:
                answer = advisory_response(question, all_buildings, address)
                action = build_map_action_from_buildings(all_buildings, address, primary_all_xbd_id)

            payload = {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": scene_all_buildings,
                "action": action,
            }
            save_turn(question, answer)
            return payload

        if len(filtered_buildings) == 0:
            answer = "I could not find relevant damage data for that area. Try a different location."
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action()
            }

        if damage_type == "no-damage":
            answer = f"{len(filtered_buildings)} buildings in {address} appear to have no visible damage."
        else:
            answer = generate_llm_answer(filtered_buildings, address, damage_type)

        action = (
            build_building_action(filtered_buildings[0])
            if len(filtered_buildings) == 1
            else build_map_action_from_buildings(filtered_buildings, address, primary_filtered_xbd_id)
        )

        payload = {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": scene_filtered_buildings if len(filtered_buildings) > 1 else filtered_buildings,
            "action": action,
        }
        save_turn(question, answer)
        return payload


    # city/street overall damage summary
    if is_data_summary_query(question):
        all_buildings = get_all_buildings_near(
            geo["lon"],
            geo["lat"],
            5000
        )
        used_address_fallback = len(all_buildings) == 0
        if used_address_fallback:
            all_buildings = get_all_buildings_by_address_text(address)
        primary_all_xbd_id = get_nearest_xbd_id(all_buildings)
        scene_all_buildings = get_buildings_for_primary_scene(all_buildings, primary_all_xbd_id)

        counts = count_damage_levels(all_buildings)

        answer = format_damage_count_response(
            counts,
            geo["formatted_address"]
        )

        # create a map navigation action so frontend can route/focus to the result area
        action = build_map_action_from_buildings(all_buildings, geo["formatted_address"], primary_all_xbd_id)

        # package chatbot answer, map focus, highlighted buildings, and navigation action
        payload = build_map_payload(answer, geo, scene_all_buildings, action)

        save_turn(question, answer)
        return payload

    # advisory questions use all nearby damage levels
    advisory = detect_advisory(question)

    if advisory:
        all_buildings = get_all_buildings_near(
            geo["lon"],
            geo["lat"],
            5000
        )
        used_address_fallback = len(all_buildings) == 0
        if used_address_fallback:
            all_buildings = get_all_buildings_by_address_text(address)
        primary_all_xbd_id = get_nearest_xbd_id(all_buildings)
        scene_all_buildings = get_buildings_for_primary_scene(all_buildings, primary_all_xbd_id)

        if len(all_buildings) == 0:
            answer = "I couldn't find enough nearby damage data to give a reliable advisory for that area."
            action = build_no_action()
        else:
            answer = advisory_response(question, all_buildings, geo["formatted_address"])

            # create a map navigation action because advisory answers still relate to this location
            action = build_map_action_from_buildings(all_buildings, geo["formatted_address"], primary_all_xbd_id)

        # package chatbot answer, map focus, highlighted buildings, and navigation action
        payload = build_map_payload(answer, geo, scene_all_buildings, action)


        save_turn(question, answer)
        return payload

    # exact damage count questions use filtered buildings
    buildings = get_buildings_near(
        geo["lon"],
        geo["lat"],
        5000,
        damage_type
    )
    all_nearby_buildings = get_all_buildings_near(
        geo["lon"],
        geo["lat"],
        5000
    )
    used_address_fallback = len(buildings) == 0
    if used_address_fallback:
        buildings = get_buildings_by_address_text(address, damage_type)
    primary_buildings_xbd_id = (
        get_nearest_xbd_id(all_nearby_buildings)
        if len(all_nearby_buildings) > 0
        else get_nearest_xbd_id(buildings)
    )
    scene_buildings = get_buildings_for_primary_scene(buildings, primary_buildings_xbd_id)
    if len(scene_buildings) == 0:
        primary_buildings_xbd_id = get_nearest_xbd_id(buildings)
        scene_buildings = get_buildings_for_primary_scene(buildings, primary_buildings_xbd_id)

    if len(buildings) == 0:
        answer = "I could not find relevant damage data for that area. Try a different location."
        save_turn(question, answer)
        return {
            "answer": answer,  # chatbot response text
            "response": answer,  # same text for frontend compatibility
            "focus": {
                "lat": geo["lat"],  # latitude of the searched location
                "lon": geo["lon"],  # longitude of the searched location
                "address": geo["formatted_address"]  # readable searched address
            },
            "highlighted_buildings": [],  # no buildings matched
            "action": build_no_action()  # no navigation target because no building was found
        }

    if damage_type == "no-damage":
        answer = f"{len(buildings)} buildings in {geo['formatted_address']} appear to have no visible damage."
    else:
        answer = generate_llm_answer(buildings, geo["formatted_address"], damage_type)

    # if only one building matched, frontend can route directly to that building
    if len(buildings) == 1:
        action = build_building_action(buildings[0])

    # if multiple buildings matched, frontend should route/focus to the map view
    else:
        action = build_map_action_from_buildings(buildings, geo["formatted_address"], primary_buildings_xbd_id)

    # package chatbot answer, map focus, highlighted buildings, and navigation action
    payload = build_map_payload(answer, geo, scene_buildings, action)
    save_turn(question, answer)
    return payload



# MAIN FUNCTION (entry point of program)
def main():

    while True:

        user_input = input("User: ")

        if user_input.lower() in ["exit", "quit", "bye", "goodbye"]:
            print("\nHazardly: Goodbye! Stay safe.")
            break

        questions = [q.strip() for q in user_input.split("\n") if q.strip()]

        for question in questions:
            payload = handle_chat_query(question)
            answer = payload["answer"]

            print(f"\nHazardly: {answer}\n")


if __name__ == "__main__":
    main()
