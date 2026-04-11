import json
import os
from PIL import Image
from shapely.wkt import loads as load_wkt

# ========= CONFIG =========
DISASTER = "hurricane-harvey"
MAX_IMAGES = 1

IMG_PRE = "imagery/original/prepost"
IMG_POST = "imagery/original/prepost"
LABEL_DIR = "imagery/original/labels"

OUT_DIR = f"imagery/paired_crops/{DISASTER}"
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
            "damage": props.get("subtype"),
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

    n_written = 0
    for uid in common_uids:
        post_poly = post_buildings[uid]["polygon"]
        damage = post_buildings[uid]["damage"]
        if str(damage).strip() == "un-classified":
            continue

        minx, miny, maxx, maxy = map(int, post_poly.bounds)

        minx = max(0, minx)
        miny = max(0, miny)
        maxx = min(post_img.width, maxx)
        maxy = min(post_img.height, maxy)

        if maxx - minx < 5 or maxy - miny < 5:
            continue

        pre_crop = pre_img.crop((minx, miny, maxx, maxy))
        post_crop = post_img.crop((minx, miny, maxx, maxy))

        pair_id = f"{base}_{uid}"

        pre_crop.save(os.path.join(OUT_DIR, f"{pair_id}_pre.png"))
        post_crop.save(os.path.join(OUT_DIR, f"{pair_id}_post_{damage}.png"))
        n_written += 1

    print(f"{base}: {n_written} paired buildings")
    processed += 1

    if processed >= MAX_IMAGES:
        break
