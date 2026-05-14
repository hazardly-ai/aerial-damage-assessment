# importing libraries needed for database, API calls, and environment variables
from collections import OrderedDict
from contextvars import ContextVar
import logging
import psycopg  # used to connect to PostgreSQL (Supabase)
import requests  # used to make HTTP API calls (Mapbox + Nemotron)
import os  # used to access environment variables
import json  # used to convert GeoJSON text from PostGIS into a real Python dictionary
import re
from pathlib import Path
from urllib.parse import quote  # used to safely encode values inside frontend route URLs
from dotenv import load_dotenv  # used to load .env file

# importing llamaindex components for LLM integration
from llama_index.core import Settings
from llama_index.core.llms import CustomLLM, CompletionResponse



logger = logging.getLogger(__name__)


DEFAULT_CHAT_SESSION_ID = "default"
MAX_CHAT_HISTORY_MESSAGES = 40
MAX_CHAT_HISTORY_SESSIONS = 100
DEFAULT_NEMOTRON_MODEL = "mistralai/mistral-nemotron"
DEFAULT_NEMOTRON_FALLBACK_MODEL = ""
_active_chat_session_id = ContextVar(
    "active_chat_session_id",
    default=DEFAULT_CHAT_SESSION_ID,
)
chat_histories = OrderedDict()


def set_active_chat_session(session_id=None):
    normalized_session_id = str(session_id or DEFAULT_CHAT_SESSION_ID).strip()
    _active_chat_session_id.set(normalized_session_id or DEFAULT_CHAT_SESSION_ID)


def get_chat_history():
    session_id = _active_chat_session_id.get()
    history = chat_histories.get(session_id)
    if history is None:
        history = []
        chat_histories[session_id] = history
    else:
        chat_histories.move_to_end(session_id)

    while len(chat_histories) > MAX_CHAT_HISTORY_SESSIONS:
        chat_histories.popitem(last=False)

    return history


def save_turn(question, answer):
    history = get_chat_history()
    history.append({"role": "user", "content": question})
    history.append({"role": "assistant", "content": answer})
    del history[:-MAX_CHAT_HISTORY_MESSAGES]


def get_last_user_message():
    for message in reversed(get_chat_history()):
        if message.get("role") == "user":
            return message.get("content", "")
    return ""


def get_last_assistant_message():
    for message in reversed(get_chat_history()):
        if message.get("role") == "assistant":
            return message.get("content", "")
    return ""


def is_dataset_scope_followup(question):
    normalized_question = question.strip().lower()
    if normalized_question not in {
        "full",
        "full dataset",
        "dataset",
        "all",
        "entire dataset",
        "the entire dataset",
        "whole dataset",
        "entire data",
        "the entire data",
        "whole data",
    }:
        return False

    last_assistant_message = get_last_assistant_message().lower()
    return "full dataset, or for a specific city or area" in last_assistant_message


def is_location_scope_followup(question):
    normalized_question = question.strip().lower()
    if not normalized_question:
        return False
    if normalized_question in {"full", "full dataset", "dataset", "all"}:
        return False

    last_assistant_message = get_last_assistant_message().lower()
    return "full dataset, or for a specific city or area" in last_assistant_message


def is_scope_clarification_prompt(question):
    normalized_question = re.sub(r"\s+", " ", question.strip().lower()).strip(" ?.")
    return normalized_question == "do you want those results for the full dataset, or for a specific city or area"

# loading environment variables from backend/.env file so secrets are not hardcoded
BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env", override=True)


# default disaster name used when building frontend map routes
# frontend route example: /map/hurricane-harvey/3?building=<building_uid>
# this can be changed later through backend/.env if needed
DEFAULT_DISASTER_NAME = os.getenv("DEFAULT_DISASTER_NAME", "hurricane-harvey")
DEFAULT_QUERY_LOCATION = "Houston, Texas"
STREET_ADDRESS_OVERVIEW_RADIUS_M = 300
EXACT_ADDRESS_OVERVIEW_RADIUS_M = 75
NAMED_LOCATION_OVERVIEW_RADIUS_M = 5000
CITY_METRIC_INDEX = {
    "total": 1,
    "no-damage": 2,
    "minor-damage": 3,
    "major-damage": 4,
    "destroyed": 5,
}
CITY_METRIC_LABEL = {
    "total": "total buildings",
    "no-damage": "undamaged buildings",
    "minor-damage": "minorly damaged buildings",
    "major-damage": "majorly damaged buildings",
    "destroyed": "destroyed buildings",
    "severe-damage": "severely damaged buildings",
    "least-severe-damage": "severely damaged buildings",
}
DAMAGE_LABEL_TEXT = {
    "no-damage": "undamaged",
    "minor-damage": "minor-damage",
    "major-damage": "major-damage",
    "destroyed": "destroyed",
}

# Radius (meters) for point-in-area building lookups in conversational queries,
# including "damage near X" proximity searches.
NEARBY_SEARCH_RADIUS_METERS = 5000

# Canonical damage labels matching the database `damage_level` enum.
DAMAGE_LEVELS = ("no-damage", "minor-damage", "major-damage", "destroyed")

DISASTER_GUIDANCE_TOPICS = {
    "flood": {
        "title": "flood",
        "source": "Ready.gov Floods",
        "url": "https://www.ready.gov/floods",
        "path": BACKEND_DIR / "resources" / "disaster_guidance" / "ready_gov_floods.md",
        "aliases": (
            "flood",
            "flooding",
            "flash flood",
            "floodwater",
            "floodwaters",
        ),
    },
    "hurricane": {
        "title": "hurricane",
        "source": "Ready.gov Hurricanes",
        "url": "https://www.ready.gov/hurricanes",
        "path": BACKEND_DIR / "resources" / "disaster_guidance" / "ready_gov_hurricanes.md",
        "aliases": (
            "hurricane",
            "hurricanes",
            "typhoon",
            "typhoons",
            "tropical storm",
            "storm surge",
        ),
    },
}
DISASTER_GUIDANCE_SAFETY_MESSAGE = (
    "Follow local emergency officials for current instructions, and call 911 for immediate emergencies."
)


def format_radius_label(radius_m):
    if radius_m >= 1000:
        km = radius_m / 1000
        return f"{km:g} km"
    return f"{radius_m} m"


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
            "geometry": geometry,  # GeoJSON polygon object for Mapbox
            "actual_damage": r[4] if len(r) > 4 else None,
            "is_correct": r[5] if len(r) > 5 else None,
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
        damage = None

    # extract location from common location phrases
    location_match = re.search(
        r"\b(?:near|in)\s+(.+?)(?:\?|$)",
        question,
        flags=re.IGNORECASE,
    )

    if location_match:
        address = location_match.group(1).strip()

        for word in ["damage", "damaged", "buildings", "building", "area", "locations", "location"]:
            address = re.sub(rf"\b{word}\b", "", address, flags=re.IGNORECASE).strip()

        address = re.sub(r"\s+", " ", address).strip(" ,?")

        # fix vague location like "me"
        if address in ["me", "here", "my", "", "?"]:
            address = DEFAULT_QUERY_LOCATION

    else:
        address = DEFAULT_QUERY_LOCATION

    if address is not None and not str(address).strip():
        address = None

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
        r"\s+(?:that\s+have|that\s+has|with|showing)\s+.+$",
        "",
        address_text,
        flags=re.IGNORECASE,
    ).strip(" ,")
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
        r"what happened\s+(?:to|in|near|around)\s+(.+?)(?:\?|$)",
        r"give me stats for\s+(.+?)(?:\?|$)",
        r"give me information about\s+(.+?)(?:\?|$)",
        r"overview of\s+(.+?)(?:\?|$)",
        r"(?:damage summary|summary of damage|overall damage|damage breakdown|damage levels)\s+for\s+(.+?)(?:\?|$)",
        r"(?:damage summary|summary of damage|overall damage|damage breakdown|damage levels)\s+near\s+(.+?)(?:\?|$)",
        r"(?:damage summary|summary of damage|overall damage|damage breakdown|damage levels)\s+in\s+(.+?)(?:\?|$)",
    ]

    for pattern in patterns:
        match = re.search(pattern, question, flags=re.IGNORECASE)
        if not match:
            continue
        location_text = match.group(1).strip(" ?,.")
        location_text = re.sub(
            r"^(?:buildings?|properties|records)\s+",
            "",
            location_text,
            flags=re.IGNORECASE,
        ).strip(" ,")
        location_text = re.sub(
            r"\b(damage|damaged|buildings?|properties|records|stats|statistics|information)\b",
            "",
            location_text,
            flags=re.IGNORECASE,
        ).strip(" ,")
        location_text = re.sub(
            r"^(?:that\s+have|that\s+has|with|showing)\s+",
            "",
            location_text,
            flags=re.IGNORECASE,
        ).strip(" ,")
        location_text = re.sub(r"[-\s]+", " ", location_text).strip(" ,.-")
        location_text = re.sub(
            r"^(?:the\s+)?city\s+of\s+",
            "",
            location_text,
            flags=re.IGNORECASE,
        ).strip(" ,")
        if not location_text:
            return None
        if location_text.lower() in {
            "no",
            "non",
            "undamaged",
            "unaffected",
            "destroyed",
            "major",
            "minor",
            "that have minor",
            "that have major",
            "that have destroyed",
            "that have no",
            "have minor",
            "have major",
            "have destroyed",
            "have no",
        }:
            return None
        return location_text or None

    return None




# function to convert address → latitude/longitude using Mapbox API
def looks_like_street_address(location_text):
    normalized = location_text.strip().lower()
    street_markers = [
        "street",
        "st",
        "avenue",
        "ave",
        "road",
        "rd",
        "drive",
        "dr",
        "boulevard",
        "blvd",
        "lane",
        "ln",
        "way",
        "court",
        "ct",
        "place",
        "pl",
        "circle",
        "cir",
        "parkway",
        "pkwy",
        "highway",
        "hwy",
    ]
    has_house_number = bool(re.search(r"\b\d+\b", normalized))
    has_street_marker = any(
        re.search(rf"\b{re.escape(marker)}\b", normalized)
        for marker in street_markers
    )
    return has_house_number or has_street_marker


def looks_like_exact_address(location_text):
    normalized = location_text.strip().lower()
    return looks_like_street_address(normalized) and bool(
        re.search(r"\b\d+\b", normalized)
    )


def geocode_address(address):

    if address is None or not str(address).strip():
        return None

    api_key = os.getenv("MAPBOX_API_KEY") # getting API key
    if not api_key:
        return None

    # Mapbox expects the query segment URL-encoded (spaces, commas, etc.).
    encoded = quote(str(address).strip(), safe="")
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json"

    params = {
        "access_token": api_key,
        "limit": 1  # only need top result
    }

    try:
        # sending request to Mapbox
        response = requests.get(url, timeout=15, params=params)
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError):
        return None

    # if no results found
    features = data.get("features") or []
    if len(features) == 0:
        return None

    feature = features[0]
    if not isinstance(feature, dict):
        return None

    coords = feature.get("center", [])
    if not isinstance(coords, (list, tuple)) or len(coords) < 2:
        return None

    bbox = feature.get("bbox")

    return {
        "lon": coords[0],  # longitude
        "lat": coords[1],  # latitude
        "formatted_address": feature.get("place_name", str(address).strip()),  # clean address
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


def detect_disaster_guidance_topics(question):
    q = question.lower()
    topics = []
    for topic, metadata in DISASTER_GUIDANCE_TOPICS.items():
        if any(alias in q for alias in metadata["aliases"]):
            topics.append(topic)
    return topics


def detect_disaster_guidance_topic(question):
    topics = detect_disaster_guidance_topics(question)
    return topics[0] if topics else None


def detect_disaster_guidance_section(question):
    q = question.lower()

    if any(term in q for term in ["insurance", "claim", "coverage", "nfip"]):
        return "insurance"
    if any(term in q for term in ["resource", "resources", "link", "learn more", "where can i"]):
        return "resources"
    if any(term in q for term in ["alert", "alerts", "warning system", "fema app", "weather radio"]):
        return "alerts"
    if any(term in q for term in ["before", "prepare", "prepared", "preparation", "plan", "supplies", "kit"]):
        return "before"
    if any(term in q for term in ["warning", "during", "evacuate", "evacuation", "shelter", "trapped"]):
        return "during"
    if any(term in q for term in ["after", "cleanup", "clean up", "return home", "recovery", "recover"]):
        return "after"
    return "overview"


def is_general_disaster_guidance_request(question):
    q = question.lower()
    guidance_phrases = [
        "disaster guidance",
        "disaster safety",
        "general disaster",
        "emergency preparedness",
        "emergency plan",
        "ready.gov",
        "ready gov",
        "fema guidance",
        "fema safety",
        "what should i do in a disaster",
        "what do i do in a disaster",
    ]
    return any(phrase in q for phrase in guidance_phrases)


def is_disaster_guidance_query(question):
    q = question.lower()
    topic = detect_disaster_guidance_topic(question)

    if is_general_disaster_guidance_request(question):
        return True

    if not topic:
        return False

    guidance_terms = [
        "what is",
        "what are",
        "tell me about",
        "explain",
        "guidance",
        "fact",
        "facts",
        "info",
        "information",
        "safety",
        "safe",
        "prepare",
        "prepared",
        "preparedness",
        "before",
        "during",
        "after",
        "warning",
        "evacuate",
        "evacuation",
        "shelter",
        "cleanup",
        "clean up",
        "insurance",
        "claim",
        "coverage",
        "resource",
        "resources",
        "link",
        "learn more",
        "where can i",
        "ready.gov",
        "ready gov",
        "fema",
    ]
    data_query_terms = [
        "dataset",
        "scene",
        "xbd",
        "building",
        "buildings",
        "damage count",
        "how many",
        "show",
        "map",
        "classified",
        "predicted",
    ]

    has_guidance_language = any(term in q for term in guidance_terms)
    has_location_data_language = (
        any(term in q for term in ["near ", " in ", " on ", " around ", " at "])
        and any(term in q for term in ["damage", "building", "buildings", "dataset", "scene", "xbd", "classified", "predicted"])
    )
    has_data_language = any(term in q for term in data_query_terms) or has_location_data_language
    if has_data_language and "fema" not in q and "ready" not in q:
        return False
    return has_guidance_language or not has_data_language


def load_disaster_guidance_markdown(topic):
    metadata = DISASTER_GUIDANCE_TOPICS.get(topic)
    if not metadata:
        return ""

    try:
        return metadata["path"].read_text(encoding="utf-8")
    except OSError:
        logger.warning("Could not read disaster guidance markdown for topic %s", topic)
        return ""


def clean_markdown_heading(line):
    return re.sub(r"[*_`#]+", "", line).strip(" :-")


def split_markdown_sections(markdown_text):
    lines = markdown_text.splitlines()
    sections = []
    current_title = "Overview"
    current_lines = []
    index = 0

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        next_line = lines[index + 1].strip() if index + 1 < len(lines) else ""
        is_setext_heading = bool(stripped and re.fullmatch(r"[=-]{3,}", next_line))
        is_atx_heading = stripped.startswith("#")

        if is_atx_heading or is_setext_heading:
            if current_lines:
                sections.append((current_title, "\n".join(current_lines).strip()))
                current_lines = []
            current_title = clean_markdown_heading(stripped)
            index += 2 if is_setext_heading else 1
            continue

        current_lines.append(line)
        index += 1

    if current_lines:
        sections.append((current_title, "\n".join(current_lines).strip()))

    return [
        (title, content)
        for title, content in sections
        if content
    ]


def guidance_section_keywords(section):
    return {
        "overview": ["overview", "floods", "hurricanes"],
        "before": ["before", "prepare", "plan", "supplies", "documents"],
        "during": ["during", "warning", "evacuate", "shelter", "trapped"],
        "after": ["after", "cleanup", "return", "recover"],
        "alerts": ["alert", "alerts", "warning", "weather radio", "fema app"],
        "insurance": ["insurance", "claim", "coverage", "nfip"],
        "resources": ["resources", "partner resources", "additional resources"],
    }.get(section, ["overview"])


def select_guidance_sections(markdown_text, section):
    sections = split_markdown_sections(markdown_text)
    keywords = guidance_section_keywords(section)
    selected = []

    for title, content in sections:
        searchable = f"{title}\n{content}".lower()
        if any(keyword in searchable for keyword in keywords):
            selected.append((title, content))

    if not selected:
        selected = sections[:2]

    return selected[:3]


def truncate_context(text, max_chars=6500):
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rsplit("\n", 1)[0].strip()


def build_disaster_guidance_context(question):
    detected_topics = detect_disaster_guidance_topics(question)
    section = detect_disaster_guidance_section(question)
    topics = detected_topics if detected_topics else list(DISASTER_GUIDANCE_TOPICS.keys())
    blocks = []

    for topic_name in topics:
        metadata = DISASTER_GUIDANCE_TOPICS[topic_name]
        markdown_text = load_disaster_guidance_markdown(topic_name)
        if not markdown_text:
            continue

        selected_sections = select_guidance_sections(markdown_text, section)
        section_blocks = [
            f"## {title}\n{content}"
            for title, content in selected_sections
        ]
        blocks.append("\n".join([
            f"Source: {metadata['source']}",
            f"URL: {metadata['url']}",
            *section_blocks,
        ]))

    return truncate_context("\n\n---\n\n".join(blocks))


def disaster_guidance_sources(question):
    detected_topics = detect_disaster_guidance_topics(question)
    topics = detected_topics if detected_topics else list(DISASTER_GUIDANCE_TOPICS.keys())
    return [
        f"{DISASTER_GUIDANCE_TOPICS[topic_name]['source']} ({DISASTER_GUIDANCE_TOPICS[topic_name]['url']})"
        for topic_name in topics
    ]


def fallback_disaster_guidance_response(question, context):
    if not context:
        return (
            "I can answer general disaster guidance questions when the Ready.gov guidance files are available. "
            + DISASTER_GUIDANCE_SAFETY_MESSAGE
        )

    lines = [
        re.sub(r"\s+", " ", line.strip(" *"))
        for line in context.splitlines()
        if line.strip().startswith("*")
    ]
    excerpt_lines = lines[:4]
    if not excerpt_lines:
        excerpt_lines = [
            re.sub(r"\s+", " ", line.strip())
            for line in context.splitlines()
            if line.strip() and not line.startswith(("Source:", "URL:", "##", "---"))
        ][:4]

    sources = "; ".join(disaster_guidance_sources(question))
    return "\n".join([
        "I could not reach the LLM, but these Ready.gov excerpts may help:",
        *[f"- {line}" for line in excerpt_lines],
        DISASTER_GUIDANCE_SAFETY_MESSAGE,
        f"Sources: {sources}.",
    ])


def disaster_guidance_response(question):
    context = build_disaster_guidance_context(question)
    sources = "; ".join(disaster_guidance_sources(question))
    prompt = f"""
You are Hazardly, a disaster damage assessment chatbot.

Answer the user's general disaster guidance question using only the Ready.gov/FEMA source excerpts below.

User question: {question}

Source excerpts:
{context}

Rules:
- Use only the source excerpts. Do not invent guidance.
- Keep the answer concise and practical.
- Prefer 3-5 short bullet points.
- Include "{DISASTER_GUIDANCE_SAFETY_MESSAGE}"
- End with "Sources: {sources}."
- Do not mention prompts, markdown, hidden context, or database details.
"""

    answer = call_nemotron(prompt)
    if not answer:
        return fallback_disaster_guidance_response(question, context)

    cleaned_answer = str(answer).strip().strip('"')
    if DISASTER_GUIDANCE_SAFETY_MESSAGE.lower() not in cleaned_answer.lower():
        cleaned_answer = f"{cleaned_answer}\n{DISASTER_GUIDANCE_SAFETY_MESSAGE}"
    if "sources:" not in cleaned_answer.lower():
        cleaned_answer = f"{cleaned_answer}\nSources: {sources}."
    return cleaned_answer



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
    WITH building_cities AS (
      SELECT
        CASE
          WHEN TRIM(SPLIT_PART(b.address, ',', 2)) ~* '[0-9]'
            OR LOWER(TRIM(SPLIT_PART(b.address, ',', 2))) IN ('texas', 'tx')
          THEN TRIM(SPLIT_PART(b.address, ',', 1))
          ELSE TRIM(SPLIT_PART(b.address, ',', 2))
        END AS city,
        b.predicted_damage
      FROM buildings b
      JOIN image_pairs ip ON b.image_pair_id = ip.id
      JOIN disasters d ON ip.disaster_id = d.id
      WHERE b.address IS NOT NULL
        AND d.name = %s
        AND POSITION(',' IN b.address) > 0
    )
    SELECT
      city,
      COUNT(*) AS total,
      SUM(CASE WHEN predicted_damage = 'no-damage' THEN 1 ELSE 0 END) AS no_damage,
      SUM(CASE WHEN predicted_damage = 'minor-damage' THEN 1 ELSE 0 END) AS minor_damage,
      SUM(CASE WHEN predicted_damage = 'major-damage' THEN 1 ELSE 0 END) AS major_damage,
      SUM(CASE WHEN predicted_damage = 'destroyed' THEN 1 ELSE 0 END) AS destroyed
    FROM building_cities
    WHERE city <> ''
      AND city !~* '^[0-9]+$'
    GROUP BY city
    ORDER BY total DESC, city ASC
    LIMIT %s
    """

    cur.execute(query, (DEFAULT_DISASTER_NAME, limit))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows


def fetch_scene_stats(limit=None):
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT
      ip.xbd_id,
      COUNT(*) AS total_buildings,
      COALESCE(SUM(CASE WHEN b.predicted_damage = 'no-damage' THEN 1 ELSE 0 END), 0) AS no_damage,
      COALESCE(SUM(CASE WHEN b.predicted_damage = 'minor-damage' THEN 1 ELSE 0 END), 0) AS minor_damage,
      COALESCE(SUM(CASE WHEN b.predicted_damage = 'major-damage' THEN 1 ELSE 0 END), 0) AS major_damage,
      COALESCE(SUM(CASE WHEN b.predicted_damage = 'destroyed' THEN 1 ELSE 0 END), 0) AS destroyed,
      COALESCE(SUM(CASE
        WHEN b.predicted_damage IS NOT NULL
         AND b.actual_damage IS NOT NULL
         AND b.actual_damage::text = b.predicted_damage::text
        THEN 1 ELSE 0 END), 0) AS correct_count,
      COALESCE(SUM(CASE
        WHEN b.predicted_damage IS NOT NULL
         AND b.actual_damage IS NOT NULL
        THEN 1 ELSE 0 END), 0) AS compared_count,
      COALESCE(SUM(CASE
        WHEN b.predicted_damage IS NOT NULL
         AND b.actual_damage IS NOT NULL
         AND b.actual_damage::text <> b.predicted_damage::text
        THEN 1 ELSE 0 END), 0) AS incorrect_count
    FROM image_pairs ip
    JOIN disasters d ON ip.disaster_id = d.id
    LEFT JOIN buildings b ON b.image_pair_id = ip.id
    WHERE d.name = %s
    GROUP BY ip.xbd_id
    """

    params = [DEFAULT_DISASTER_NAME]
    if limit is not None:
        query += " ORDER BY ip.xbd_id ASC LIMIT %s"
        params.append(limit)

    cur.execute(query, tuple(params))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows


def fetch_scene_count():
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT COUNT(*)
    FROM image_pairs ip
    JOIN disasters d ON ip.disaster_id = d.id
    WHERE d.name = %s
    """

    cur.execute(query, (DEFAULT_DISASTER_NAME,))
    row = cur.fetchone()

    cur.close()
    conn.close()

    return row[0] if row else 0


def format_city_list_response(rows):
    if len(rows) == 0:
        return "I couldn't find any city-level data for the active disaster dataset."

    city_names = []
    seen = set()
    for row in rows:
        city = str(row[0]).strip()
        if not city or city.lower() in seen:
            continue
        seen.add(city.lower())
        city_names.append(city)

    sample = city_names[:12]
    return "Cities in the dataset are: " + ", ".join(sample) + "."


def clean_city_list_response(answer, fallback, rows):
    if not answer:
        return fallback

    city_names = [str(row[0]).strip() for row in rows if str(row[0]).strip()]
    bad_phrases = [
        "provided facts",
        "following your rules",
        "strictly adhere",
        "plain list",
        "here's a list",
        "here is a list",
    ]

    for line in str(answer).splitlines():
        candidate = line.strip()
        if not candidate:
            continue
        lower_candidate = candidate.lower()
        if any(phrase in lower_candidate for phrase in bad_phrases):
            continue
        if candidate.startswith("[") or candidate.endswith("]"):
            continue
        if any(city.lower() in lower_candidate for city in city_names):
            return candidate

    return fallback


def resolve_location_buildings(location_text):
    normalized_location = location_text.strip()
    has_explicit_region = "," in normalized_location
    geocode_query = normalized_location

    if looks_like_exact_address(normalized_location):
        buildings = get_buildings_on_address_text(normalized_location, None)
        if len(buildings) > 0:
            return None, normalized_location, buildings

    if not has_explicit_region and DEFAULT_DISASTER_NAME == "hurricane-harvey":
        geocode_query = f"{normalized_location}, Texas"

    geo = geocode_address(geocode_query)
    buildings = []

    if geo and looks_like_exact_address(normalized_location):
        buildings = get_all_buildings_near(
            geo["lon"],
            geo["lat"],
            EXACT_ADDRESS_OVERVIEW_RADIUS_M,
        )
    elif geo and looks_like_street_address(normalized_location):
        buildings = get_all_buildings_near(
            geo["lon"],
            geo["lat"],
            STREET_ADDRESS_OVERVIEW_RADIUS_M,
        )
    elif not has_explicit_region and not looks_like_street_address(normalized_location):
        city_label = (
            geo["formatted_address"].split(",")[0].strip()
            if geo and geo.get("formatted_address")
            else normalized_location
        )
        buildings = get_all_buildings_for_city(city_label)
    elif geo and geo.get("bbox") and len(geo["bbox"]) == 4:
        min_lon, min_lat, max_lon, max_lat = geo["bbox"]
        buildings = get_all_buildings_in_bbox(min_lon, min_lat, max_lon, max_lat)

    if len(buildings) == 0:
        buildings = get_all_buildings_by_address_text(normalized_location)

    if len(buildings) > 0 and not has_explicit_region:
        label_text = format_location_label(normalized_location)
    else:
        label_text = (
            format_location_label(geo["formatted_address"])
            if geo and geo.get("formatted_address")
            else format_location_label(normalized_location)
        )

    return geo, label_text, buildings


def filter_buildings_by_damage(buildings, damage_type):
    if damage_type == "damaged":
        return [b for b in buildings if b.get("damage") != "no-damage"]
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
        r"tell me about\s+(.+?)\s+and\s+(.+?)(?:\?|$)",
        r"what about\s+(.+?)\s+and\s+(.+?)(?:\?|$)",
        r"overview of\s+(.+?)\s+and\s+(.+?)(?:\?|$)",
    ]

    for pattern in patterns:
        match = re.search(pattern, question, flags=re.IGNORECASE)
        if not match:
            continue
        first = match.group(1).strip(" ?,.")
        second = match.group(2).strip(" ?,.")
        first = re.sub(
            r"^(?:the\s+)?cities?\s+of\s+",
            "",
            first,
            flags=re.IGNORECASE,
        ).strip(" ,")
        second = re.sub(
            r"^(?:the\s+)?cities?\s+of\s+",
            "",
            second,
            flags=re.IGNORECASE,
        ).strip(" ,")
        if first and second:
            return first, second

    return None


def is_city_comparison_query(question):
    q = question.lower()
    return (
        "compare " in q
        or "which is worse" in q
        or "tell me about" in q
        or "what about" in q
        or "overview of" in q
    )


def is_city_ranking_query(question):
    q = question.lower()
    ranking_signals = [
        "top ",
        "most ",
        "least ",
        "hardest-hit",
        "hardest hit",
        "hit hardest",
        "impacted the most",
        "most impacted",
        "affected the most",
        "most affected",
        "where is major damage concentrated",
        "which cities have",
        "what areas have",
    ]
    return any(signal in q for signal in ranking_signals)


def is_repair_count_query(question):
    q = question.lower()
    return (
        any(term in q for term in ["how many", "count", "number of"])
        and any(term in q for term in ["need repair", "need to be repaired", "repaired", "repair"])
    )


def is_location_damage_display_query(question):
    q = question.lower()
    if extract_xbd_query_id(question) is not None:
        return False
    action_terms = ["show", "show me", "display", "list", "find"]
    if not any(term in q for term in action_terms):
        return False
    if "damage" not in q:
        return False

    return bool(
        extract_on_location_text(question)
        or extract_in_location_text(question)
        or re.search(r"\bnear\s+.+", question, flags=re.IGNORECASE)
    )


def is_scene_count_query(question):
    q = question.lower()
    return (
        "how many scenes" in q
        or "number of scenes" in q
        or "how many xbd scenes" in q
        or "how many image pairs" in q
        or "how many xbd ids" in q
    )


def is_scene_ranking_query(question):
    q = question.lower()
    scene_terms = ["scene", "scenes", "xbd", "image pair", "image pairs"]
    ranking_terms = [
        "worst",
        "best",
        "most",
        "highest",
        "lowest",
        "top",
        "rank",
    ]
    metric_terms = [
        "accuracy",
        "destroyed",
        "major damage",
        "minor damage",
        "incorrect",
        "wrong predictions",
        "misclassified",
    ]
    return (
        any(term in q for term in scene_terms)
        and any(term in q for term in ranking_terms)
        and any(term in q for term in metric_terms)
    )


def is_misclassified_query(question):
    q = question.lower()
    return any(
        term in q
        for term in [
            "misclassified",
            "wrong prediction",
            "wrong predictions",
            "incorrect prediction",
            "incorrect predictions",
            "false positives",
            "false positive",
            "false negatives",
            "false negative",
        ]
    )


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
    if any(term in q for term in ["least damaged", "least damage"]):
        return "least-severe-damage"
    if any(term in q for term in ["destroyed", "hardest-hit", "hardest hit", "hit hardest"]):
        return "destroyed"
    if any(term in q for term in [
        "most damaged",
        "most damage",
        "worst damage",
        "worst damaged",
        "impacted the most",
        "most impacted",
        "affected the most",
        "most affected",
    ]):
        return "severe-damage"
    if "major" in q:
        return "major-damage"
    if "minor" in q:
        return "minor-damage"
    if any(term in q for term in [
        "no damage",
        "no-damage",
        "undamaged",
        "non-damaged",
        "non damaged",
        "not damaged",
    ]):
        return "no-damage"
    return "total"


def get_scene_ranking_metric(question):
    q = question.lower()
    if "accuracy" in q:
        return "accuracy"
    if any(term in q for term in ["incorrect", "wrong prediction", "wrong predictions", "misclassified"]):
        return "incorrect_count"
    if "destroyed" in q:
        return "destroyed"
    if "major" in q:
        return "major_damage"
    if "minor" in q:
        return "minor_damage"
    return "destroyed"


def sort_scene_rows(rows, metric):
    def sort_key(row):
        xbd_id, total, _no_damage, minor, major, destroyed, correct, compared, incorrect = row
        accuracy = (correct / compared) if compared else None

        values = {
            "destroyed": destroyed,
            "major_damage": major,
            "minor_damage": minor,
            "incorrect_count": incorrect,
            "accuracy": accuracy if accuracy is not None else 2,
        }
        primary = values[metric]
        if metric == "accuracy":
            return (primary, -compared, xbd_id)
        return (-primary, -total, xbd_id)

    return sorted(rows, key=sort_key)


def format_scene_count_response(total_scenes):
    return f"The active disaster dataset includes {total_scenes} xBD scenes/image pairs."


def format_scene_label(scene_id):
    return f"Scene {scene_id}"


def format_damage_class_label(damage_type):
    labels = {
        "no-damage": "no visible damage",
        "minor-damage": "minor-damage",
        "major-damage": "major-damage",
        "destroyed": "destroyed",
    }
    return labels.get(damage_type, str(damage_type).replace("-", " "))


def format_scene_damage_answer(scene_label, building_count, damage_type):
    building_label = "building" if building_count == 1 else "buildings"
    damage_label = format_damage_class_label(damage_type)

    if damage_type == "no-damage":
        return (
            f"{scene_label} contains {building_count} {building_label} classified as "
            "no visible damage in the active dataset."
        )

    return (
        f"{scene_label} contains {building_count} {building_label} classified as "
        f"{damage_label} in the active dataset."
    )


def format_scene_ranking(rows, metric, limit):
    if len(rows) == 0:
        return "I couldn't find any scene-level data for the active disaster dataset."

    sorted_rows = sort_scene_rows(rows, metric)
    limited_rows = sorted_rows[:limit]
    metric_label = {
        "destroyed": "destroyed buildings",
        "major_damage": "major-damage buildings",
        "minor_damage": "minor-damage buildings",
        "incorrect_count": "incorrect predictions",
        "accuracy": "lowest accuracy",
    }[metric]

    lines = [f"Top scenes by {metric_label}:"]
    for row in limited_rows:
        xbd_id, total, _no_damage, minor, major, destroyed, correct, compared, incorrect = row
        if metric == "accuracy":
            accuracy_text = "n/a" if compared == 0 else f"{round((correct / compared) * 100, 1)}%"
            lines.append(
                f"- {format_scene_label(xbd_id)}: accuracy {accuracy_text}, {incorrect} incorrect, {total} total"
            )
        else:
            metric_value = {
                "destroyed": destroyed,
                "major_damage": major,
                "minor_damage": minor,
                "incorrect_count": incorrect,
            }[metric]
            lines.append(
                f"- {format_scene_label(xbd_id)}: {metric_value} {metric_label}, {total} total"
            )

    return "\n".join(lines)


def get_top_scene_for_metric(rows, metric):
    sorted_rows = sort_scene_rows(rows, metric)
    return sorted_rows[0] if sorted_rows else None


def sort_city_rows(rows, metric):
    if metric == "severe-damage":
        return sorted(rows, key=lambda row: (-(row[4] + row[5]), -row[1], row[0]))
    if metric == "least-severe-damage":
        return sorted(rows, key=lambda row: (row[4] + row[5], -row[1], row[0]))

    metric_index = CITY_METRIC_INDEX[metric]
    return sorted(rows, key=lambda row: (-row[metric_index], row[0]))


def format_city_ranking(rows, metric, limit):
    if len(rows) == 0:
        return "I couldn't find any city-level data for the active disaster dataset."

    sorted_rows = sort_city_rows(rows, metric)
    limited_rows = sorted_rows[:limit]
    metric_index = (
        None
        if metric in {"severe-damage", "least-severe-damage"}
        else CITY_METRIC_INDEX[metric]
    )
    metric_label = CITY_METRIC_LABEL[metric]

    if metric == "least-severe-damage":
        header = (
            "Cities in the dataset with the fewest severely damaged buildings:"
            if limit >= len(sorted_rows)
            else "Cities with the fewest severely damaged buildings:"
        )
    else:
        header = (
            f"Cities in the dataset by {metric_label}:"
            if limit >= len(sorted_rows)
            else f"Top cities by {metric_label}:"
        )

    lines = [header]
    for row in limited_rows:
        city = row[0]
        value = (
            row[4] + row[5]
            if metric in {"severe-damage", "least-severe-damage"}
            else row[metric_index]
        )
        total = row[1]
        lines.append(f"- {city}: {value} {metric_label}, {total} total")

    return "\n".join(lines)


def synthesize_city_ranking_answer(rows, metric, limit):
    return format_city_ranking(rows, metric, limit)


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


def synthesize_percentage_answer(location_text, damage_type, total, matching_total):
    fallback = format_percentage_response(location_text, damage_type, total, matching_total)
    percentage = 0 if total == 0 else round((matching_total / total) * 100, 1)
    prompt = f"""
You are Hazardly, a disaster damage assessment assistant.

Use only these exact facts:
Location: {location_text}
Damage type: {damage_type}
Total buildings: {total}
Matching buildings: {matching_total}
Percentage: {percentage}

Write a concise answer for the user.

Rules:
- Use 2 to 4 short bullet points.
- Keep the counts and percentage exact.
- Do not invent extra numbers.
"""
    return synthesize_structured_answer(prompt, fallback)


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


def synthesize_location_comparison_answer(first_label, first_buildings, second_label, second_buildings):
    fallback = format_location_comparison(first_label, first_buildings, second_label, second_buildings)
    first_counts = count_damage_levels(first_buildings)
    second_counts = count_damage_levels(second_buildings)
    prompt = f"""
You are Hazardly, a disaster damage assessment assistant.

Use only these exact facts:
First location: {first_label}
First counts: {first_counts}
Second location: {second_label}
Second counts: {second_counts}

Write a concise answer for the user.

Rules:
- Use 3 to 5 short bullet points.
- Compare the two locations directly.
- Keep all counts exact.
- Do not invent extra numbers or conclusions not supported by the counts.
"""
    return synthesize_structured_answer(prompt, fallback)


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
    address_parts = normalize_street_query_parts(address_text)
    if not address_parts:
        return []

    conn = get_db_connection()
    cur = conn.cursor()

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

    try:
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
    finally:
        cur.close()
        conn.close()

    return rows_to_buildings(rows)


def get_buildings_for_xbd(xbd_id, damage_filter=None):
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    JOIN disasters d ON ip.disaster_id = d.id
    WHERE d.name = %s
      AND ip.xbd_id = %s
    """
    params = [DEFAULT_DISASTER_NAME, xbd_id]

    if damage_filter:
        query += " AND b.predicted_damage = %s"
        params.append(damage_filter)

    cur.execute(query, tuple(params))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


def scene_exists(xbd_id):
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT 1
    FROM image_pairs ip
    JOIN disasters d ON ip.disaster_id = d.id
    WHERE d.name = %s
      AND ip.xbd_id = %s
    LIMIT 1
    """

    cur.execute(query, (DEFAULT_DISASTER_NAME, xbd_id))
    exists = cur.fetchone() is not None

    cur.close()
    conn.close()

    return exists


def get_misclassified_buildings_for_xbd(xbd_id):
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT
      b.uid,
      ip.xbd_id,
      b.predicted_damage,
      ST_AsGeoJSON(b.geom),
      b.actual_damage::text,
      CASE
        WHEN b.predicted_damage IS NULL THEN NULL
        WHEN b.actual_damage::text = b.predicted_damage::text THEN TRUE
        ELSE FALSE
      END AS is_correct
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    JOIN disasters d ON ip.disaster_id = d.id
    WHERE d.name = %s
      AND ip.xbd_id = %s
      AND b.predicted_damage IS NOT NULL
      AND b.actual_damage::text <> b.predicted_damage::text
    """

    cur.execute(query, (DEFAULT_DISASTER_NAME, xbd_id))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


def get_all_misclassified_buildings():
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT
      b.uid,
      ip.xbd_id,
      b.predicted_damage,
      ST_AsGeoJSON(b.geom),
      b.actual_damage::text,
      CASE
        WHEN b.predicted_damage IS NULL THEN NULL
        WHEN b.actual_damage::text = b.predicted_damage::text THEN TRUE
        ELSE FALSE
      END AS is_correct
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    JOIN disasters d ON ip.disaster_id = d.id
    WHERE d.name = %s
      AND b.predicted_damage IS NOT NULL
      AND b.actual_damage::text <> b.predicted_damage::text
    ORDER BY ip.xbd_id ASC
    """

    cur.execute(query, (DEFAULT_DISASTER_NAME,))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


def build_address_city_pattern(address_text):
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
    return city_state_pattern


def query_buildings_by_address_text(address_text, damage_filter=None):
    city_state_pattern = build_address_city_pattern(address_text)
    conn = get_db_connection()
    cur = conn.cursor()
    query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE b.address IS NOT NULL
      AND b.address ~* %s
    """
    params = [city_state_pattern]

    if damage_filter:
        query += " AND b.predicted_damage = %s"
        params.append(damage_filter)

    try:
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
    finally:
        cur.close()
        conn.close()

    return rows_to_buildings(rows)


def get_buildings_by_address_text(address_text, damage_filter):
    return query_buildings_by_address_text(address_text, damage_filter)


def get_all_buildings_by_address_text(address_text):
    return query_buildings_by_address_text(address_text)


def get_all_buildings_for_city(city_text):
    conn = get_db_connection()
    cur = conn.cursor()

    normalized_city = city_text.strip()
    if not normalized_city:
        cur.close()
        conn.close()
        return []

    query = """
    WITH building_cities AS (
      SELECT
        b.uid,
        ip.xbd_id,
        b.predicted_damage,
        ST_AsGeoJSON(b.geom) AS geometry,
        CASE
          WHEN TRIM(SPLIT_PART(b.address, ',', 2)) ~* '[0-9]'
            OR LOWER(TRIM(SPLIT_PART(b.address, ',', 2))) IN ('texas', 'tx')
          THEN TRIM(SPLIT_PART(b.address, ',', 1))
          ELSE TRIM(SPLIT_PART(b.address, ',', 2))
        END AS city
      FROM buildings b
      JOIN image_pairs ip ON b.image_pair_id = ip.id
      JOIN disasters d ON ip.disaster_id = d.id
      WHERE b.address IS NOT NULL
        AND d.name = %s
        AND POSITION(',' IN b.address) > 0
    )
    SELECT uid, xbd_id, predicted_damage, geometry
    FROM building_cities
    WHERE LOWER(city) = LOWER(%s)
    """

    cur.execute(query, (DEFAULT_DISASTER_NAME, normalized_city))
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


def build_scene_action(xbd_id, building_ids=None, label_text=None):
    return {
        "type": "navigate",
        "target": "map",
        "reason": "scene_query",
        "url": build_map_route(DEFAULT_DISASTER_NAME, xbd_id),
        "params": {
            "disaster_name": DEFAULT_DISASTER_NAME,
            "xbd_id": xbd_id,
            "address": label_text,
            "building_ids": building_ids or [],
        },
    }


def get_primary_xbd_id(buildings):
    return get_dominant_xbd_id(buildings)


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


def extract_xbd_query_id(question):
    match = re.search(
        r"\b(?:xbd|scene)\s*#?\s*(\d+)\b",
        question,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    try:
        return int(match.group(1))
    except ValueError:
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

    counts = {level: 0 for level in DAMAGE_LEVELS}

    for damage, count in rows:
        if damage in counts:
            counts[damage] = count

    return counts


def get_full_dataset_metadata():
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    WITH building_cities AS (
      SELECT DISTINCT
        CASE
          WHEN TRIM(SPLIT_PART(address, ',', 2)) ~* '[0-9]'
            OR LOWER(TRIM(SPLIT_PART(address, ',', 2))) IN ('texas', 'tx')
          THEN TRIM(SPLIT_PART(address, ',', 1))
          ELSE TRIM(SPLIT_PART(address, ',', 2))
        END AS city
      FROM buildings
      WHERE address IS NOT NULL
        AND POSITION(',' IN address) > 0
    )
    SELECT
      (SELECT COUNT(*) FROM disasters) AS disaster_count,
      (SELECT COUNT(*) FROM image_pairs) AS image_pair_count,
      (SELECT COUNT(*) FROM buildings) AS building_count,
      (
        SELECT COUNT(*)
        FROM building_cities
        WHERE city <> ''
          AND city !~* '^[0-9]+$'
      ) AS city_count,
      (
        SELECT COUNT(*)
        FROM buildings
        WHERE predicted_damage IS NOT NULL
      ) AS predicted_count,
      (
        SELECT COUNT(*)
        FROM buildings
        WHERE actual_damage IS NOT NULL
      ) AS labeled_count,
      (
        SELECT COUNT(*)
        FROM buildings
        WHERE predicted_damage IS NOT NULL
          AND actual_damage IS NOT NULL
      ) AS compared_count,
      (
        SELECT COUNT(*)
        FROM buildings
        WHERE predicted_damage IS NOT NULL
          AND actual_damage IS NOT NULL
          AND actual_damage::text = predicted_damage::text
      ) AS correct_count
    """

    cur.execute(query)
    row = cur.fetchone()

    cur.close()
    conn.close()

    if not row:
        return {}

    return {
        "disaster_count": int(row[0] or 0),
        "image_pair_count": int(row[1] or 0),
        "building_count": int(row[2] or 0),
        "city_count": int(row[3] or 0),
        "predicted_count": int(row[4] or 0),
        "labeled_count": int(row[5] or 0),
        "compared_count": int(row[6] or 0),
        "correct_count": int(row[7] or 0),
    }


def count_damage_levels(buildings):
    counts = {level: 0 for level in DAMAGE_LEVELS}

    for b in buildings:
        damage = b["damage"]
        counts[damage] = counts.get(damage, 0) + 1

    return counts


def format_damage_count_response(counts, location_text):
    total = sum(counts.values())

    if total == 0:
        return f"I couldn't find damage assessment data for {location_text}."

    known_total = sum(counts.get(level, 0) for level in DAMAGE_LEVELS)
    other_total = total - known_total

    parts = [f"{counts.get(level, 0)} {level}" for level in DAMAGE_LEVELS]
    parts[-1] = "and " + parts[-1]
    response = f"For {location_text}, I found {total} buildings total: " + ", ".join(parts)

    if other_total > 0:
        response += f", with {other_total} other or unlabeled records"

    return response + "."


def format_number(value):
    return f"{value:,}"


def format_percentage(count, total):
    if total <= 0:
        return "0%"

    return f"{round((count / total) * 100, 1)}%"


def format_damage_summary_line(label, count, total):
    return f"- {label}: {format_number(count)} ({format_percentage(count, total)})"


def format_full_dataset_context_lines(metadata, counts):
    if not metadata:
        return []

    total = sum(counts.values())
    lines = []
    disaster_count = metadata.get("disaster_count", 0)
    image_pair_count = metadata.get("image_pair_count", 0)
    city_count = metadata.get("city_count", 0)
    compared_count = metadata.get("compared_count", 0)
    correct_count = metadata.get("correct_count", 0)

    if disaster_count or image_pair_count or city_count:
        scope_parts = []
        if disaster_count:
            scope_parts.append(f"{format_number(disaster_count)} disaster dataset")
        if image_pair_count:
            scope_parts.append(f"{format_number(image_pair_count)} xBD scenes/image pairs")
        if city_count:
            scope_parts.append(f"{format_number(city_count)} cities or named locations with address data")
        lines.append(f"- Scope: {', '.join(scope_parts)}")

    severe_total = counts.get("major-damage", 0) + counts.get("destroyed", 0)
    if total > 0:
        lines.append(
            f"- Severe damage: {format_number(severe_total)} buildings ({format_percentage(severe_total, total)}) are major-damage or destroyed"
        )

        dominant_key, dominant_count = max(counts.items(), key=lambda item: item[1])
        dominant_label = {
            "no-damage": "No damage",
            "minor-damage": "Minor damage",
            "major-damage": "Major damage",
            "destroyed": "Destroyed",
        }.get(dominant_key, dominant_key.replace("-", " "))
        lines.append(
            f"- Largest class: {dominant_label} ({format_number(dominant_count)}, {format_percentage(dominant_count, total)})"
        )

    if compared_count > 0:
        accuracy = format_percentage(correct_count, compared_count)
        lines.append(
            f"- Prediction evaluation: {format_number(correct_count)} of {format_number(compared_count)} comparable predictions are correct ({accuracy})"
        )

    return lines


def format_damage_bullet_summary(counts, location_text, metadata=None):
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
        f"- Total buildings: {format_number(total)}",
        format_damage_summary_line("No damage", counts.get("no-damage", 0), total),
        format_damage_summary_line("Minor damage", counts.get("minor-damage", 0), total),
        format_damage_summary_line("Major damage", counts.get("major-damage", 0), total),
        format_damage_summary_line("Destroyed", counts.get("destroyed", 0), total),
    ]

    if other_total > 0:
        lines.append(format_damage_summary_line("Other or unlabeled", other_total, total))

    lines.extend(format_full_dataset_context_lines(metadata, counts))

    return "\n".join(lines)


def synthesize_location_overview_answer(location_text, counts, metadata=None):
    return format_damage_bullet_summary(counts, location_text, metadata)




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
    model = os.getenv("NEMOTRON_MODEL", DEFAULT_NEMOTRON_MODEL).strip() or DEFAULT_NEMOTRON_MODEL
    fallback_model = os.getenv("NEMOTRON_FALLBACK_MODEL", DEFAULT_NEMOTRON_FALLBACK_MODEL).strip()

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

    models = [model]
    if fallback_model and fallback_model not in models:
        models.append(fallback_model)

    for model_name in models:
        payload = {
            "model": model_name,
            "messages": messages,
            "max_tokens": 300
        }

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=60)
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                return None
            content = content.strip('"')
            return content if content else None
        except requests.HTTPError as exc:
            response_text = getattr(exc.response, "text", "")
            logger.warning(
                "Nemotron request failed for model %s: %s. Response: %s",
                model_name,
                exc,
                response_text[:500],
            )
        except requests.RequestException as exc:
            logger.warning("Nemotron request failed for model %s: %s", model_name, exc)
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            logger.warning("Nemotron response had an unexpected shape for model %s: %s", model_name, exc)

    return None


def synthesize_structured_answer(prompt, fallback_answer):
    result = call_nemotron(prompt)
    if not result:
        return fallback_answer

    cleaned = str(result).strip().strip('"')
    return cleaned if cleaned else fallback_answer


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
- Sound professional and natural.
"""

    result = str(Settings.llm.complete(prompt)).strip('"').split(")*")[0].strip()
    if not result:
        return fallback_damage_answer(total, address, damage_type)
    return result


def generate_proximity_llm_answer(buildings, address, damage_type, radius_m):
    total = len(buildings)
    clean_damage = damage_type.replace("-", " ")
    radius_label = format_radius_label(radius_m)

    prompt = f"""
You are Hazardly, a disaster damage assessment chatbot.

Use the exact facts below:
Search center: {address}
Search radius: {radius_label}
Damage type: {clean_damage}
Number of buildings: {total}

Write one short, clear sentence telling the user how many {clean_damage} buildings
were found NEAR (within the search radius around) {address}.

Rules:
- Phrase the result as buildings "near" or "around" the location.
- Do NOT say the buildings are "on" or "at" {address}; they are nearby, not necessarily on that exact street.
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
        "undamaged", "non-damaged", "non damaged", "no damage", "no-damage",

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
        "overall damage in the dataset",
        "what is the data",
        "what is this data",
        "what is the dataset",
        "what is this dataset",
        "what data is this",
        "what dataset is this",
        "what does the dataset contain",
        "what does this dataset contain",
        "what does the data contain",
        "what does this data contain",
        "what does the data show",
        "tell me about the data",
        "tell me about the dataset",
        "about the data",
        "about the dataset",
        "describe the data",
        "describe the dataset",
    ])
    if not has_dataset_phrase:
        return False

    scoped_location_phrases = [" near ", " in ", " on ", " around ", " at ", " for "]
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
        "what cities were evaluated",
        "which cities were evaluated",
        "what cities have been evaluated",
        "which cities have been evaluated",
        "what cities do you know about",
        "which cities do you know about",
        "what cities can you tell me about",
        "which cities can you tell me about",
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


def is_active_disaster_query(question):
    normalized_question = re.sub(r"\s+", " ", question.strip().lower()).strip(" ?.")
    return normalized_question in {
        "what disaster is this",
        "what disaster is this dataset",
        "what disaster is this data",
        "what disaster are we looking at",
        "what disaster am i looking at",
        "which disaster is this",
        "which disaster are we looking at",
        "what is the active disaster",
        "what disaster is active",
    }


def format_disaster_name(disaster_name):
    return str(disaster_name).replace("-", " ").title()


def active_disaster_response():
    return (
        f"The active disaster dataset is {format_disaster_name(DEFAULT_DISASTER_NAME)}. "
        "You can ask for a dataset summary, affected cities, xBD scenes, or building damage near a location."
    )


def is_help_query(question):
    normalized_question = re.sub(r"\s+", " ", question.strip().lower()).strip(" ?.")
    return normalized_question in {
        "help",
        "what can you do",
        "what can you help with",
        "what do you do",
        "how can you help",
        "how can you help me",
        "what should i ask",
        "what questions can i ask",
        "what can i ask",
    }


def is_greeting_query(question):
    normalized_question = re.sub(r"\s+", " ", question.strip().lower()).strip(" !?.")
    return normalized_question in {
        "hi",
        "hello",
        "hey",
        "good morning",
        "good afternoon",
        "good evening",
    }


def is_identity_query(question):
    normalized_question = re.sub(r"\s+", " ", question.strip().lower()).strip(" !?.")
    return normalized_question in {
        "who are you",
        "what are you",
        "what is your name",
        "what's your name",
        "who am i talking to",
        "are you hazardly",
    }


def is_acknowledgement_query(question):
    normalized_question = re.sub(r"\s+", " ", question.strip().lower()).strip(" !?.")
    acknowledgement_phrases = {
        "thanks",
        "thank you",
        "thank u",
        "thx",
        "appreciate it",
        "i appreciate it",
        "got it",
        "ok",
        "okay",
        "sounds good",
    }
    return normalized_question in acknowledgement_phrases and bool(get_last_assistant_message())


def greeting_response():
    return (
        "Hi, I am Hazardly. Ask me about disaster damage counts, affected cities, damaged buildings near a "
        "location, xBD scenes, or general flood and hurricane safety guidance."
    )


def identity_response():
    return (
        "I am Hazardly, a disaster damage assessment assistant for the active dataset. I can help with damage "
        "counts, affected cities, damaged buildings near a location, xBD scenes, and general flood or hurricane guidance."
    )


def acknowledgement_response():
    return "You're welcome. Ask me if you want to look at another location, scene, or damage level."


def help_response():
    options = [
        "\n".join([
            "I can help with disaster damage assessment questions for the active dataset.",
            "Try asking for a dataset summary, affected cities, damage counts, damaged buildings near a city or address, a specific xBD scene, misclassified buildings, or general flood and hurricane safety guidance.",
            "Examples: \"Show major damage near Houston\", \"Summarize damage in Sugar Land\", or \"What should I do during a flood?\"",
        ]),
        "\n".join([
            "I can help you explore damage patterns in the active disaster dataset.",
            "You can ask about affected cities, scene-level damage, building counts by severity, misclassified buildings, Ready.gov flood or hurricane guidance, or conditions near a city, area, address, or xBD scene.",
            "Examples: \"What happened to Richmond?\", \"Show scene 18\", or \"How should I prepare for a hurricane?\"",
        ]),
        "\n".join([
            "I am best at answering questions about disaster damage assessment data.",
            "Ask me to summarize the dataset, compare locations, list affected cities, find damaged buildings, explain damage labels, or give general flood and hurricane guidance.",
            "Examples: \"Summarize the full dataset\", \"Compare Missouri City and Cypress\", or \"What should I do after a hurricane?\"",
        ]),
    ]

    previous_help_response_count = sum(
        1
        for message in get_chat_history()
        if message.get("role") == "assistant"
        and message.get("content") in options
    )
    return options[previous_help_response_count % len(options)]


def ambiguous_query_response(parsed_query):
    if parsed_query["intent"] in {"location_query", "location_overview"}:
        return (
            "I need a little more detail to answer that. Please include a city, area, address, xBD scene, "
            "or say \"full dataset\" if you want overall results. For example: \"Show major damage near Houston\" "
            "or \"Summarize the full dataset.\""
        )

    return (
        "I am not sure which damage assessment question you want answered. You can ask about the full dataset, "
        "affected cities, damage levels, a city or address, an xBD scene, or safety and repair guidance."
    )


def unsupported_query_response():
    return (
        "I understand this is related to disaster damage assessment, but I have not been taught how to answer that "
        "kind of request yet. Try asking about damage counts, affected cities, damaged buildings near a location, "
        "xBD scenes, or general flood and hurricane safety guidance."
    )


def out_of_scope_query_response():
    return (
        "That is outside my disaster damage assessment scope. I can help with damage counts, affected cities, "
        "damaged buildings near a location, xBD scenes, or general flood and hurricane safety guidance."
    )


def is_untrained_disaster_request(question):
    q = question.lower()
    if is_disaster_guidance_query(question):
        return False
    if "predicted damage" in q:
        return False
    unsupported_terms = [
        "forecast",
        "predict",
        "tomorrow",
        "next week",
        "future",
        "live",
        "real-time",
        "realtime",
        "insurance",
        "claim",
        "fema",
        "permit",
        "lawsuit",
        "legal",
    ]
    return is_disaster_related(question) and any(term in q for term in unsupported_terms)


def classify_query_intent_heuristic(question):
    lowered_question = question.lower()

    if (
        any(phrase in lowered_question for phrase in ["how many", "count"])
        and extract_damage_filter(question) is not None
        and re.search(r"\b(?:near|in|on|around|at)\b", lowered_question)
    ):
        return "location_query"

    if is_scope_clarification_prompt(question):
        return "unsupported"

    if is_greeting_query(question):
        return "greeting"

    if is_identity_query(question):
        return "identity"

    if is_acknowledgement_query(question):
        return "acknowledgement"

    if is_active_disaster_query(question):
        return "active_disaster"

    if is_help_query(question):
        return "help"

    if is_disaster_guidance_query(question):
        return "disaster_guidance"

    if is_untrained_disaster_request(question):
        return "unsupported"

    if is_vlm_query(question):
        return "vlm"

    if is_location_damage_display_query(question):
        return "location_query"

    if is_scene_count_query(question):
        return "scene_count"

    if is_scene_ranking_query(question):
        return "scene_ranking"

    if is_misclassified_query(question):
        return "misclassified_buildings"

    if is_conversation_summary_query(question):
        return "conversation_summary"

    if is_city_count_query(question):
        return "city_count"

    if is_damage_label_query(question):
        return "damage_labels"

    if is_city_list_query(question):
        return "city_list"

    if is_city_ranking_query(question):
        return "city_ranking"

    comparison_locations = extract_comparison_locations(question)
    if comparison_locations and is_city_comparison_query(question):
        return "location_comparison"

    if is_data_summary_query(question):
        if any(phrase in lowered_question for phrase in [" near ", " in ", " on ", " around ", " at ", " for "]):
            return "general_location_overview"
        return "full_dataset_summary"

    if extract_percentage_location_text(question):
        return "location_percentage"

    if is_full_dataset_query(question):
        return "full_dataset_summary"

    if extract_xbd_query_id(question) is not None:
        return "xbd_query"

    if (
        "tell me about" in lowered_question
        and "building" in lowered_question
        and extract_damage_filter(question) is not None
        and (
            extract_in_location_text(question)
            or extract_on_location_text(question)
            or "near " in lowered_question
            or (
                not extract_general_location_text(question)
                and "near " not in lowered_question
                and " in " not in lowered_question
                and " on " not in lowered_question
            )
        )
    ):
        return "location_query"

    if extract_general_location_text(question):
        return "general_location_overview"

    return None


def classify_query_intent_llm(question):
    prompt = f"""
You are routing user questions for a disaster damage assessment assistant.

Choose exactly one label from this list:
- scene_count
- scene_ranking
- misclassified_buildings
- full_dataset_summary
- city_list
- city_count
- damage_labels
- city_ranking
- greeting
- identity
- acknowledgement
- active_disaster
- help
- disaster_guidance
- location_comparison
- location_percentage
- conversation_summary
- vlm
- xbd_query
- general_location_overview
- location_query
- unsupported
- out_of_scope

Definitions:
- full_dataset_summary: asks about the dataset as a whole, what the data contains, or overall damage across the dataset, without focusing on one place
- scene_count: asks how many xBD scenes or image pairs are in the dataset
- scene_ranking: asks for the best/worst/top scenes by accuracy, incorrect predictions, or damage counts
- misclassified_buildings: asks to show buildings with incorrect predictions or other classification errors
- city_list: asks which cities or locations appear in the dataset
- city_count: asks how many cities or locations are represented
- damage_labels: asks which damage labels or levels exist
- city_ranking: asks which cities have the most or least damage
- greeting: brief conversational opener such as hello, hi, or hey
- identity: asks who the assistant is or what it does
- acknowledgement: brief thanks or acknowledgement after the assistant has answered
- active_disaster: asks which active disaster or disaster dataset is being viewed
- help: asks what the assistant can do or what questions are supported
- disaster_guidance: asks for general flood, hurricane, Ready.gov, or FEMA preparedness/safety/recovery guidance, without asking for active dataset counts or map results
- location_comparison: compares two named locations
- location_percentage: asks what percentage/share of buildings in a place fit a damage level
- conversation_summary: asks for a recap of the conversation
- vlm: asks about uploading, evaluating, or comparing images
- xbd_query: directly references an xBD scene ID
- general_location_overview: asks for an overview or summary of damage in one place
- location_query: asks about buildings or damage for one place, address, area, or scene, including map-like requests
- unsupported: related to disaster damage assessment, but not a supported capability
- out_of_scope: not related to disaster damage assessment

Examples:
Question: Tell me about the data
Label: full_dataset_summary

Question: What does this dataset contain?
Label: full_dataset_summary

Question: What cities are in the dataset?
Label: city_list

Question: What can you help with?
Label: help

Question: What should I do during a flood?
Label: disaster_guidance

Question: How should I prepare for a hurricane?
Label: disaster_guidance

Question: What disaster is this?
Label: active_disaster

Question: Compare Houston and Sugar Land
Label: location_comparison

Question: Show destroyed buildings near downtown Houston
Label: location_query

Question: Summarize damage in Sugar Land
Label: general_location_overview

Question: Show XBD 18
Label: xbd_query

Question: How many scenes are available?
Label: scene_count

Question: Show the worst scene by accuracy
Label: scene_ranking

Question: Show misclassified buildings
Label: misclassified_buildings

Question: Upload a before and after image
Label: vlm

Question: {question}
Label:
"""

    result = call_nemotron(prompt)
    if not result:
        return None

    label = result.strip().strip('"').strip().splitlines()[0].strip().lower()
    valid_labels = {
        "scene_count",
        "scene_ranking",
        "misclassified_buildings",
        "full_dataset_summary",
        "city_list",
        "city_count",
        "damage_labels",
        "city_ranking",
        "greeting",
        "identity",
        "acknowledgement",
        "active_disaster",
        "help",
        "disaster_guidance",
        "location_comparison",
        "location_percentage",
        "conversation_summary",
        "vlm",
        "xbd_query",
        "general_location_overview",
        "location_query",
        "unsupported",
        "out_of_scope",
    }

    return label if label in valid_labels else None


def classify_query_intent(question):
    normalized_question = question.strip().lower()
    if is_dataset_scope_followup(question):
        last_user_message = get_last_user_message().lower()
        inherited_damage_filter = extract_damage_filter(last_user_message)
        if any(term in last_user_message for term in ["show", "open", "take me", "go to"]):
            if inherited_damage_filter or "building" in last_user_message:
                return "location_query"
        if inherited_damage_filter or "building" in last_user_message:
            return "full_dataset_summary"
    if is_location_scope_followup(question):
        last_user_message = get_last_user_message().lower()
        if extract_damage_filter(last_user_message) or "building" in last_user_message:
            return "location_query"

    heuristic_intent = classify_query_intent_heuristic(question)
    if heuristic_intent:
        return heuristic_intent

    llm_intent = classify_query_intent_llm(question)
    if llm_intent:
        return llm_intent

    if is_disaster_related(question):
        return "location_query"

    return "out_of_scope"


def extract_damage_filter(question):
    q = question.lower()
    if is_repair_count_query(question):
        return "damaged"
    has_specific_damage_label = any(term in q for term in [
        "fine",
        "no damage",
        "no-damage",
        "no damaged",
        "undamaged",
        "unaffected",
        "non-damaged",
        "non damaged",
        "not damaged",
        "minor",
        "destroyed",
        "major",
        "damaged",
    ])
    if "predicted damage" in q and not has_specific_damage_label:
        return None
    if any(word in q for word in [
        "fine", "no damage", "no-damage", "no damaged", "undamaged", "unaffected",
        "non-damaged", "non damaged", "not damaged"
    ]):
        return "no-damage"
    if "minor" in q:
        return "minor-damage"
    if "destroyed" in q:
        return "destroyed"
    if "major" in q:
        return "major-damage"
    if "damaged" in q:
        return "damaged"
    if "damage" in q:
        return "major-damage"
    return None


def normalize_location_candidate(location_text):
    if not location_text:
        return None

    normalized = location_text.strip(" ?,.")
    normalized = re.sub(
        r"^(?:the\s+)?cities?\s+of\s+",
        "",
        normalized,
        flags=re.IGNORECASE,
    ).strip(" ,")
    normalized = re.sub(r"\s+", " ", normalized).strip(" ,")
    return normalized or None


def format_location_label(location_text):
    if not location_text:
        return location_text

    normalized = re.sub(r"\s+", " ", str(location_text)).strip(" ,")
    if not normalized:
        return normalized

    if normalized == normalized.lower():
        parts = [part.strip() for part in normalized.split(",")]
        return ", ".join(part.title() for part in parts if part)

    return normalized


def get_damage_label_text(damage_type):
    if not isinstance(damage_type, str):
        return None
    return DAMAGE_LABEL_TEXT.get(damage_type)


def infer_scope(location_text, explicit_scene_id=None):
    if explicit_scene_id is not None:
        return "scene"
    if not location_text:
        return "dataset"
    if looks_like_exact_address(location_text):
        return "address"
    if looks_like_street_address(location_text):
        return "street"
    if "," in location_text:
        return "area"
    return "city"


def parse_structured_query(question):
    raw_intent = classify_query_intent(question)
    mapped_intent = {
        "full_dataset_summary": "dataset_overview",
        "scene_count": "scene_count",
        "scene_ranking": "scene_ranking",
        "misclassified_buildings": "misclassified_buildings",
        "city_list": "city_list",
        "city_count": "city_count",
        "damage_labels": "damage_labels",
        "city_ranking": "city_ranking",
        "greeting": "greeting",
        "identity": "identity",
        "acknowledgement": "acknowledgement",
        "active_disaster": "active_disaster",
        "help": "help",
        "disaster_guidance": "disaster_guidance",
        "location_comparison": "location_comparison",
        "location_percentage": "location_percentage",
        "conversation_summary": "conversation_summary",
        "vlm": "vlm_query",
        "xbd_query": "scene_query",
        "general_location_overview": "location_overview",
        "location_query": "location_query",
        "unsupported": "unsupported",
        "out_of_scope": "out_of_scope",
    }.get(raw_intent, raw_intent)

    explicit_scene_id = extract_xbd_query_id(question)
    dataset_scope_followup = is_dataset_scope_followup(question)
    location_scope_followup = is_location_scope_followup(question)
    inherited_user_message = (
        get_last_user_message()
        if (dataset_scope_followup or location_scope_followup)
        else ""
    )
    inherited_damage_filter = (
        extract_damage_filter(inherited_user_message)
        if (dataset_scope_followup or location_scope_followup)
        else None
    )
    comparison_locations = extract_comparison_locations(question)
    percentage_location_text = extract_percentage_location_text(question)
    general_location_text = extract_general_location_text(question)
    on_location_text = (
        extract_on_location_text(question)
        if "near" not in question.lower()
        else None
    )
    address_filter_text = extract_address_filter_text(question)
    in_location_text = (
        extract_in_location_text(question)
        if "near" not in question.lower()
        else None
    )
    parsed_address, parsed_default_damage = parse_question(question)
    explicit_near_or_in_match = re.search(
        r"\b(?:near|in)\s+(.+?)(?:\?|$)",
        question,
        flags=re.IGNORECASE,
    )
    has_near_keyword = bool(re.search(r"\bnear\b", question, flags=re.IGNORECASE))

    locations = []
    query_mode = "generic_location"
    primary_location = None

    if dataset_scope_followup and mapped_intent == "location_query":
        query_mode = "dataset_scope_followup"
    elif location_scope_followup and mapped_intent == "location_query":
        primary_location = normalize_location_candidate(question)
        locations = [primary_location] if primary_location else []
        query_mode = "clarified_location"
    elif mapped_intent == "location_comparison" and comparison_locations:
        first_location = normalize_location_candidate(comparison_locations[0])
        second_location = normalize_location_candidate(comparison_locations[1])
        locations = [location for location in [first_location, second_location] if location]
        primary_location = locations[0] if locations else None
        query_mode = "comparison"
    elif mapped_intent == "location_percentage" and percentage_location_text:
        primary_location = normalize_location_candidate(percentage_location_text)
        locations = [primary_location] if primary_location else []
        query_mode = "percentage"
    elif mapped_intent == "location_overview" and (general_location_text or explicit_near_or_in_match):
        primary_location = normalize_location_candidate(
            general_location_text if general_location_text else parsed_address
        )
        locations = [primary_location] if primary_location else []
        query_mode = "overview"
    elif on_location_text:
        primary_location = normalize_location_candidate(on_location_text)
        locations = [primary_location] if primary_location else []
        query_mode = "on_address"
    elif address_filter_text:
        primary_location = normalize_location_candidate(address_filter_text)
        locations = [primary_location] if primary_location else []
        query_mode = "address_filter"
    elif in_location_text:
        primary_location = normalize_location_candidate(in_location_text)
        locations = [primary_location] if primary_location else []
        query_mode = "in_location"
    elif explicit_scene_id is not None:
        primary_location = format_scene_label(explicit_scene_id)
        locations = [primary_location]
        query_mode = "scene"
    elif has_near_keyword and parsed_address:
        # "near X" implies a radius/proximity search around X, not an
        # exact-address ILIKE match on building.address.
        primary_location = normalize_location_candidate(parsed_address)
        locations = [primary_location] if primary_location else []
        query_mode = "proximity"
    else:
        primary_location = (
            normalize_location_candidate(parsed_address)
            if explicit_near_or_in_match or mapped_intent == "location_query"
            else None
        )
        locations = [primary_location] if primary_location else []

    damage_filter = extract_damage_filter(question)
    has_explicit_damage_filter = damage_filter is not None
    if damage_filter is None and inherited_damage_filter is not None:
        damage_filter = inherited_damage_filter
        has_explicit_damage_filter = True
    if mapped_intent == "location_query" and damage_filter is None:
        damage_filter = parsed_default_damage
    if mapped_intent in {"location_overview", "city_list", "city_count"}:
        damage_filter = None
    if mapped_intent == "location_overview" and primary_location is None and damage_filter is not None:
        mapped_intent = "dataset_overview"

    wants_navigation = any(
        phrase in question.lower()
        for phrase in ["show ", "show me", "take me", "open ", "go to ", "navigate"]
    )
    if dataset_scope_followup and query_mode == "dataset_scope_followup":
        wants_navigation = False
    wants_summary = mapped_intent in {
        "dataset_overview",
        "location_overview",
        "location_comparison",
        "location_percentage",
        "city_list",
        "city_count",
        "damage_labels",
        "greeting",
        "identity",
        "acknowledgement",
        "active_disaster",
        "help",
        "disaster_guidance",
        "conversation_summary",
        "scene_count",
        "scene_ranking",
    }

    entity_type = "place"
    if explicit_scene_id is not None:
        entity_type = "scene"
    elif query_mode in {"on_address", "address_filter", "in_location"}:
        entity_type = "address"

    return {
        "intent": mapped_intent,
        "locations": locations,
        "comparison": mapped_intent == "location_comparison",
        "damage_filter": damage_filter,
        "has_explicit_damage_filter": has_explicit_damage_filter,
        "needs_map": wants_navigation or mapped_intent == "location_query",
        "scope": infer_scope(primary_location, explicit_scene_id),
        "entity_type": entity_type,
        "explicit_scene_id": explicit_scene_id,
        "wants_summary": wants_summary,
        "wants_all_buildings": (
            inherited_damage_filter is None
            if dataset_scope_followup and query_mode == "dataset_scope_followup"
            else (
                is_all_buildings_query(question)
                or (
                    mapped_intent == "location_query"
                    and not has_explicit_damage_filter
                )
            )
        ),
        "advisory": detect_advisory(question),
        "query_mode": query_mode,
        "primary_location": primary_location,
        "raw_question": question,
    }


def summarize_conversation():
    chat_history = get_chat_history()

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


def synthesize_city_damage_stats_answer(rows):
    fallback = format_city_list_response(rows)
    city_names = []
    seen = set()
    for row in rows:
        city = str(row[0]).strip()
        if not city or city.lower() in seen:
            continue
        seen.add(city.lower())
        city_names.append(city)

    prompt = f"""
You are Hazardly, a disaster damage assessment assistant.

The user asked which cities are in the active disaster dataset.

City names:
{", ".join(city_names[:12])}

Write one concise answer sentence.

Rules:
- Mention the city names naturally in one sentence.
- Do not include counts, rankings, brackets, bullets, or Python list syntax.
- Do not mention prompts, rules, instructions, or provided facts.
- Do not add a second answer or correction.
"""
    return clean_city_list_response(call_nemotron(prompt), fallback, rows)


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
def handle_chat_query(question, session_id=None):
    set_active_chat_session(session_id)
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

    parsed_query = parse_structured_query(question)
    intent = parsed_query["intent"]
    damage_type = parsed_query["damage_filter"] or "major-damage"
    wants_all_buildings = parsed_query["wants_all_buildings"]
    primary_location = parsed_query["primary_location"]
    advisory = parsed_query["advisory"]
    xbd_query_id = parsed_query["explicit_scene_id"]

    if intent == "greeting":
        answer = greeting_response()
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()
        }

    if intent == "identity":
        answer = identity_response()
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()
        }

    if intent == "acknowledgement":
        answer = acknowledgement_response()
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()
        }

    if intent == "active_disaster":
        answer = active_disaster_response()
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()
        }

    if intent == "help":
        answer = help_response()
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()
        }

    if intent == "disaster_guidance":
        answer = disaster_guidance_response(question)
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()
        }

    if intent == "vlm_query":
        answer = vlm_guidance_response()
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,  # same text for frontend compatibility
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()  # no navigation action
        }

    if intent == "conversation_summary":
        answer = summarize_conversation()
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,  # same text for frontend compatibility
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()  # no navigation action
        }

    if intent == "scene_count":
        total_scenes = fetch_scene_count()
        answer = format_scene_count_response(total_scenes)
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    if intent == "scene_ranking":
        metric = get_scene_ranking_metric(question)
        limit = extract_top_n(question)
        scene_rows = fetch_scene_stats()
        answer = format_scene_ranking(scene_rows, metric, limit)
        top_scene = get_top_scene_for_metric(scene_rows, metric)

        if not top_scene:
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action(),
            }

        top_xbd_id = top_scene[0]
        if metric in {"accuracy", "incorrect_count"}:
            highlighted_buildings = get_misclassified_buildings_for_xbd(top_xbd_id)
        elif metric == "destroyed":
            highlighted_buildings = get_buildings_for_xbd(top_xbd_id, "destroyed")
        elif metric == "major_damage":
            highlighted_buildings = get_buildings_for_xbd(top_xbd_id, "major-damage")
        elif metric == "minor_damage":
            highlighted_buildings = get_buildings_for_xbd(top_xbd_id, "minor-damage")
        else:
            highlighted_buildings = get_buildings_for_xbd(top_xbd_id)
        action = build_scene_action(
            top_xbd_id,
            [building["uid"] for building in highlighted_buildings],
            format_scene_label(top_xbd_id),
        )

        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": highlighted_buildings,
            "action": action,
        }

    if intent == "misclassified_buildings":
        if xbd_query_id is not None:
            misclassified_buildings = get_misclassified_buildings_for_xbd(xbd_query_id)
            label_text = format_scene_label(xbd_query_id)
            total_misclassified = len(misclassified_buildings)
        else:
            all_misclassified_buildings = get_all_misclassified_buildings()
            total_misclassified = len(all_misclassified_buildings)
            representative_xbd_id = get_dominant_xbd_id(all_misclassified_buildings)
            misclassified_buildings = get_buildings_for_primary_scene(
                all_misclassified_buildings,
                representative_xbd_id,
            )
            label_text = (
                f"representative {format_scene_label(representative_xbd_id)}"
                if representative_xbd_id is not None
                else "the active dataset"
            )

        if len(misclassified_buildings) == 0:
            if xbd_query_id is not None:
                answer = f"I couldn't find any misclassified buildings on {format_scene_label(xbd_query_id)}."
            else:
                answer = "I couldn't find any misclassified buildings in the active disaster dataset."
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action(),
            }

        answer = f"I found {total_misclassified} misclassified buildings in the active disaster dataset."
        if xbd_query_id is not None:
            answer = f"I found {total_misclassified} misclassified buildings on {label_text}."
        else:
            answer += f" I'm highlighting {label_text} on the map."
        primary_xbd_id = get_dominant_xbd_id(misclassified_buildings)
        action = build_scene_action(
            primary_xbd_id,
            [building["uid"] for building in misclassified_buildings],
            label_text,
        )

        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": misclassified_buildings,
            "action": action,
        }

    if intent == "city_count":
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

    if intent == "damage_labels":
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

    if intent == "city_list":
        rows = fetch_city_damage_stats()
        answer = synthesize_city_damage_stats_answer(rows)
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    if intent == "city_ranking":
        rows = fetch_city_damage_stats()
        answer = synthesize_city_ranking_answer(
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

    if intent == "location_comparison" and len(parsed_query["locations"]) >= 2:
        first_location, second_location = parsed_query["locations"][:2]
        first_geo, first_label, first_buildings = resolve_location_buildings(first_location)
        second_geo, second_label, second_buildings = resolve_location_buildings(second_location)

        answer = synthesize_location_comparison_answer(
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

    if intent == "location_percentage" and primary_location:
        geo, label_text, all_buildings = resolve_location_buildings(primary_location)
        matching_buildings = filter_buildings_by_damage(all_buildings, damage_type)
        answer = synthesize_percentage_answer(
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

    if intent == "location_overview" and primary_location:
        geo, label_text, all_buildings = resolve_location_buildings(primary_location)

        if len(all_buildings) == 0:
            answer = f"I could not find relevant damage data for {primary_location}."
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action(),
            }

        counts = count_damage_levels(all_buildings)
        answer = synthesize_location_overview_answer(label_text, counts)

        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    if intent in {"unsupported", "out_of_scope"}:
        if is_scope_clarification_prompt(question):
            answer = "Please answer with either the full dataset or a specific city or area."
        elif intent == "out_of_scope":
            answer = out_of_scope_query_response()
        else:
            answer = unsupported_query_response()
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,  # same text for frontend compatibility
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()  # no navigation action
        }
            
    # full dataset summary does not have a single map focus
    if intent == "dataset_overview":
        counts = get_full_dataset_damage_counts()
        try:
            metadata = get_full_dataset_metadata()
        except Exception:
            metadata = None
        parsed_damage_filter = parsed_query["damage_filter"]
        damage_key = parsed_damage_filter if isinstance(parsed_damage_filter, str) else None
        damage_label = get_damage_label_text(damage_key)
        if damage_key and damage_label and damage_key in counts:
            answer = "\n".join([
                f"Here's the dataset summary for {damage_label} buildings:",
                f"- Total {damage_label} buildings: {format_number(counts.get(damage_key, 0))}",
            ])
        else:
            answer = synthesize_location_overview_answer("the full dataset", counts, metadata)
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,  # same text for frontend compatibility
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()  # full dataset does not navigate to one route
        }

    if intent == "location_query" and parsed_query["query_mode"] == "dataset_scope_followup":
        rows = fetch_city_damage_stats(limit=500)
        metric = damage_type if not wants_all_buildings else "total"
        answer = format_city_ranking(rows, metric, len(rows))
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    if intent == "scene_query" and xbd_query_id is not None:
        requested_damage = (
            damage_type
            if parsed_query["has_explicit_damage_filter"] and not wants_all_buildings
            else None
        )
        buildings = get_buildings_for_xbd(xbd_query_id, requested_damage)

        if len(buildings) == 0:
            if not scene_exists(xbd_query_id):
                answer = f"{format_scene_label(xbd_query_id)} does not exist in the active dataset."
            else:
                answer = (
                    f"{format_scene_label(xbd_query_id)} exists, but I could not find matching "
                    "building damage data for that request."
                )
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action(),
            }

        label_text = format_scene_label(xbd_query_id)
        if requested_damage is None:
            counts = count_damage_levels(buildings)
            answer = synthesize_location_overview_answer(label_text, counts)
        else:
            answer = format_scene_damage_answer(label_text, len(buildings), damage_type)

        action = (
            build_building_action(buildings[0])
            if len(buildings) == 1
            else build_scene_action(
                xbd_query_id,
                [building["uid"] for building in buildings],
                label_text,
            )
        )

        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": buildings,
            "action": action,
        }

    if intent == "location_query" and parsed_query["query_mode"] == "on_address" and primary_location:
        on_location_text = primary_location
        has_explicit_region = "," in on_location_text
        requested_damage = None if wants_all_buildings or damage_type == "damaged" else damage_type
        buildings = get_buildings_on_address_text(on_location_text, requested_damage)
        if damage_type == "damaged" and not wants_all_buildings:
            buildings = filter_buildings_by_damage(buildings, damage_type)
        primary_xbd_id = get_dominant_xbd_id(buildings)
        scene_buildings = get_buildings_for_primary_scene(buildings, primary_xbd_id)
        geo = geocode_address(on_location_text) if has_explicit_region else None

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

        label_text = geo["formatted_address"] if geo and has_explicit_region else on_location_text
        if wants_all_buildings:
            counts = count_damage_levels(buildings)
            answer = synthesize_location_overview_answer(f"addresses on {label_text}", counts)
        elif damage_type == "damaged":
            answer = f"{len(buildings)} buildings on {label_text} are classified as damaged."
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
            "focus": None,
            "highlighted_buildings": scene_buildings if len(buildings) > 1 else buildings,
            "action": action
        }

    if intent == "location_query" and parsed_query["query_mode"] == "address_filter" and primary_location:
        address_filter_text = primary_location
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

    if intent == "location_query" and parsed_query["query_mode"] == "in_location" and primary_location:
        in_location_text = primary_location
        city_lookup_buildings = []
        if "," not in in_location_text and not looks_like_street_address(in_location_text):
            city_lookup_buildings = get_all_buildings_for_city(in_location_text)

        geo = None if city_lookup_buildings else geocode_address(in_location_text)
        buildings = []
        if city_lookup_buildings:
            buildings = city_lookup_buildings
        elif geo and geo.get("bbox") and len(geo["bbox"]) == 4:
            min_lon, min_lat, max_lon, max_lat = geo["bbox"]
            if damage_type == "damaged":
                buildings = get_all_buildings_in_bbox(min_lon, min_lat, max_lon, max_lat)
            else:
                buildings = get_buildings_in_bbox(
                    min_lon,
                    min_lat,
                    max_lon,
                    max_lat,
                    damage_type,
                )
        if len(buildings) == 0:
            address_damage_filter = None if damage_type == "damaged" else damage_type
            buildings = get_buildings_by_address_text(in_location_text, address_damage_filter)
        if len(buildings) == 0 and "," not in in_location_text:
            buildings = get_all_buildings_for_city(in_location_text)
        if damage_type == "damaged":
            buildings = filter_buildings_by_damage(buildings, damage_type)
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
        if damage_type == "damaged":
            answer = f"{len(buildings)} buildings in {label_text} are classified as damaged and may need repair."
        elif damage_type == "no-damage":
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

    if (
        intent == "location_query"
        and parsed_query["query_mode"] == "proximity"
        and primary_location
        and not advisory
        and not parsed_query["wants_summary"]
    ):
        # "damage near X" -> true radius search around the geocoded center of X.
        # We deliberately skip resolve_location_buildings here because that helper
        # does an ILIKE match on building.address for exact-looking inputs, which
        # would return only buildings literally on that street and lose the
        # "nearby scene" context the user is asking for.
        # Advisory and summary queries fall through to the generic handler below
        # because that path already does its own radius search and adds the
        # correct advisory/summary reasoning on top.
        proximity_location_text = primary_location
        geo = geocode_address(proximity_location_text)

        if not geo:
            answer = (
                f"I couldn't find a location to search around for "
                f"{proximity_location_text}."
            )
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action(),
            }

        radius_m = NEARBY_SEARCH_RADIUS_METERS

        label_text = geo["formatted_address"]

        if wants_all_buildings:
            buildings = get_all_buildings_near(geo["lon"], geo["lat"], radius_m)
        else:
            buildings = get_buildings_near(
                geo["lon"], geo["lat"], radius_m, damage_type
            )

        primary_xbd_id = get_dominant_xbd_id(buildings)
        scene_buildings = get_buildings_for_primary_scene(buildings, primary_xbd_id)

        focus = {
            "lat": geo["lat"],
            "lon": geo["lon"],
            "address": label_text,
        }

        if len(buildings) == 0:
            all_nearby = get_all_buildings_near(geo["lon"], geo["lat"], radius_m)

            if not all_nearby:
                radius_label = format_radius_label(radius_m)
                answer = (
                    f"No assessed buildings appear in our database within about "
                    f"{radius_label} of {label_text}."
                )
                save_turn(question, answer)
                return {
                    "answer": answer,
                    "response": answer,
                    "focus": None,
                    "highlighted_buildings": [],
                    "action": build_no_action(),
                }

            counts = count_damage_levels(all_nearby)
            label = damage_type.replace("-", " ")
            answer = (
                f"Near {label_text}, no buildings are classified as {label}. "
                + format_damage_count_response(counts, "that area")
            )
            nearby_primary_xbd_id = get_dominant_xbd_id(all_nearby)
            nearby_scene_buildings = get_buildings_for_primary_scene(
                all_nearby, nearby_primary_xbd_id
            )
            action = build_map_action_from_buildings(
                all_nearby, label_text, nearby_primary_xbd_id
            )
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": focus,
                "highlighted_buildings": nearby_scene_buildings,
                "action": action,
            }

        if wants_all_buildings:
            counts = count_damage_levels(buildings)
            answer = synthesize_location_overview_answer(
                f"near {label_text}", counts
            )
        elif damage_type == "no-damage":
            answer = (
                f"{len(buildings)} buildings near {label_text} appear to have "
                "no visible damage."
            )
        else:
            answer = generate_proximity_llm_answer(
                buildings, label_text, damage_type, radius_m
            )

        action = (
            build_building_action(buildings[0])
            if len(buildings) == 1
            else build_map_action_from_buildings(
                buildings, label_text, primary_xbd_id
            )
        )

        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": focus,
            "highlighted_buildings": scene_buildings if len(buildings) > 1 else buildings,
            "action": action,
        }

    # generic location-based queries
    address = primary_location
    if not address:
        answer = ambiguous_query_response(parsed_query)
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action(),
        }

    geo = geocode_address(address)

    if not geo:
        display_address = format_location_label(address)
        all_buildings = get_all_buildings_by_address_text(address)
        filtered_buildings = [
            b for b in all_buildings
            if b.get("damage") == damage_type
        ]
        primary_all_xbd_id = get_dominant_xbd_id(all_buildings)
        primary_filtered_xbd_id = get_dominant_xbd_id(filtered_buildings)
        scene_all_buildings = get_buildings_for_primary_scene(all_buildings, primary_all_xbd_id)
        scene_filtered_buildings = get_buildings_for_primary_scene(filtered_buildings, primary_filtered_xbd_id)

        if parsed_query["wants_summary"]:
            counts = count_damage_levels(all_buildings)
            answer = format_damage_count_response(counts, display_address)
            action = (
                build_map_action_from_buildings(all_buildings, display_address, primary_all_xbd_id)
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

        if advisory:
            if len(all_buildings) == 0:
                answer = f"I couldn't find enough nearby damage data to give a reliable advisory for {display_address}."
                action = build_no_action()
            else:
                answer = advisory_response(question, all_buildings, display_address)
                action = build_map_action_from_buildings(all_buildings, display_address, primary_all_xbd_id)

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
            answer = f"{len(filtered_buildings)} buildings in {display_address} appear to have no visible damage."
        else:
            answer = generate_llm_answer(filtered_buildings, display_address, damage_type)

        action = (
            build_building_action(filtered_buildings[0])
            if len(filtered_buildings) == 1
            else build_map_action_from_buildings(filtered_buildings, display_address, primary_filtered_xbd_id)
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
    if parsed_query["wants_summary"]:
        all_buildings = get_all_buildings_near(
            geo["lon"],
            geo["lat"],
            NEARBY_SEARCH_RADIUS_METERS,
        )
        used_address_fallback = len(all_buildings) == 0
        if used_address_fallback:
            all_buildings = get_all_buildings_by_address_text(address)
        primary_all_xbd_id = get_nearest_xbd_id(all_buildings)
        scene_all_buildings = get_buildings_for_primary_scene(all_buildings, primary_all_xbd_id)

        if len(all_buildings) == 0:
            answer = format_damage_count_response({}, geo["formatted_address"])
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action(),
            }

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
    if advisory:
        all_buildings = get_all_buildings_near(
            geo["lon"],
            geo["lat"],
            NEARBY_SEARCH_RADIUS_METERS,
        )
        used_address_fallback = len(all_buildings) == 0
        if used_address_fallback:
            all_buildings = get_all_buildings_by_address_text(address)
        primary_all_xbd_id = get_nearest_xbd_id(all_buildings)
        scene_all_buildings = get_buildings_for_primary_scene(all_buildings, primary_all_xbd_id)

        if len(all_buildings) == 0:
            answer = "I couldn't find enough nearby damage data to give a reliable advisory for that area."
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action(),
            }
        else:
            answer = advisory_response(question, all_buildings, geo["formatted_address"])

            # create a map navigation action because advisory answers still relate to this location
            action = build_map_action_from_buildings(all_buildings, geo["formatted_address"], primary_all_xbd_id)

        # package chatbot answer, map focus, highlighted buildings, and navigation action
        payload = build_map_payload(answer, geo, scene_all_buildings, action)


        save_turn(question, answer)
        return payload

    resolved_geo, resolved_label_text, all_buildings = resolve_location_buildings(
        address
    )
    map_geo = resolved_geo or geo
    location_label = resolved_label_text or geo["formatted_address"]

    if len(all_buildings) == 0 and geo:
        all_buildings = get_all_buildings_near(
            geo["lon"],
            geo["lat"],
            NAMED_LOCATION_OVERVIEW_RADIUS_M,
        )
        if len(all_buildings) > 0:
            resolved_geo = geo
            map_geo = geo
            location_label = geo["formatted_address"]

    # Exact damage count queries should count from the full resolved location set,
    # then choose one representative scene only for map visualization. If the
    # user did not name a damage class, keep the full location set.
    buildings = (
        all_buildings
        if wants_all_buildings
        else filter_buildings_by_damage(all_buildings, damage_type)
    )
    primary_buildings_xbd_id = (
        get_primary_xbd_id(buildings)
        if len(buildings) > 0
        else get_primary_xbd_id(all_buildings)
    )
    scene_buildings = get_buildings_for_primary_scene(buildings, primary_buildings_xbd_id)
    if len(scene_buildings) == 0:
        primary_buildings_xbd_id = get_primary_xbd_id(buildings)
        scene_buildings = get_buildings_for_primary_scene(buildings, primary_buildings_xbd_id)

    if len(buildings) == 0:
        all_nearby = get_all_buildings_near(
            geo["lon"],
            geo["lat"],
            NEARBY_SEARCH_RADIUS_METERS,
        )
        radius_label = format_radius_label(NEARBY_SEARCH_RADIUS_METERS)
        label = damage_type.replace("-", " ")
        if not all_nearby:
            answer = (
                f"No assessed buildings appear in our database within about {radius_label} of "
                f"{geo['formatted_address']}. "
                "The dataset imagery may not cover this spot, or the search radius may be too small."
            )
            save_turn(question, answer)
            return {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": [],
                "action": build_no_action(),
            }

        nearby_primary_xbd_id = get_dominant_xbd_id(all_nearby)
        nearby_scene_buildings = get_buildings_for_primary_scene(
            all_nearby,
            nearby_primary_xbd_id,
        )
        action = build_map_action_from_buildings(
            all_nearby,
            geo["formatted_address"],
            nearby_primary_xbd_id,
        )
        counts = count_damage_levels(all_nearby)
        if wants_all_buildings:
            answer = synthesize_location_overview_answer(
                f"within about {radius_label} of {geo['formatted_address']}",
                counts,
            )
        else:
            answer = (
                f"Within about {radius_label} of {geo['formatted_address']}, no buildings are classified as "
                f"{label}. "
                + format_damage_count_response(counts, "that radius")
            )
        payload = build_map_payload(answer, geo, nearby_scene_buildings, action)
        save_turn(question, answer)
        return payload

    if wants_all_buildings:
        counts = count_damage_levels(buildings)
        answer = synthesize_location_overview_answer(location_label, counts)
    elif damage_type == "no-damage":
        answer = f"{len(buildings)} buildings in {location_label} appear to have no visible damage."
    else:
        answer = generate_llm_answer(buildings, location_label, damage_type)

    # if only one building matched, frontend can route directly to that building
    if len(buildings) == 1:
        action = build_building_action(buildings[0])

    # if multiple buildings matched, frontend should route/focus to the map view
    else:
        action = build_map_action_from_buildings(
            buildings,
            location_label,
            primary_buildings_xbd_id,
        )

    # package chatbot answer, map focus, highlighted buildings, and navigation action
    payload = build_map_payload(answer, map_geo, scene_buildings, action)
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
