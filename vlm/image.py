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


def clamp_crop_bounds(polygon, img_w, img_h):
    minx, miny, maxx, maxy = map(int, polygon.bounds)
    minx = max(0, minx)
    miny = max(0, miny)
    maxx = min(img_w, maxx)
    maxy = min(img_h, maxy)
    return minx, miny, maxx, maxy


# ========= MAIN LOOP =========
processed = 0
total_written = 0
total_skip_unclassified = 0
total_skip_small = 0

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
    n_skip_unclassified = 0
    n_skip_small = 0
    for uid in common_uids:
        pre_poly = pre_buildings[uid]["polygon"]
        post_poly = post_buildings[uid]["polygon"]
        damage = post_buildings[uid]["damage"]
        if str(damage).strip() == "un-classified":
            n_skip_unclassified += 1
            continue

        pre_bounds = clamp_crop_bounds(pre_poly, pre_img.width, pre_img.height)
        post_bounds = clamp_crop_bounds(post_poly, post_img.width, post_img.height)

        pre_w = pre_bounds[2] - pre_bounds[0]
        pre_h = pre_bounds[3] - pre_bounds[1]
        post_w = post_bounds[2] - post_bounds[0]
        post_h = post_bounds[3] - post_bounds[1]
        if min(pre_w, pre_h, post_w, post_h) < 5:
            n_skip_small += 1
            continue

        pre_crop = pre_img.crop(pre_bounds)
        post_crop = post_img.crop(post_bounds)

        pair_id = f"{base}_{uid}"

        pre_crop.save(os.path.join(OUT_DIR, f"{pair_id}_pre.png"))
        post_crop.save(os.path.join(OUT_DIR, f"{pair_id}_post_{damage}.png"))
        n_written += 1

    total_written += n_written
    total_skip_unclassified += n_skip_unclassified
    total_skip_small += n_skip_small

    print(
        f"{base}: {n_written} paired | "
        f"skipped un-classified={n_skip_unclassified} | skipped <5px={n_skip_small}"
    )
    processed += 1

    if processed >= MAX_IMAGES:
        break

print(
    f"TOTAL: {total_written} paired | "
    f"skipped un-classified={total_skip_unclassified} | skipped <5px={total_skip_small}"
)
