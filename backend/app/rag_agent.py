# importing libraries needed for database, API calls, and environment variables
import psycopg  # used to connect to PostgreSQL (Supabase)
import requests  # used to make HTTP API calls (Mapbox + Nemotron)
import os  # used to access environment variables
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
load_dotenv("backend/.env", override=True)




# function to connect to database using environment variables
def get_db_connection():
    return psycopg.connect(
        host=os.getenv("DB_HOST"),  # database host from Supabase
        port=os.getenv("DB_PORT", "5432"),  # default postgres port
        dbname=os.getenv("DB_NAME", "postgres"),  # database name
        user=os.getenv("DB_USER"),  # database user
        password=os.getenv("DB_PASSWORD"),  # database password
    )





# function to convert SQL rows into Python dictionary format (easier to work with)
def rows_to_buildings(rows):
    buildings = []

    for r in rows:
        buildings.append({
            "id": r[0],  # building id
            "damage": r[1],  # predicted damage label
            "geometry": r[2]  # geometry (GeoJSON format)
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
    return call_nemotron(prompt)


# function to query buildings near a location using PostGIS
def get_buildings_near(lon, lat, radius_m, damage_filter):

    conn = get_db_connection()  # connecting to database
    cur = conn.cursor()

    # SQL query using spatial filtering (ST_DWithin)
    query = """
    SELECT id, predicted_damage, ST_AsGeoJSON(geom)
    FROM buildings
    WHERE ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
        %s
    )
    AND predicted_damage = %s
    """

    # executing query safely using parameters
    cur.execute(query, (lon, lat, radius_m, damage_filter))

    rows = cur.fetchall()  # getting results

    cur.close()
    conn.close()

    return rows_to_buildings(rows)  # converting to dictionary format

def get_all_buildings_near(lon, lat, radius_m):
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT id, predicted_damage, ST_AsGeoJSON(geom)
    FROM buildings
    WHERE ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
        %s
    )
    """

    cur.execute(query, (lon, lat, radius_m))
    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows_to_buildings(rows)


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




# FRONTEND MAP HANDOFF:
# This payload is meant for the frontend Mapbox team.
# Use "focus" to zoom/pan the map to the queried location.
# Use "highlighted_buildings" to draw the returned building polygons on the map.
# Each building includes:
#   - id: building identifier
#   - damage: damage label used for color-coding
#   - geometry: GeoJSON polygon from PostGIS
def build_map_payload(answer, geo, buildings):
    return {
        "answer": answer,
        "focus": {
            "lat": geo["lat"],
            "lon": geo["lon"],
            "address": geo["formatted_address"]
        },
        "highlighted_buildings": buildings
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
        return "Nemotron not configured"

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

    response = requests.post(url, headers=headers, json=payload)

    if response.status_code != 200:
        return f"Error: {response.text}"

    data = response.json()

    return data["choices"][0]["message"]["content"].strip('"')




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
        result = call_nemotron(prompt)
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

    return str(Settings.llm.complete(prompt)).strip('"').split(")*")[0]


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

    return call_nemotron(prompt)


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

    return call_nemotron(prompt)



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
            "focus": None,
            "highlighted_buildings": []
        }

    # detect VLM/image-related queries
    if is_vlm_query(question):
        answer = vlm_guidance_response()
        save_turn(question, answer)
        return {
            "answer": answer,
            "focus": None,
            "highlighted_buildings": []
        }

    # conversation summary
    if is_conversation_summary_query(question):
        answer = summarize_conversation()
        save_turn(question, answer)
        return {
            "answer": answer,
            "focus": None,
            "highlighted_buildings": []
        }

    # block non-disaster queries
    if not is_disaster_related(question):
        answer = "I can only answer disaster-related queries about damage, safety, and assessments."
        save_turn(question, answer)
        return {
            "answer": answer,
            "focus": None,
            "highlighted_buildings": []
        }

    # full dataset summary does not have a single map focus
    if is_full_dataset_query(question):
        counts = get_full_dataset_damage_counts()
        answer = format_damage_count_response(counts, "the full dataset")
        save_turn(question, answer)
        return {
            "answer": answer,
            "focus": None,
            "highlighted_buildings": []
        }

    # location-based queries
    address, damage_type = parse_question(question)
    geo = geocode_address(address)

    if not geo:
        answer = "Could not find that location. Try a different place."
        save_turn(question, answer)
        return {
            "answer": answer,
            "focus": None,
            "highlighted_buildings": []
        }

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

        payload = build_map_payload(answer, geo, all_buildings)
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
        else:
            answer = advisory_response(question, all_buildings, geo["formatted_address"])

        payload = build_map_payload(answer, geo, all_buildings)
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
            "answer": answer,
            "focus": {
                "lat": geo["lat"],
                "lon": geo["lon"],
                "address": geo["formatted_address"]
            },
            "highlighted_buildings": []
        }

    if damage_type == "no-damage":
        answer = f"{len(buildings)} buildings in {geo['formatted_address']} appear to have no visible damage."
    else:
        answer = generate_llm_answer(buildings, geo["formatted_address"], damage_type)

    payload = build_map_payload(answer, geo, buildings)
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