# importing libraries needed for database, API calls, and environment variables
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

    # extract location if "near" exists
    if "near" in q:
        parts = q.split("near")
        if len(parts) > 1:
            address = parts[1].replace("?", "").strip()

            for word in ["damage", "buildings", "area"]:
                address = address.replace(word, "").strip()

            # fix vague location like "me"
            if address in ["me", "here", "my", "", "?"]:
                address = "Houston Texas"
        else:
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

    coords = data["features"][0]["center"]

    return {
        "lon": coords[0],  # longitude
        "lat": coords[1],  # latitude
        "formatted_address": data["features"][0]["place_name"]  # clean address
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
    """

    # executing query safely using parameters
    cur.execute(query, (lon, lat, radius_m, damage_filter))

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
    """

    cur.execute(query, (lon, lat, radius_m))  # safely passing lon, lat, and radius into SQL
    rows = cur.fetchall()  # getting all matching nearby buildings

    cur.close()  
    conn.close()  # closing database connection

    return rows_to_buildings(rows)  # converting SQL rows into frontend-friendly dictionaries


def get_buildings_by_address_text(address_text, damage_filter):
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE b.address IS NOT NULL
      AND b.address ILIKE %s
      AND b.predicted_damage = %s
    """

    cur.execute(query, (f"%{address_text}%", damage_filter))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


def get_all_buildings_by_address_text(address_text):
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT b.uid, ip.xbd_id, b.predicted_damage, ST_AsGeoJSON(b.geom)
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE b.address IS NOT NULL
      AND b.address ILIKE %s
    """

    cur.execute(query, (f"%{address_text}%",))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


def build_map_action_from_buildings(buildings, address_text=None):
    xbd_ids = sorted({
        b.get("xbd_id")
        for b in buildings
        if b.get("xbd_id") is not None
    })

    primary_xbd_id = xbd_ids[0] if len(xbd_ids) == 1 else (xbd_ids[0] if xbd_ids else None)

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
        return f"I couldn’t find damage assessment data for {location_text}."

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

    primary_xbd_id = xbd_ids[0] if len(xbd_ids) == 1 else None  # only choose route if all buildings are from one xbd scene

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
        return f"I couldn’t find enough nearby damage data to assess conditions around {address}."
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
        return f"I couldn’t find damage assessment data for {address}."

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

    return any(k in q for k in [
        "full dataset",
        "whole dataset",
        "entire dataset",
        "all buildings",
        "overall dataset",
        "dataset summary",
        "overall damage in the dataset"
    ])


def is_conversation_summary_query(question):
    q = question.lower()
    return any(k in q for k in [
        "summarize conversation",
        "what have we discussed",
        "recap",
        "conversation summary"
        
    ])

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
        answer = format_damage_count_response(counts, "the full dataset")
        save_turn(question, answer)
        return {
            "answer": answer,
            "response": answer,  # same text for frontend compatibility
            "focus": None,
            "highlighted_buildings": [],
            "action": build_no_action()  # full dataset does not navigate to one route
        }

    _, damage_type = parse_question(question)

    address_filter_text = extract_address_filter_text(question)
    if address_filter_text:
        buildings = get_buildings_by_address_text(address_filter_text, damage_type)
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
            else build_map_action_from_buildings(buildings, label_text)
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
            "highlighted_buildings": buildings,
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

        if is_data_summary_query(question):
            counts = count_damage_levels(all_buildings)
            answer = format_damage_count_response(counts, address)
            action = (
                build_map_action_from_buildings(all_buildings, address)
                if len(all_buildings) > 0
                else build_no_action()
            )
            payload = {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": all_buildings,
                "action": action,
            }
            save_turn(question, answer)
            return payload

        advisory = detect_advisory(question)
        if advisory:
            if len(all_buildings) == 0:
                answer = f"I couldn’t find enough nearby damage data to give a reliable advisory for {address}."
                action = build_no_action()
            else:
                answer = advisory_response(question, all_buildings, address)
                action = build_map_action_from_buildings(all_buildings, address)

            payload = {
                "answer": answer,
                "response": answer,
                "focus": None,
                "highlighted_buildings": all_buildings,
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
            else build_map_action_from_buildings(filtered_buildings, address)
        )

        payload = {
            "answer": answer,
            "response": answer,
            "focus": None,
            "highlighted_buildings": filtered_buildings,
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

        counts = count_damage_levels(all_buildings)

        answer = format_damage_count_response(
            counts,
            geo["formatted_address"]
        )

        # create a map navigation action so frontend can route/focus to the result area
        action = build_map_action(geo, all_buildings)

        # package chatbot answer, map focus, highlighted buildings, and navigation action
        payload = build_map_payload(answer, geo, all_buildings, action)

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

        if len(all_buildings) == 0:
            answer = "I couldn’t find enough nearby damage data to give a reliable advisory for that area."
            action = build_no_action()
        else:
            answer = advisory_response(question, all_buildings, geo["formatted_address"])

            # create a map navigation action because advisory answers still relate to this location
            action = build_map_action(geo, all_buildings)

        # package chatbot answer, map focus, highlighted buildings, and navigation action
        payload = build_map_payload(answer, geo, all_buildings, action)


        save_turn(question, answer)
        return payload

    # exact damage count questions use filtered buildings
    buildings = get_buildings_near(
        geo["lon"],
        geo["lat"],
        5000,
        damage_type
    )

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
        action = build_map_action(geo, buildings)

    # package chatbot answer, map focus, highlighted buildings, and navigation action
    payload = build_map_payload(answer, geo, buildings, action)
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
