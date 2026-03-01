# Synovia — AI Brain Surgery Simulation

Synovia converts MRI brain scans into interactive 3D models for neurosurgical planning. Surgeons can select any brain structure, run a simulated resection, and get AI-generated risk assessments — all before touching a patient.

Built at **HackPrinceton 2025**.

---

## What It Does

1. **Upload** a `.nii.gz` MRI scan (or use the included sample)
2. **Segment** — backend converts the scan into 60+ color-coded 3D brain structures (STL meshes)
3. **Visualize** — interactive Three.js renderer lets you rotate, zoom, and click any structure
4. **Simulate** — click a structure → FEA-style stress analysis runs
5. **AI Insights** — Google Gemini generates surgical risk summary + patient-friendly explanation

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + TypeScript + Three.js + React Three Fiber + TailwindCSS |
| Backend | FastAPI (Python 3.10+) + Google Gemini 2.0 |
| Segmentation | SynthSeg + nibabel + scikit-image + trimesh |
| State | Zustand |
| Build | Vite 7 |

---

## Project Structure

```
synovia/
├── frontend/           # React + Three.js UI
├── ml-backend/         # FastAPI server (active backend)
├── scripts/            # Data processing utilities
│   ├── segment.py          # MRI → brain region segmentation
│   ├── generate_meshes.py  # NIfTI → STL mesh conversion
│   ├── visualize.py        # Quick 3D mesh preview
│   └── visualize_full.py   # Full 3D visualizer
├── stl/                # 61 pre-generated brain structure meshes
├── 3d_meshes/          # 11 simplified region meshes
├── segmented_regions/  # Intermediate NIfTI segmentation files
├── IXI648-Guys-1107-T1.nii.gz   # Sample MRI scan
└── mni152.nii.gz                # MNI152 brain template
```

---

## Quick Start

### Backend

```bash
cd ml-backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Add your GEMINI_API_KEY to .env

uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
# Opens at http://localhost:5173
```

---

## Environment Variables

Create `ml-backend/.env`:

```ini
GEMINI_API_KEY=your_gemini_api_key_here
CORS_ORIGINS=http://localhost:5173
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload `.nii.gz` scan |
| `GET` | `/api/stl/{case_id}` | List all STL files for a case |
| `GET` | `/api/stl/{case_id}/{filename}` | Download a specific STL mesh |
| `POST` | `/api/fea` | Run structure analysis + Gemini AI |
| `POST` | `/api/simulate` | Full surgery simulation |
| `GET` | `/api/health` | Health check |

---

## Pre-Generated Data

The `stl/` directory contains 61 pre-segmented brain structures from the included IXI648 sample scan. The app loads these immediately — no need to re-run segmentation for the demo.

To regenerate from a new scan:

```bash
python scripts/segment.py        # Segment MRI → NIfTI regions
python scripts/generate_meshes.py  # Convert NIfTI → STL meshes
```
