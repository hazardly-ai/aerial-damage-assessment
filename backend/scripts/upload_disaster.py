#!/usr/bin/env python3
"""Orchestrator for uploading a single disaster's data to Supabase.

Usage:
    cd backend
    python scripts/upload_disaster.py <disaster_name>

Example:
    python scripts/upload_disaster.py hurricane-michael
"""

import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent

# Import the individual modules
import seed_db
import seed_geotransforms
import upload_images


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python scripts/upload_disaster.py <disaster_name>")

    disaster_name = sys.argv[1]
    t0 = time.perf_counter()

    print(f"Starting upload for disaster: {disaster_name}")
    print("=" * 50)

    # Step 1: Seed database with label data
    print("\n1. Seeding database with label data...")
    try:
        seed_db.main(disaster_name)
        print("✓ Database seeding completed")
    except Exception as e:
        print(f"✗ Database seeding failed: {e}")
        sys.exit(1)

    # Step 2: Add geotransforms (if available)
    print("\n2. Adding geotransforms...")
    try:
        seed_geotransforms.main(disaster_name)
        print("✓ Geotransforms completed")
    except Exception as e:
        print(f"✗ Geotransforms failed: {e}")
        # Continue anyway as geotransforms are optional

    # Step 3: Upload images
    print("\n3. Uploading images...")
    try:
        upload_images.main(disaster_name)
        print("✓ Image upload completed")
    except Exception as e:
        print(f"✗ Image upload failed: {e}")
        sys.exit(1)

    elapsed = time.perf_counter() - t0
    print(f"\n{'='*50}")
    print(f"Disaster upload completed in {elapsed:.1f}s")
    print(f"All data for '{disaster_name}' has been uploaded to Supabase")


if __name__ == "__main__":
    main()
