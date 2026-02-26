import json
import os
from PIL import Image
from shapely.wkt import loads as load_wkt

# ========= CONFIG =========
DISASTER = "hurricane-harvey"
MAX_IMAGES = 10

IMG_PRE = "original/prepost"
IMG_POST = "original/prepost"
LABEL_DIR = "original/labels"

OUT_DIR = f"paired_crops/{DISASTER}"
os.makedirs(OUT_DIR, exist_ok=True)

# ========= HELPERS =========
def load_buildings_by_uid(json_path):
    with open(json_path, "r") as f:
        data = json.load(f)

    buildings = {}
    for feat in data["features"].get("xy", []):
        props = feat.get("properties", {})
        if props.get("feature_type") != "building":
            continue

        uid = props.get("uid")
        buildings[uid] = {
            "polygon": load_wkt(feat["wkt"]),
            "damage": props.get("subtype", "unclassified")
        }
    return buildings

# ========= MAIN LOOP =========
processed = 0

for file in sorted(os.listdir(LABEL_DIR)):
    if not file.endswith("_post_disaster.json"):
        continue
    if DISASTER not in file:
        continue

    base = file.replace("_post_disaster.json", "")

    pre_json = os.path.join(LABEL_DIR, base + "_pre_disaster.json")
    post_json = os.path.join(LABEL_DIR, file)

    pre_img_path = os.path.join(IMG_PRE, base + "_pre_disaster.png")
    post_img_path = os.path.join(IMG_POST, base + "_post_disaster.png")

    if not all(map(os.path.exists, [pre_json, post_json, pre_img_path, post_img_path])):
        continue

    pre_img = Image.open(pre_img_path).convert("RGB")
    post_img = Image.open(post_img_path).convert("RGB")

    pre_buildings = load_buildings_by_uid(pre_json)
    post_buildings = load_buildings_by_uid(post_json)

    common_uids = sorted(set(pre_buildings) & set(post_buildings))

    for uid in common_uids:
        post_poly = post_buildings[uid]["polygon"]
        damage = post_buildings[uid]["damage"]

        minx, miny, maxx, maxy = map(int, post_poly.bounds)

        minx = max(0, minx)
        miny = max(0, miny)
        maxx = min(post_img.width, maxx)
        maxy = min(post_img.height, maxy)

        if maxx - minx < 5 or maxy - miny < 5:
            continue

        pre_crop = pre_img.crop((minx, miny, maxx, maxy))
        post_crop = post_img.crop((minx, miny, maxx, maxy))

        pair_id = f"{base}_{uid[:8]}"

        pre_crop.save(os.path.join(OUT_DIR, f"{pair_id}_pre.png"))
        post_crop.save(os.path.join(OUT_DIR, f"{pair_id}_post_{damage}.png"))

    print(f"{base}: {len(common_uids)} paired buildings")
    processed += 1

    if processed >= MAX_IMAGES:
        break
