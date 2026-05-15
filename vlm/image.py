import json
import os
from PIL import Image
from shapely.wkt import loads as load_wkt

# ========= CONFIG =========
# Set to a disaster name substring (matches label filenames) to process one disaster.
# Set to None or "" to process every disaster that appears under IMG_DIR (each under paired_crops/<name>/).
DISASTER = None
# Max label tiles (image pairs) per disaster; None = no limit. Use a small int for quick tests.
MAX_IMAGES = None

IMG_DIR = "imagery/test/images"
LABEL_DIR = "imagery/test/labels"
PAIRED_CROPS_ROOT = "imagery/test/paired_crops"

# ========= HELPERS =========
def disaster_from_pair_base(base):
    """xBD-style base like 'hurricane-harvey_00000001' -> 'hurricane-harvey'."""
    return base.rsplit("_", 1)[0]


def disasters_in_image_dir(img_dir):
    """Disaster names inferred from *_post_disaster.png in img_dir."""
    out = set()
    if not os.path.isdir(img_dir):
        return out
    for name in os.listdir(img_dir):
        if not name.endswith("_post_disaster.png"):
            continue
        base = name.replace("_post_disaster.png", "")
        out.add(disaster_from_pair_base(base))
    return out


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
all_disasters = not DISASTER
if all_disasters:
    disasters_in_img = disasters_in_image_dir(IMG_DIR)
    if not disasters_in_img:
        raise SystemExit(f"No *_post_disaster.png files found under {IMG_DIR!r}")
else:
    disasters_in_img = None
    out_dir_single = os.path.join(PAIRED_CROPS_ROOT, DISASTER)
    os.makedirs(out_dir_single, exist_ok=True)

processed = 0
processed_by_disaster = {}
total_written = 0
total_skip_unclassified = 0
total_skip_small = 0

for file in sorted(os.listdir(LABEL_DIR)):
    if not file.endswith("_post_disaster.json"):
        continue

    base = file.replace("_post_disaster.json", "")
    pair_disaster = disaster_from_pair_base(base)

    if all_disasters:
        if pair_disaster not in disasters_in_img:
            continue
        if MAX_IMAGES is not None and processed_by_disaster.get(pair_disaster, 0) >= MAX_IMAGES:
            continue
        out_dir = os.path.join(PAIRED_CROPS_ROOT, pair_disaster)
    else:
        if DISASTER not in file:
            continue
        if MAX_IMAGES is not None and processed >= MAX_IMAGES:
            break
        out_dir = out_dir_single

    pre_json = os.path.join(LABEL_DIR, base + "_pre_disaster.json")
    post_json = os.path.join(LABEL_DIR, file)

    pre_img_path = os.path.join(IMG_DIR, base + "_pre_disaster.png")
    post_img_path = os.path.join(IMG_DIR, base + "_post_disaster.png")

    if not all(map(os.path.exists, [pre_json, post_json, pre_img_path, post_img_path])):
        continue

    os.makedirs(out_dir, exist_ok=True)

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

        pre_crop.save(os.path.join(out_dir, f"{pair_id}_pre.png"))
        post_crop.save(os.path.join(out_dir, f"{pair_id}_post_{damage}.png"))
        n_written += 1

    total_written += n_written
    total_skip_unclassified += n_skip_unclassified
    total_skip_small += n_skip_small

    print(
        f"{base}: {n_written} paired | "
        f"skipped un-classified={n_skip_unclassified} | skipped <5px={n_skip_small}"
    )

    if all_disasters:
        processed_by_disaster[pair_disaster] = processed_by_disaster.get(pair_disaster, 0) + 1
    else:
        processed += 1

print(
    f"TOTAL: {total_written} paired | "
    f"skipped un-classified={total_skip_unclassified} | skipped <5px={total_skip_small}"
)
