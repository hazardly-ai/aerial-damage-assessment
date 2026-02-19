import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

LABELS_DIR = Path(
    os.environ.get("LABELS_DIR", str(PROJECT_ROOT / "data" / "test" / "labels"))
)
