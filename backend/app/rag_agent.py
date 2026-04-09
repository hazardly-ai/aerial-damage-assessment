import json
import os


# Step 1: load JSON from frontend
def load_buildings():
    current_dir = os.path.dirname(__file__)

    file_path = os.path.join(
        current_dir,
        "..",
        "..",
        "frontend",
        "src",
        "assets",
        "hurricane-harvey_00000018_post_disaster.json"
    )

    file_path = os.path.abspath(file_path)

    with open(file_path) as f:
        data = json.load(f)
        return data["features"]["lng_lat"]


# Step 2: extract damage info
def get_buildings():
    raw = load_buildings()

    buildings = []
    for b in raw:
        damage = b["properties"]["subtype"]
        buildings.append({"damage": damage})

    return buildings


# Step 3: count damaged buildings
def count_damaged(buildings):
    return len([
        b for b in buildings
        if b["damage"] in ["major-damage", "major_damage", "minor-damage"]
    ])


# Step 4: breakdown by type (for context)
def count_by_type(buildings):
    counts = {}
    for b in buildings:
        d = b["damage"]
        counts[d] = counts.get(d, 0) + 1
    return counts


# Step 5: simulate RAG answer generation
def generate_answer(count, breakdown):
    context = f"""
Damage summary:
{breakdown}
"""

    answer = f"""
There are {count} buildings with damage in this area.

Most buildings are undamaged, with only a small number showing minor damage.
"""

    return context, answer


# Step 6: main flow
def main():
    print("Using real dataset from frontend...")

    buildings = get_buildings()

    # optional: preview data
    print("Sample buildings:", buildings[:5])

    count = count_damaged(buildings)
    breakdown = count_by_type(buildings)

    context, answer = generate_answer(count, breakdown)

    print("\n--- CONTEXT (for LLM) ---")
    print(context)

    print("\n--- FINAL ANSWER ---")
    print(answer)


if __name__ == "__main__":
    main()