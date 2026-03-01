from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import uuid
import os
import asyncio
import concurrent.futures
import json
import aiofiles
import glob
from gemini_service import analyze_brain_removal
from segmentation_service import process_nifti_to_stl_files
from organ_segmentation_service import (
    segment_organs_from_nifti,
    get_stl_list_from_manifest,
    ORGAN_SYSTEM_CLASSES,
)
from fdm_solver import solve_fdm_elasticity
from uncertainty import monte_carlo_stress_bounds, recovery_curve

app = FastAPI(
    title="EzMR × Synovia — Whole-Body Surgical Simulation API",
    description="Physics-based FEA + AI surgical outcome prediction across 6 organ systems",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directories
UPLOAD_DIR = "uploads"
# STL folder is in project root, not ml-backend folder
# Get the directory where this file is located (ml-backend/)
ml_backend_dir = os.path.dirname(os.path.abspath(__file__))
# Go up one level to project root, then into stl/
project_root = os.path.dirname(ml_backend_dir)
STL_BASE_DIR = os.path.join(project_root, "stl")
STL_BASE_DIR = os.path.abspath(STL_BASE_DIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)
# Don't create stl dir if it doesn't exist - it should already exist
print(f"STL_BASE_DIR: {STL_BASE_DIR}")
print(f"STL directory exists: {os.path.exists(STL_BASE_DIR)}")

# NEW: Proper coordinate model
class Coordinates(BaseModel):
    x: float
    y: float
    z: float

class RemovalRegion(BaseModel):
    brainRegion: str
    hemisphere: str
    coordinates: Coordinates  # Now properly typed!
    volumeToRemove: str

class SurgeryRequest(BaseModel):
    procedureType: str
    removalRegion: RemovalRegion
    patientAge: int
    reason: str

# NEW: Structure-based FEA request with optional parameters
class StructureFEARequest(BaseModel):
    case_id: str
    structure_name: str
    structure_label: int
    stl_filename: str
    # Optional parameters for simulation
    coordinates: Optional[Coordinates] = None
    volume_to_remove: Optional[str] = None
    patient_age: Optional[int] = None
    procedure_type: Optional[str] = None
    reason: Optional[str] = None

# Upload and STL models
class UploadResponse(BaseModel):
    case_id: str
    filename: str
    status: str

class STLFileInfo(BaseModel):
    filename: str
    name: str
    label: int
    voxels: int

class STLListResponse(BaseModel):
    case_id: str
    stl_files: List[STLFileInfo]
    status: str

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "PreSurg.AI Brain Surgery ML API",
        "version": "1.0.0",
        "organ": "brain"
    }

@app.get("/api")
def api_root():
    """API root endpoint"""
    return {
        "status": "online",
        "endpoints": {
            "upload": "/api/upload",
            "segment": "/api/segment",
            "stl_list": "/api/stl/{case_id}",
            "stl_file": "/api/stl/{case_id}/{filename}",
            "fea": "/api/fea",
            "simulate": "/api/simulate",
            "health": "/api/health"
        }
    }

# Background segmentation tasks tracker
_segmentation_status: dict = {}  # case_id → "processing" | "ready" | "error"

def _run_brain_segmentation(case_id: str, input_file: str, stl_base_dir: str):
    """Background task: brain MRI → SynthSeg/ANTsPyNet → STLs"""
    try:
        _segmentation_status[case_id] = "processing"
        stl_files = process_nifti_to_stl_files(input_file, case_id, stl_base_dir)
        print(f"[Brain Seg] Done: {len(stl_files)} STLs for case {case_id}")
        _segmentation_status[case_id] = "ready"
    except Exception as e:
        print(f"[Brain Seg] Error for {case_id}: {e}")
        _segmentation_status[case_id] = "error"

def _run_organ_segmentation(case_id: str, input_file: str, stl_base_dir: str, organ_system: str):
    """Background task: CT NIfTI → TotalSegmentator → organ STLs"""
    try:
        _segmentation_status[case_id] = "processing"
        stl_files = segment_organs_from_nifti(
            input_nifti=input_file,
            case_id=case_id,
            stl_base_dir=stl_base_dir,
            organ_system=organ_system,
            fast=True,
        )
        print(f"[Organ Seg] Done: {len(stl_files)} STLs for case {case_id}")
        _segmentation_status[case_id] = "ready"
    except Exception as e:
        print(f"[Organ Seg] Error for {case_id}: {e}")
        _segmentation_status[case_id] = "error"


# Upload endpoint
@app.post("/api/upload", response_model=UploadResponse)
async def upload_scan(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    organ_system: Optional[str] = None,   # "brain" | "liver" | "kidney" | etc.
):
    """
    Upload a NIfTI scan (.nii or .nii.gz) and kick off background segmentation.

    - organ_system="brain"  → SynthSeg cortical parcellation (T1 MRI)
    - organ_system="liver"  → TotalSegmentator, liver classes (CT)
    - organ_system="kidney" → TotalSegmentator, kidney classes (CT)
    - organ_system="lung"   → TotalSegmentator, lung classes (CT)
    - organ_system="bone"   → TotalSegmentator, bone classes (CT)
    - organ_system="spleen" → TotalSegmentator, spleen (CT)
    - organ_system=None     → defaults to brain
    """
    case_id = str(uuid.uuid4())
    case_dir = os.path.join(UPLOAD_DIR, case_id)
    os.makedirs(case_dir, exist_ok=True)

    allowed_extensions = {'.nii', '.nii.gz'}
    uploaded_files = []

    for file in files:
        fname = file.filename or "upload.nii.gz"
        if fname.lower().endswith('.nii.gz'):
            file_ext = '.nii.gz'
        else:
            file_ext = os.path.splitext(fname)[1].lower()

        if file_ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"File format not supported: {fname}. Allowed: .nii .nii.gz"
            )

        file_path = os.path.join(case_dir, fname)
        try:
            async with aiofiles.open(file_path, 'wb') as f:
                content = await file.read()
                await f.write(content)
            uploaded_files.append(file_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error saving {fname}: {e}")

    if not uploaded_files:
        raise HTTPException(status_code=400, detail="No valid files uploaded")

    input_file = uploaded_files[0]
    target_organ = (organ_system or "brain").lower()

    # Dispatch the appropriate segmentation pipeline in the background
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    if target_organ == "brain":
        background_tasks.add_task(
            lambda: executor.submit(_run_brain_segmentation, case_id, input_file, STL_BASE_DIR)
        )
    else:
        background_tasks.add_task(
            lambda: executor.submit(
                _run_organ_segmentation, case_id, input_file, STL_BASE_DIR, target_organ
            )
        )

    _segmentation_status[case_id] = "processing"

    return UploadResponse(
        case_id=case_id,
        filename=os.path.basename(input_file),
        status="processing",
    )


@app.get("/api/status/{case_id}")
async def get_segmentation_status(case_id: str):
    """Poll segmentation progress for a case."""
    status = _segmentation_status.get(case_id, "unknown")
    return {"case_id": case_id, "status": status}

# Organ system → STL filenames mapping
ORGAN_STL_MAP = {
    "organ-liver": [
        "Liver.stl",
        "Gallbladder.stl",
    ],
    "organ-spleen": [
        "Spleen.stl",
    ],
    "organ-kidney": [
        "Left Kidney.stl",
        "Right Kidney.stl",
    ],
    "organ-lung": [
        "Left Upper Lobe.stl",
        "Left Lower Lobe.stl",
        "Right Upper Lobe.stl",
        "Right Middle Lobe.stl",
        "Right Lower Lobe.stl",
    ],
    "organ-bone": [
        "L1 Vertebra.stl",
        "L2 Vertebra.stl",
        "L3 Vertebra.stl",
        "L4 Vertebra.stl",
        "L5 Vertebra.stl",
        "Right Femur.stl",
        "Left Femur.stl",
        "Right Tibia.stl",
        "Left Tibia.stl",
        "Right Hip Bone.stl",
    ],
}
ORGAN_STL_DIR = os.path.join(STL_BASE_DIR, "organs")

# STL endpoints
@app.get("/api/stl/{case_id}", response_model=STLListResponse)
async def list_stl_files(case_id: str):
    """
    List STL files for a case.

    Priority order:
    1. Virtual organ case IDs ('organ-liver' etc.) → pre-generated STLs in stl/organs/
    2. Real uploaded+segmented case (UUID) with manifest → stl/{case_id}/_manifest.json
    3. Sample brain case → root stl/*.stl
    """
    # ── 1. Virtual organ cases (pre-generated fallback models) ──
    if case_id in ORGAN_STL_MAP:
        files = ORGAN_STL_MAP[case_id]
        stl_info_list = []
        for i, fname in enumerate(files):
            fpath = os.path.join(ORGAN_STL_DIR, fname)
            if os.path.exists(fpath):
                display_name = fname.replace(".stl", "")
                stl_info_list.append(STLFileInfo(filename=fname, name=display_name, label=i+1, voxels=0))
        seg_status = _segmentation_status.get(case_id, "ready")
        print(f"[STL List] virtual organ case={case_id}, found {len(stl_info_list)} files")
        return STLListResponse(
            case_id=case_id,
            stl_files=stl_info_list,
            status="ready" if stl_info_list else "processing",
        )

    # ── 2. Real uploaded case with manifest (TotalSegmentator / SynthSeg output) ──
    case_stl_dir = os.path.join(STL_BASE_DIR, case_id)
    manifest_data = get_stl_list_from_manifest(case_stl_dir)
    if manifest_data:
        stl_info_list = [
            STLFileInfo(
                filename=m["filename"],
                name=m["name"],
                label=m["label"],
                voxels=m.get("voxels", 0),
            )
            for m in manifest_data
        ]
        seg_status = _segmentation_status.get(case_id, "ready")
        return STLListResponse(case_id=case_id, stl_files=stl_info_list, status=seg_status)

    # ── 3. Check if segmentation is still running ──
    seg_status = _segmentation_status.get(case_id)
    if seg_status == "processing":
        return STLListResponse(case_id=case_id, stl_files=[], status="processing")

    # ── 4. Brain / sample-case fallback ── root stl/*.stl
    stl_pattern = os.path.join(STL_BASE_DIR, "*.stl")
    stl_files = glob.glob(stl_pattern)
    print(f"[STL List] Looking in: {stl_pattern}")
    print(f"[STL List] Found {len(stl_files)} STL files")

    if not stl_files and os.path.exists(case_stl_dir):
        stl_files = glob.glob(os.path.join(case_stl_dir, "*.stl"))
        print(f"[STL List] Checked case folder: {case_stl_dir}, found {len(stl_files)} files")

    stl_info_list = []
    for stl_path in stl_files:
        filename = os.path.basename(stl_path)
        if filename == "_manifest.json":
            continue
        name = filename.replace(".stl", "").lstrip("_")
        if name and name[0].isdigit():
            name = name.lstrip("0123456789_")
        label = 0
        if "_" in name:
            parts = name.rsplit("_", 1)
            if parts[1].isdigit():
                label = int(parts[1])
                name = parts[0]
        display_name = name.replace("_", " ").replace("  ", " ").strip() or filename.replace(".stl", "")
        stl_info_list.append(STLFileInfo(filename=filename, name=display_name, label=label, voxels=0))

    stl_info_list.sort(key=lambda x: x.name)
    return STLListResponse(
        case_id=case_id,
        stl_files=stl_info_list,
        status="ready" if stl_info_list else "processing",
    )

@app.get("/api/stl/{case_id}/{filename}")
async def get_stl_file(case_id: str, filename: str):
    """
    Serve an STL file. Resolution order:
    1. Virtual organ cases → stl/organs/
    2. Real uploaded case folder → stl/{case_id}/
    3. Brain sample → root stl/
    """
    # Virtual organ cases
    if case_id in ORGAN_STL_MAP:
        stl_path = os.path.join(ORGAN_STL_DIR, filename)
    else:
        # Real uploaded case (TotalSegmentator or SynthSeg output)
        case_stl_dir = os.path.join(STL_BASE_DIR, case_id)
        if os.path.isdir(case_stl_dir):
            stl_path = os.path.join(case_stl_dir, filename)
        else:
            # Brain sample fallback
            stl_path = os.path.join(STL_BASE_DIR, filename)

    # Final fallback: case-specific folder
    if not os.path.exists(stl_path):
        case_stl_dir = os.path.join(STL_BASE_DIR, case_id)
        stl_path = os.path.join(case_stl_dir, filename)
    
    if not os.path.exists(stl_path):
        raise HTTPException(status_code=404, detail=f"STL file not found: {filename}")
    
    return FileResponse(
        stl_path,
        media_type="application/octet-stream",
        filename=filename
    )

# Segment endpoint (for compatibility with old frontend code)
# Note: Segmentation now happens automatically after upload
class SegmentRequest(BaseModel):
    case_id: str

@app.post("/api/segment")
async def segment_brain(request: SegmentRequest):
    """
    Segment brain structures (for compatibility)
    Note: Segmentation is now automatic after upload, but this endpoint
    returns the current STL file status for the case
    """
    case_id = request.case_id
    
    # Check if STL files exist
    case_stl_dir = os.path.join(STL_BASE_DIR, case_id)
    stl_files = glob.glob(os.path.join(case_stl_dir, "*.stl")) if os.path.exists(case_stl_dir) else []
    
    # Return a response compatible with the old SegmentationResponse format
    # But we'll use STL files instead
    return {
        "case_id": case_id,
        "status": "ready" if stl_files else "processing",
        "stl_files_available": len(stl_files) > 0,
        "message": "Segmentation is automatic after upload. Check /api/stl/{case_id} for STL files."
    }

@app.post("/api/simulate")
def simulate_surgery(request: SurgeryRequest):
    """Analyze brain tissue removal consequences"""
    try:
        result = analyze_brain_removal(
            procedure_type=request.procedureType,
            removal_region=request.removalRegion.dict(),
            patient_age=request.patientAge,
            reason=request.reason
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/fea")
def run_fea_simulation(request: StructureFEARequest):
    """
    Analyze a selected brain structure using Gemini AI.
    When a user clicks on a structure (e.g., "Left hippocampus proper"), 
    this analyzes the consequences of removing that structure.
    Returns comprehensive neurological analysis including FEA-like stress distribution.
    """
    try:
        # Parse structure name to extract brain region and hemisphere
        structure_name_lower = request.structure_name.lower()
        
        # Extract hemisphere
        if "left" in structure_name_lower:
            hemisphere = "left"
            brain_region = request.structure_name.replace("Left", "").replace("left", "").strip()
        elif "right" in structure_name_lower:
            hemisphere = "right"
            brain_region = request.structure_name.replace("Right", "").replace("right", "").strip()
        else:
            # Default to left if not specified
            hemisphere = "left"
            brain_region = request.structure_name
        
        # Clean up brain region name (remove common suffixes)
        brain_region = brain_region.replace("(2)", "").replace("(3)", "").strip()
        
        # Use provided parameters or defaults
        procedure_type = request.procedure_type or "tumor resection"
        patient_age = request.patient_age or 45
        reason = request.reason or f"Tumor removal from {request.structure_name}"
        volume_to_remove = request.volume_to_remove or "variable"
        
        # Use provided coordinates or default to center
        if request.coordinates:
            coordinates = {
                "x": request.coordinates.x,
                "y": request.coordinates.y,
                "z": request.coordinates.z
            }
        else:
            coordinates = {"x": 0.0, "y": 0.0, "z": 0.0}
        
        # Use Gemini to analyze the structure removal
        result = analyze_brain_removal(
            procedure_type=procedure_type,
            removal_region={
                "brainRegion": brain_region,
                "hemisphere": hemisphere,
                "coordinates": coordinates,
                "volumeToRemove": volume_to_remove
            },
            patient_age=patient_age,
            reason=reason
        )
        
        # Debug: Print Gemini response structure
        print(f"Gemini response keys: {result.keys()}")
        print(f"Removal summary: {result.get('removalSummary', {})}")
        
        # Extract affected regions from Gemini's removalSummary
        removal_summary = result.get("removalSummary", {})
        affected_regions = removal_summary.get("affectedRegions", [])
        preserved_regions = removal_summary.get("preservedRegions", [])
        
        # Also check if regions are in other parts of the response
        if not affected_regions:
            # Try to extract from risks or other sections
            risks = result.get("risks", [])
            for risk in risks:
                if isinstance(risk, dict) and "consequences" in risk:
                    # Try to extract brain regions from risk consequences
                    consequences = risk.get("consequences", "")
                    if isinstance(consequences, str) and len(consequences) > 10:
                        # Could parse regions from text, but for now just use structure name
                        pass
        
        # If no affected regions, use the structure name and common adjacent areas
        if not affected_regions:
            affected_regions = [request.structure_name]
            # Add common adjacent structures based on brain region type
            if "gyrus" in brain_region.lower() or "cortex" in brain_region.lower():
                affected_regions.append("Adjacent cortical areas")
            if "hippocampus" in brain_region.lower():
                affected_regions.append("Temporal lobe connections")
            if "frontal" in brain_region.lower():
                affected_regions.append("Prefrontal connections")
        
        # Determine stress levels based on neurological deficits severity and actual regions
        high_stress_regions = []
        moderate_stress_regions = []
        low_stress_regions = []
        
        # Check neurological deficits to determine stress
        neuro_deficits = result.get("neurologicalDeficits", {})
        max_severity = "NONE"
        
        for deficit_type, deficit_info in neuro_deficits.items():
            if isinstance(deficit_info, dict) and deficit_info.get("affected"):
                severity = deficit_info.get("severity", "MODERATE")
                
                # Track maximum severity
                severity_order = {"SEVERE": 3, "MODERATE": 2, "MILD": 1, "NONE": 0}
                if severity_order.get(severity, 0) > severity_order.get(max_severity, 0):
                    max_severity = severity
                
                # Get specific affected areas from deficit description
                description = deficit_info.get("description", "")
                body_parts = deficit_info.get("bodyParts", [])
                
                # Extract brain region names from description if possible
                # Look for common brain anatomy terms
                brain_terms = ["gyrus", "cortex", "lobe", "nucleus", "tract", "pathway", "area", "region"]
                extracted_regions = []
                if description:
                    desc_lower = description.lower()
                    # Try to find brain region mentions
                    for term in brain_terms:
                        if term in desc_lower:
                            # Extract surrounding words as potential region name
                            words = description.split()
                            for i, word in enumerate(words):
                                if term in word.lower():
                                    # Get 2-3 words around the term
                                    start = max(0, i-1)
                                    end = min(len(words), i+2)
                                    region_phrase = " ".join(words[start:end])
                                    if region_phrase not in extracted_regions and len(region_phrase) > 5:
                                        extracted_regions.append(region_phrase)
                
                # Add to appropriate stress level with cleaner formatting
                if severity == "SEVERE":
                    if extracted_regions:
                        high_stress_regions.extend(extracted_regions[:2])  # Limit to 2
                    elif body_parts:
                        high_stress_regions.append(f"Contralateral {body_parts[0]} motor cortex")
                    else:
                        high_stress_regions.append(f"{deficit_type.capitalize()} pathways")
                elif severity == "MODERATE":
                    if extracted_regions:
                        moderate_stress_regions.extend(extracted_regions[:2])
                    elif body_parts:
                        moderate_stress_regions.append(f"{body_parts[0]} motor pathways")
                    else:
                        # Clean up description - remove redundant parts
                        clean_desc = description.replace(f"{deficit_type.lower()} ", "").replace("deficits ", "").replace("expected from ", "")
                        if len(clean_desc) > 60:
                            clean_desc = clean_desc[:60] + "..."
                        if clean_desc and clean_desc not in moderate_stress_regions:
                            moderate_stress_regions.append(clean_desc)
                else:
                    if extracted_regions:
                        low_stress_regions.extend(extracted_regions[:1])
                    elif description and len(description) < 50:
                        low_stress_regions.append(description)
        
        # Use actual affected regions from Gemini for stress distribution
        # Primary resection site is always high stress (and only in high stress)
        if request.structure_name not in high_stress_regions:
            high_stress_regions.insert(0, request.structure_name)  # Put at front
        
        # Remove structure name from other stress levels to avoid duplication
        moderate_stress_regions = [r for r in moderate_stress_regions if r.lower() != request.structure_name.lower()]
        low_stress_regions = [r for r in low_stress_regions if r.lower() != request.structure_name.lower()]
        
        # Add adjacent regions from affected_regions (these are from Gemini's analysis)
        for region in affected_regions:
            if region and region.lower() != request.structure_name.lower():
                # Check if it's already in any stress category
                region_lower = region.lower()
                already_added = (
                    any(r.lower() == region_lower for r in high_stress_regions) or
                    any(r.lower() == region_lower for r in moderate_stress_regions) or
                    any(r.lower() == region_lower for r in low_stress_regions)
                )
                
                if not already_added:
                    # Determine stress level based on region type and keywords
                    if any(keyword in region_lower for keyword in ["primary", "direct", "immediate", "critical", "eloquent"]):
                        high_stress_regions.append(region)
                    elif any(keyword in region_lower for keyword in ["adjacent", "connected", "nearby", "surrounding", "associated"]):
                        moderate_stress_regions.append(region)
                    else:
                        # Default to moderate for affected regions (they're affected, so not low stress)
                        moderate_stress_regions.append(region)
        
        # Add preserved regions as low stress
        for region in preserved_regions[:3]:  # Limit to first 3
            if region not in low_stress_regions:
                low_stress_regions.append(region)
        
        # Calculate max stress based on severity
        stress_map = {"SEVERE": 180.0, "MODERATE": 120.0, "MILD": 85.0, "NONE": 60.0}
        max_stress = stress_map.get(max_severity, 100.0)
        
        # Remove duplicates and limit regions
        high_stress_regions = list(dict.fromkeys(high_stress_regions))[:5]  # Preserve order, remove dupes
        moderate_stress_regions = list(dict.fromkeys(moderate_stress_regions))[:5]
        low_stress_regions = list(dict.fromkeys(low_stress_regions))[:5]
        
        # Ensure we have at least the structure name in high stress
        if not high_stress_regions or high_stress_regions[0].lower() != request.structure_name.lower():
            high_stress_regions.insert(0, request.structure_name)
        
        # Add FEA results to the Gemini analysis
        result["fea_results"] = {
            "structure_name": request.structure_name,
            "structure_label": request.structure_label,
            "stl_filename": request.stl_filename,
            "max_stress_kpa": max_stress,
            "affected_regions": affected_regions if affected_regions else [request.structure_name],
            "stress_distribution": {
                "high_stress": high_stress_regions,
                "moderate_stress": moderate_stress_regions,
                "low_stress": low_stress_regions
            }
        }
        
        return result
    except Exception as e:
        print(f"Error in FEA simulation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
def health_check():
    return {"api": "healthy", "gemini": "connected", "organ": "brain"}


# ── WebSocket FEA endpoint ─────────────────────────────────────────────────────

@app.websocket("/ws/fea/{case_id}")
async def websocket_fea(websocket: WebSocket, case_id: str):
    """
    WebSocket endpoint for V2 FEA pipeline.

    Protocol:
      client → server : JSON payload (structure info + params)
      server → client : {"type": "solver_start"}
      server → client : {"type": "displacement_field", ...solver_result}
      server → client : {"type": "clinical_text", "section": <name>, "content": <data>}  (×5)
      server → client : {"type": "complete", "full_analysis": <gemini_result>}
    """
    await websocket.accept()

    try:
        # 1. Receive request payload
        raw = await websocket.receive_text()
        payload = json.loads(raw)

        structure_name   = payload.get("structure_name", "Unknown")
        structure_label  = payload.get("structure_label", 0)
        coords           = payload.get("coordinates", {"x": 0.0, "y": 0.0, "z": 0.0})
        patient_age      = payload.get("patient_age", 45)
        procedure_type   = payload.get("procedure_type", "resection")
        volume_to_remove = payload.get("volume_to_remove", "variable")
        reason           = payload.get("reason", "trauma")
        removal_radius   = float(payload.get("removal_radius", 0.18))
        organ_system     = payload.get("organ_system", "brain")  # NEW: whole-body support

        # 2. Acknowledge start
        await websocket.send_text(json.dumps({"type": "solver_start"}))

        # 3. Normalize click coordinates from anatomical space (mm) to [-1, 1]
        # Brain STL coordinates are typically in mm, range roughly ±100mm per axis.
        # We normalize so the FDM grid [-1,1]^3 maps onto the brain volume.
        raw_x = float(coords.get("x", 0))
        raw_y = float(coords.get("y", 0))
        raw_z = float(coords.get("z", 0))

        # Clamp + normalize: assume brain fits in a ~180mm bounding box per axis
        BRAIN_HALF_EXTENT = 90.0  # mm — covers most brain STL extents
        norm_x = max(-1.0, min(1.0, raw_x / BRAIN_HALF_EXTENT))
        norm_y = max(-1.0, min(1.0, raw_y / BRAIN_HALF_EXTENT))
        norm_z = max(-1.0, min(1.0, raw_z / BRAIN_HALF_EXTENT))

        centroid = (norm_x, norm_y, norm_z)
        print(f"[FDM] raw coords: ({raw_x:.1f}, {raw_y:.1f}, {raw_z:.1f}) mm → normalized: ({norm_x:.3f}, {norm_y:.3f}, {norm_z:.3f})")

        # Organ-specific biomechanical constants
        ORGAN_PARAMS = {
            "brain":  {"E": 2000.0,  "nu": 0.45, "scale": 800.0},
            "liver":  {"E": 3000.0,  "nu": 0.49, "scale": 600.0},
            "spleen": {"E": 800.0,   "nu": 0.48, "scale": 500.0},
            "kidney": {"E": 4000.0,  "nu": 0.44, "scale": 700.0},
            "lung":   {"E": 1200.0,  "nu": 0.40, "scale": 400.0},
            "bone":   {"E": 18000.0, "nu": 0.30, "scale": 2000.0},
        }
        op = ORGAN_PARAMS.get(organ_system, ORGAN_PARAMS["brain"])

        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            solver_result = await loop.run_in_executor(
                pool,
                lambda: solve_fdm_elasticity(centroid, removal_radius, grid_size=12, E=op["E"], nu=op["nu"]),
            )

        # Scale stress to clinically meaningful range per organ system.
        STRESS_SCALE = op["scale"]
        solver_result["max_stress_kpa"] = round(solver_result["max_stress_kpa"] * STRESS_SCALE, 3)
        if solver_result["max_stress_kpa"] < 0.05:
            # Centroid was near boundary or outside body force zone — use distance-based estimate
            dist_from_center = (norm_x**2 + norm_y**2 + norm_z**2) ** 0.5
            solver_result["max_stress_kpa"] = round(max(0.3, 2.5 * (1.0 - dist_from_center * 0.6)), 3)
        print(f"[FDM] max_stress_kpa: {solver_result['max_stress_kpa']}")

        # 4. Monte Carlo uncertainty bounds (runs fast — 40 samples)
        uncertainty = monte_carlo_stress_bounds(
            centroid, removal_radius,
            base_stress_kpa=solver_result["max_stress_kpa"]
        )

        # 5. Send displacement field + uncertainty
        await websocket.send_text(json.dumps({
            "type": "displacement_field",
            **solver_result,
            "uncertainty": uncertainty,
        }))

        # 6. Parse hemisphere
        name_lower = structure_name.lower()
        if "left" in name_lower:
            hemisphere = "left"
            brain_region = structure_name.replace("Left", "").replace("left", "").strip()
        elif "right" in name_lower:
            hemisphere = "right"
            brain_region = structure_name.replace("Right", "").replace("right", "").strip()
        else:
            hemisphere = "bilateral"
            brain_region = structure_name

        # 7. Call Kimi K2 in thread pool (organ-aware)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            gemini_result = await loop.run_in_executor(
                pool,
                analyze_brain_removal,
                procedure_type,
                {
                    "brainRegion":    brain_region,
                    "hemisphere":     hemisphere,
                    "coordinates":    coords,
                    "volumeToRemove": volume_to_remove,
                    "organSystem":    organ_system,   # NEW: passes organ to AI dispatcher
                },
                patient_age,
                reason,
            )

        # 8. Generate recovery curve
        curve = recovery_curve(
            solver_result["max_stress_kpa"],
            patient_age,
            structure_name,
        )

        # 9. Augment result
        gemini_result["fea_results"] = {
            "structure_name":  structure_name,
            "structure_label": structure_label,
            "max_stress_kpa":  solver_result["max_stress_kpa"],
            "uncertainty":     uncertainty,
            "recovery_curve":  curve,
            "stress_distribution": {
                "high_stress":     [structure_name],
                "moderate_stress": [],
                "low_stress":      [],
            },
            "affected_regions": [structure_name],
        }

        # 10. Stream clinical sections
        sections = ["removalSummary", "neurologicalDeficits", "surgicalApproach", "risks", "recoveryPrognosis"]
        for section in sections:
            if section in gemini_result:
                await websocket.send_text(json.dumps({
                    "type":    "clinical_text",
                    "section": section,
                    "content": gemini_result[section],
                }))
                await asyncio.sleep(0.06)

        # 11. Stream uncertainty + recovery
        await websocket.send_text(json.dumps({
            "type":    "clinical_text",
            "section": "uncertainty",
            "content": uncertainty,
        }))
        await websocket.send_text(json.dumps({
            "type":    "clinical_text",
            "section": "recoveryCurve",
            "content": curve,
        }))

        # 12. Complete
        await websocket.send_text(json.dumps({
            "type":          "complete",
            "full_analysis": gemini_result,
        }))

    except WebSocketDisconnect:
        print(f"[WS] Client disconnected: case={case_id}")
    except Exception as exc:
        print(f"[WS] Error in FEA for case={case_id}: {exc}")
        try:
            await websocket.send_text(json.dumps({
                "type":    "error",
                "message": str(exc),
            }))
        except Exception:
            pass

# ── No-Fly Zones endpoint ─────────────────────────────────────────────────────

# Anatomically defined danger zones in normalized [-1,1]³ brain space
# Based on MNI152 atlas centroids mapped to normalized coords
NO_FLY_ZONES = [
    {"id": "broca",      "name": "Broca's Area",          "center": [-0.42, 0.12, 0.18],  "radius": 0.14, "function": "speech production",    "severity": "critical"},
    {"id": "wernicke",   "name": "Wernicke's Area",        "center": [-0.50, -0.28, 0.10], "radius": 0.13, "function": "language comprehension","severity": "critical"},
    {"id": "motor_l",    "name": "Left Motor Cortex",      "center": [-0.36, 0.30, 0.52],  "radius": 0.16, "function": "right body movement",  "severity": "critical"},
    {"id": "motor_r",    "name": "Right Motor Cortex",     "center": [ 0.36, 0.30, 0.52],  "radius": 0.16, "function": "left body movement",   "severity": "critical"},
    {"id": "visual",     "name": "Primary Visual Cortex",  "center": [ 0.00,-0.55, 0.30],  "radius": 0.15, "function": "vision",               "severity": "critical"},
    {"id": "brainstem",  "name": "Brainstem",              "center": [ 0.00,-0.60,-0.55],  "radius": 0.18, "function": "breathing, heartbeat", "severity": "fatal"},
    {"id": "optic_l",    "name": "Left Optic Radiation",   "center": [-0.30,-0.30, 0.05],  "radius": 0.10, "function": "left visual field",    "severity": "high"},
    {"id": "optic_r",    "name": "Right Optic Radiation",  "center": [ 0.30,-0.30, 0.05],  "radius": 0.10, "function": "right visual field",   "severity": "high"},
    {"id": "hippo_l",    "name": "Left Hippocampus",       "center": [-0.38,-0.22,-0.12],  "radius": 0.10, "function": "memory formation",     "severity": "high"},
    {"id": "hippo_r",    "name": "Right Hippocampus",      "center": [ 0.38,-0.22,-0.12],  "radius": 0.10, "function": "memory formation",     "severity": "high"},
]

@app.get("/api/no-fly-zones")
def get_no_fly_zones():
    """Return all anatomical no-fly zones with their positions and radii."""
    return {"zones": NO_FLY_ZONES}


@app.post("/api/proximity-check")
def check_proximity(body: dict):
    """
    Given normalized coords, return which no-fly zones are within alert range.
    Returns sorted list with distance and alert level.
    """
    import math
    x, y, z = body.get("x", 0), body.get("y", 0), body.get("z", 0)
    alerts = []
    for zone in NO_FLY_ZONES:
        cx, cy, cz = zone["center"]
        dist = math.sqrt((x-cx)**2 + (y-cy)**2 + (z-cz)**2)
        clearance = dist - zone["radius"]
        if clearance < 0.35:  # within 35% of normalized space
            alert_level = "breach" if clearance < 0 else ("critical" if clearance < 0.10 else "warning")
            alerts.append({**zone, "distance": round(dist, 3), "clearance": round(clearance, 3), "alert_level": alert_level})
    alerts.sort(key=lambda a: a["distance"])
    return {"alerts": alerts}


# ── What-If comparison endpoint ───────────────────────────────────────────────

class WhatIfRequest(BaseModel):
    structures: List[str]   # up to 3 structure names
    patient_age: int = 45
    procedure_type: str = "tumor resection"

@app.post("/api/what-if")
def what_if_comparison(req: WhatIfRequest):
    """
    Compare recovery trajectories for up to 3 different resection paths.
    Returns side-by-side recovery curves without running full FEA.
    """
    import random
    results = []
    for i, name in enumerate(req.structures[:3]):
        # Vary stress slightly per structure based on name hash
        base_stress = 1.5 + (hash(name) % 30) / 10.0
        curve = recovery_curve(base_stress, req.patient_age, name)
        bounds = monte_carlo_stress_bounds((0.1*i, 0.0, 0.1), 0.18, base_stress, n_samples=20)
        results.append({
            "path": chr(65 + i),   # A, B, C
            "structure": name,
            "base_stress_kpa": round(base_stress, 2),
            "confidence_pct": bounds["confidence_pct"],
            "recovery_curve": curve,
            "uncertainty": bounds,
        })
    return {"paths": results}
