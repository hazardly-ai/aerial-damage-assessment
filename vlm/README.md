# VLM Damage Training Workflow

This folder supports **supervised training** and **inference** using a trained RemoteCLIP encoder plus damage head (checkpoint produced by training).

## Data format

Training expects disaster folders under each split’s `paired_crops_root`:

`{paired_crops_root}/{disaster_name}`

Each building pair should follow:
- `{pair_id}_pre.png`
- `{pair_id}_post_{damage_label}.png`

Supported labels:
- `no-damage`
- `minor-damage`
- `major-damage`
- `destroyed`

## Train

Edit config in `vlm/configs/train_damage.yaml`, then run:

```bash
python vlm/train_damage_classifier.py --config vlm/configs/train_damage.yaml
```

Configure train, validation, and test data separately. Each split has its own `paired_crops_root` (they may all point at the same folder) and optional `disasters` list (omit or `[]` to use every disaster subfolder under that root):

```yaml
split:
  max_pairs_per_disaster: 1000
  train:
    paired_crops_root: vlm/imagery/paired_crops
    disasters: [hurricane-harvey, hurricane-michael]
  val:
    paired_crops_root: vlm/imagery/paired_crops_val
    disasters: [santa-rosa-wildfire]
  test:
    paired_crops_root: vlm/imagery/paired_crops_test
    disasters: [hurricane-michael]
```

Outputs:
- split manifest: `vlm/artifacts/split_manifest.json`
- train history: `vlm/artifacts/train_history.json`
- best checkpoint: `vlm/checkpoints/best_damage_classifier.pt`

## Evaluate

```bash
python vlm/eval_damage_classifier.py \
  --checkpoint vlm/checkpoints/best_damage_classifier.pt \
  --paired-crops-root imagery/paired_crops
```

Optional subset:

```bash
python vlm/eval_damage_classifier.py \
  --checkpoint vlm/checkpoints/best_damage_classifier.pt \
  --paired-crops-root imagery/paired_crops \
  --disasters hurricane-harvey
```

## Local inference

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (e.g. in `.env`). `--checkpoint` is required.

```bash
python vlm/local_inference.py imagery/paired_crops/hurricane-harvey \
  --checkpoint vlm/checkpoints/best_damage_classifier.pt
```

Optional: `--infer-batch-size` (default 32), `--batch-size` (progress logging interval, default 100).

Updates `predicted_damage` on existing `buildings` rows matched by uid (no inserts).

## Modal inference

`vlm/modal_inference.py` defines a Modal app with `predict_buildings(folder, batch_size=100, checkpoint_path=...)`. Pass a `checkpoint_path` that exists on the GPU worker (e.g. on the mounted `/images` volume). Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as Modal secrets for the function environment.
