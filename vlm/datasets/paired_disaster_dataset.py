import os
import random
import re
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from PIL import Image
from torch.utils.data import Dataset


DEFAULT_LABEL_MAP: Dict[str, int] = {
    "no-damage": 0,
    "minor-damage": 1,
    "major-damage": 2,
    "destroyed": 3,
}

PRE_PATTERN = re.compile(r"^(?P<pair_id>.+)_pre\.png$")
POST_PATTERN = re.compile(r"^(?P<pair_id>.+)_post_(?P<label>.+)\.png$")


@dataclass
class PairedSample:
    pair_id: str
    disaster: str
    pre_path: str
    post_path: str
    label_name: str
    label_id: int


def _is_png(filename: str) -> bool:
    return filename.lower().endswith(".png")


def discover_paired_samples(
    paired_crops_root: str,
    label_map: Optional[Dict[str, int]] = None,
    include_disasters: Optional[List[str]] = None,
    exclude_disasters: Optional[List[str]] = None,
    max_pairs_per_disaster: Optional[int] = None,
    subsample_seed: int = 0,
) -> List[PairedSample]:
    label_map = label_map or DEFAULT_LABEL_MAP
    include_set = set(include_disasters or [])
    exclude_set = set(exclude_disasters or [])

    subsample = max_pairs_per_disaster is not None and max_pairs_per_disaster > 0
    rng = random.Random(subsample_seed) if subsample else None

    samples: List[PairedSample] = []
    if not os.path.isdir(paired_crops_root):
        raise FileNotFoundError(f"Paired crops root not found: {paired_crops_root}")

    for disaster in sorted(os.listdir(paired_crops_root)):
        disaster_dir = os.path.join(paired_crops_root, disaster)
        if not os.path.isdir(disaster_dir):
            continue
        if include_set and disaster not in include_set:
            continue
        if disaster in exclude_set:
            continue

        pre_paths: Dict[str, str] = {}
        post_paths: Dict[str, str] = {}
        post_labels: Dict[str, str] = {}

        for filename in sorted(os.listdir(disaster_dir)):
            if not _is_png(filename):
                continue

            pre_match = PRE_PATTERN.match(filename)
            if pre_match:
                pair_id = pre_match.group("pair_id")
                pre_paths[pair_id] = os.path.join(disaster_dir, filename)
                continue

            post_match = POST_PATTERN.match(filename)
            if post_match:
                pair_id = post_match.group("pair_id")
                label_name = post_match.group("label")
                if label_name not in label_map:
                    continue
                post_paths[pair_id] = os.path.join(disaster_dir, filename)
                post_labels[pair_id] = label_name

        disaster_samples: List[PairedSample] = []
        for pair_id, pre_path in pre_paths.items():
            post_path = post_paths.get(pair_id)
            label_name = post_labels.get(pair_id)
            if not post_path or label_name is None:
                continue
            disaster_samples.append(
                PairedSample(
                    pair_id=pair_id,
                    disaster=disaster,
                    pre_path=pre_path,
                    post_path=post_path,
                    label_name=label_name,
                    label_id=label_map[label_name],
                )
            )

        if subsample and rng is not None:
            rng.shuffle(disaster_samples)
            disaster_samples = disaster_samples[:max_pairs_per_disaster]

        samples.extend(disaster_samples)

    return samples


class PairedDisasterDataset(Dataset):
    def __init__(
        self,
        samples: List[PairedSample],
        transform: Callable,
    ) -> None:
        self.samples = samples
        self.transform = transform

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        sample = self.samples[index]
        pre_image = Image.open(sample.pre_path).convert("RGB")
        post_image = Image.open(sample.post_path).convert("RGB")

        return {
            "pre_image": self.transform(pre_image),
            "post_image": self.transform(post_image),
            "label": sample.label_id,
            "label_name": sample.label_name,
            "pair_id": sample.pair_id,
            "disaster": sample.disaster,
        }

