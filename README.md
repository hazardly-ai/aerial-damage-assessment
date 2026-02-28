# aerial-damage-assessment
Automated Disaster Damage Assessment from Aerial Imagery

## Structure
- frontend: React + Vite + Tailwind + shadcn
- backend: FastAPI

## Frontend setup
```bash
cd frontend
npm install
npm run dev
```
### 🧹 Code Quality (Biome)
This project uses **Biome** for formatting, linting, and import organization.

#### Run Locally before Commits
```bash
npm run check
```
Formats code, applies safe lint fixes, and organizes imports. Some errors will need to be fixed done manually

#### Continuous Integration
All pull requests must pass:
```bash
npm run ci
```
CI runs Biome in read-only mode and fails if issues are found.

## Backend setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Health check
Open http://localhost:8000/health to verify the API is running.
