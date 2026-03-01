"""
Organ Segmentation Service
===========================
Real pipeline mirroring how the brain structures were generated:

  CT/MRI NIfTI  →  TotalSegmentator  →  per-organ binary NIfTI masks
                →  marching_cubes    →  watertight STL mesh
                →  served via FastAPI →  Three.js STLViewer

This is the organ equivalent of:
  IXI T1 MRI  →  SynthSeg --parc  →  parcellation NIfTI
              →  extract_regions   →  per-region NIfTI
              →  marching_cubes   →  STL
              →  served via FastAPI →  Three.js STLViewer

TotalSegmentator covers 104 structures across:
  - Liver, Spleen, Kidneys (L/R), Lungs (L/R), Gallbladder, Stomach,
  - Pancreas, Aorta, Vertebrae (C1-S1), Ribs (1-24 L/R), Femur (L/R),
  - Heart chambers, Adrenal glands, Bladder, Trachea, ...
"""

import os
import json
import numpy as np
import nibabel as nib
from skimage import measure
import trimesh
from pathlib import Path
from typing import List, Dict, Optional

# ── TotalSegmentator organ groupings ────────────────────────────────────────
# Maps our 5 non-brain organ system IDs to TotalSegmentator class names.
# Full class list: https://github.com/wasserth/TotalSegmentator#class-details
ORGAN_SYSTEM_CLASSES = {
    "liver": [
        "liver",
        "gallbladder",
        "bile_duct",
    ],
    "spleen": [
        "spleen",
    ],
    "kidney": [
        "kidney_left",
        "kidney_right",
        "adrenal_gland_left",
        "adrenal_gland_right",
    ],
    "lung": [
        "lung_upper_lobe_left",
        "lung_lower_lobe_left",
        "lung_upper_lobe_right",
        "lung_middle_lobe_right",
        "lung_lower_lobe_right",
        "trachea",
    ],
    "bone": [
        "vertebrae_L1", "vertebrae_L2", "vertebrae_L3",
        "vertebrae_T12", "vertebrae_T11", "vertebrae_T10",
        "rib_left_1", "rib_left_2", "rib_left_3",
        "rib_right_1", "rib_right_2", "rib_right_3",
        "femur_left", "femur_right",
        "hip_left", "hip_right",
        "sacrum",
    ],
}

# Friendly display names
ORGAN_CLASS_DISPLAY = {
    "liver":                   "Liver",
    "gallbladder":             "Gallbladder",
    "bile_duct":               "Bile Duct",
    "spleen":                  "Spleen",
    "kidney_left":             "Left Kidney",
    "kidney_right":            "Right Kidney",
    "adrenal_gland_left":      "Left Adrenal Gland",
    "adrenal_gland_right":     "Right Adrenal Gland",
    "lung_upper_lobe_left":    "Left Upper Lobe",
    "lung_lower_lobe_left":    "Left Lower Lobe",
    "lung_upper_lobe_right":   "Right Upper Lobe",
    "lung_middle_lobe_right":  "Right Middle Lobe",
    "lung_lower_lobe_right":   "Right Lower Lobe",
    "trachea":                 "Trachea",
    "vertebrae_L1":            "L1 Vertebra",
    "vertebrae_L2":            "L2 Vertebra",
    "vertebrae_L3":            "L3 Vertebra",
    "vertebrae_T10":           "T10 Vertebra",
    "vertebrae_T11":           "T11 Vertebra",
    "vertebrae_T12":           "T12 Vertebra",
    "rib_left_1":              "Left Rib 1",
    "rib_left_2":              "Left Rib 2",
    "rib_left_3":              "Left Rib 3",
    "rib_right_1":             "Right Rib 1",
    "rib_right_2":             "Right Rib 2",
    "rib_right_3":             "Right Rib 3",
    "femur_left":              "Left Femur",
    "femur_right":             "Right Femur",
    "hip_left":                "Left Hip",
    "hip_right":               "Right Hip",
    "sacrum":                  "Sacrum",
}


def run_totalsegmentator(input_nifti: str, output_dir: str, fast: bool = True) -> Dict[str, str]:
    """
    Run TotalSegmentator on a CT/MRI NIfTI file.
    Returns dict: {class_name → path_to_binary_nifti}

    Args:
        input_nifti: path to input .nii or .nii.gz
        output_dir:  directory where TotalSegmentator writes per-organ NIfTIs
        fast:        use fast (low-res) mode — adequate for visualization
    """
    from totalsegmentator.python_api import totalsegmentator

    os.makedirs(output_dir, exist_ok=True)

    print(f"[TotalSeg] Running on: {input_nifti}")
    print(f"[TotalSeg] Output dir: {output_dir}")
    print(f"[TotalSeg] Fast mode: {fast}")

    # TotalSegmentator writes one NIfTI per class into output_dir
    # device="cpu" ensures it works without a GPU; fast=True uses low-res model
    totalsegmentator(
        input=input_nifti,
        output=output_dir,
        fast=fast,
        verbose=True,
        device="cpu",
    )

    # Collect produced files
    class_to_path = {}
    for fname in os.listdir(output_dir):
        if fname.endswith(".nii.gz"):
            class_name = fname.replace(".nii.gz", "")
            class_to_path[class_name] = os.path.join(output_dir, fname)

    print(f"[TotalSeg] Produced {len(class_to_path)} segmentation masks")
    return class_to_path


def nifti_mask_to_stl(
    nifti_path: str,
    stl_path: str,
    iso_level: float = 0.5,
    min_voxels: int = 50,
    smooth_iterations: int = 3,
) -> bool:
    """
    Convert a binary NIfTI mask → STL via marching cubes.
    Same approach as generate_meshes.py / segmentation_service.py.
    """
    try:
        img = nib.load(nifti_path)
        data = img.get_fdata()

        nonzero = int(np.count_nonzero(data))
        if nonzero < min_voxels:
            print(f"  [skip] {os.path.basename(nifti_path)}: only {nonzero} nonzero voxels")
            return False

        # Use voxel spacing from NIfTI header (same as brain pipeline)
        spacing = img.header.get_zooms()[:3]

        # Marching cubes (identical to segmentation_service.py / generate_meshes.py)
        verts, faces, normals, _ = measure.marching_cubes(
            data,
            level=iso_level,
            spacing=spacing,
        )

        if len(verts) == 0:
            return False

        mesh = trimesh.Trimesh(vertices=verts, faces=faces, vertex_normals=normals)

        # Light Laplacian smoothing to remove voxel staircase artifacts
        # (same approach you'd apply to brain STLs)
        trimesh.smoothing.filter_laplacian(mesh, iterations=smooth_iterations)
        mesh.fix_normals()

        mesh.export(stl_path)
        print(f"  [STL] {os.path.basename(stl_path)}: {len(verts)} verts, {len(faces)} faces")
        return True

    except Exception as e:
        print(f"  [error] nifti_mask_to_stl({nifti_path}): {e}")
        return False


def segment_organs_from_nifti(
    input_nifti: str,
    case_id: str,
    stl_base_dir: str,
    organ_system: Optional[str] = None,
    fast: bool = True,
) -> List[Dict]:
    """
    Full pipeline: CT/MRI NIfTI → TotalSegmentator → marching cubes → STL files.

    Args:
        input_nifti:   path to uploaded CT scan (.nii.gz)
        case_id:       unique case identifier (used as subfolder in stl_base_dir)
        stl_base_dir:  root STL output directory
        organ_system:  if set, only segment that system's classes ('liver', 'kidney', etc.)
                       if None, segment all classes
        fast:          TotalSegmentator fast mode (lower res but much faster)

    Returns:
        list of {filename, name, label, voxels, organ_system}
    """
    # ── Paths ──
    case_stl_dir = os.path.join(stl_base_dir, case_id)
    ts_output_dir = os.path.join("temp_seg", case_id, "totalseg")
    os.makedirs(case_stl_dir, exist_ok=True)
    os.makedirs(ts_output_dir, exist_ok=True)

    # ── Step 1: Run TotalSegmentator ──
    try:
        class_to_path = run_totalsegmentator(input_nifti, ts_output_dir, fast=fast)
    except Exception as e:
        print(f"[TotalSeg] Failed: {e}")
        return []

    # ── Determine which classes to convert ──
    if organ_system and organ_system in ORGAN_SYSTEM_CLASSES:
        wanted_classes = ORGAN_SYSTEM_CLASSES[organ_system]
    else:
        # All classes across all organ systems
        wanted_classes = list({
            cls
            for classes in ORGAN_SYSTEM_CLASSES.values()
            for cls in classes
        })

    # ── Step 2: marching cubes → STL for each class ──
    stl_files = []
    for idx, class_name in enumerate(wanted_classes):
        nifti_path = class_to_path.get(class_name)
        if not nifti_path or not os.path.exists(nifti_path):
            print(f"  [missing] TotalSegmentator did not produce: {class_name}")
            continue

        display_name = ORGAN_CLASS_DISPLAY.get(class_name, class_name.replace("_", " ").title())
        stl_filename = f"{display_name}.stl"
        stl_path = os.path.join(case_stl_dir, stl_filename)

        # Determine which organ system this class belongs to
        sys_id = next(
            (sys for sys, classes in ORGAN_SYSTEM_CLASSES.items() if class_name in classes),
            "other",
        )

        if nifti_mask_to_stl(nifti_path, stl_path):
            img = nib.load(nifti_path)
            voxels = int(np.count_nonzero(img.get_fdata()))
            stl_files.append({
                "filename": stl_filename,
                "name": display_name,
                "label": idx + 1,
                "voxels": voxels,
                "organ_system": sys_id,
            })

    print(f"[OrganSeg] Generated {len(stl_files)} organ STLs for case {case_id}")

    # Write a manifest so the STL list endpoint can serve them
    manifest_path = os.path.join(case_stl_dir, "_manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(stl_files, f, indent=2)

    return stl_files


def get_stl_list_from_manifest(case_stl_dir: str) -> List[Dict]:
    """Read the manifest written by segment_organs_from_nifti."""
    manifest_path = os.path.join(case_stl_dir, "_manifest.json")
    if not os.path.exists(manifest_path):
        return []
    with open(manifest_path) as f:
        return json.load(f)
