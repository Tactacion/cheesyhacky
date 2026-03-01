"""
Generate anatomically-accurate organ STL meshes.

Pipeline (mirrors the brain exactly):
  1. Build a 3D voxel binary mask using SDF operations on a grid
  2. Run skimage.measure.marching_cubes  ← same as segmentation_service.py
  3. Laplacian smoothing
  4. Export STL

CRITICAL FIX:
  Each sub-structure is extracted from its own isolated region of the voxel
  grid so marching cubes sees exactly one connected component.
  Then ALL sub-structure meshes are exported with their NATURAL voxel-space
  coordinates (just voxel_index × spacing) WITHOUT individually centering
  each one.  Only a single group-level translation is applied so the whole
  organ sits at the world origin.  This means right lobe appears to the right
  of left lobe, caudate sits posteriorly, etc. — exactly like the brain STLs
  where each gyrus keeps its position from the MRI volume.
"""

import numpy as np
from skimage import measure
from scipy.ndimage import gaussian_filter
import trimesh
import trimesh.smoothing
import os, time

OUT = os.path.join(os.path.dirname(__file__), '..', 'stl', 'organs')
os.makedirs(OUT, exist_ok=True)

# ── Core helpers ───────────────────────────────────────────────────────────────

def ellipsoid_mask(grid_shape, cx, cy, cz, rx, ry, rz, noise=0.0, noise_scale=3.0):
    """
    Fill a voxel grid with a smooth ellipsoid at (cx,cy,cz) with radii (rx,ry,rz).
    Uses an ISOLATED sub-volume to avoid bleed into adjacent structures.
    Returns float32 mask in full grid_shape.
    """
    sz = grid_shape
    x = np.arange(sz[0], dtype=np.float32) - cx
    y = np.arange(sz[1], dtype=np.float32) - cy
    z = np.arange(sz[2], dtype=np.float32) - cz
    X, Y, Z = np.meshgrid(x, y, z, indexing='ij')
    sdf = (X/rx)**2 + (Y/ry)**2 + (Z/rz)**2
    mask = (sdf < 1.0).astype(np.float32)
    if noise > 0:
        n = np.random.randn(*sz).astype(np.float32) * noise
        n = gaussian_filter(n, sigma=noise_scale)
        mask = np.clip(mask + n * mask, 0, 1.5)
    return gaussian_filter(mask, sigma=1.2)

def union_masks(*masks):
    return np.maximum.reduce(masks)

def subtract_mask(base, sub, strength=0.8):
    return np.clip(base - sub * strength, 0, None)

def marching(mask, spacing=1.0):
    """marching_cubes → trimesh, preserving natural voxel coordinates."""
    if mask.max() < 0.5:
        return None
    try:
        s = (spacing, spacing, spacing) if isinstance(spacing, float) else spacing
        verts, faces, normals, _ = measure.marching_cubes(mask, level=0.5, spacing=s)
    except Exception:
        return None
    if len(verts) < 100:
        return None
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, vertex_normals=normals)
    trimesh.smoothing.filter_laplacian(mesh, iterations=5)
    mesh.fix_normals()
    return mesh

def export_group(meshes_and_names, target_scale_mm):
    """
    Export a group of sub-structure meshes.

    All meshes share the same voxel coordinate space (they were built in the
    same grid).  We:
      1. Find the bounding box of the entire group
      2. Compute a uniform scale so the largest dimension = target_scale_mm
      3. Translate so the group centroid is at world origin
      4. Each mesh keeps its relative position — right lobe stays right of left
    """
    valid = [(m, n) for m, n in meshes_and_names if m is not None]
    if not valid:
        return

    # Gather all vertices to find group bounds
    all_verts = np.vstack([m.vertices for m, _ in valid])
    group_min = all_verts.min(axis=0)
    group_max = all_verts.max(axis=0)
    group_extent = group_max - group_min
    group_center = (group_min + group_max) * 0.5

    # Uniform scale so largest axis = target_scale_mm
    max_extent = group_extent.max()
    scale = target_scale_mm / max(max_extent, 1e-6)

    for mesh, name in valid:
        # Apply uniform scale (preserves relative positions)
        mesh.apply_scale(scale)
        # Translate so group center is at world origin
        # (each mesh moves by the same amount → relative positions preserved)
        mesh.apply_translation(-group_center * scale)
        path = os.path.join(OUT, name)
        mesh.export(path)
        kb = os.path.getsize(path) // 1024
        print(f"  ✓ {name}  ({len(mesh.vertices):,}v  {kb}KB)")


def gen(label, fn):
    t = time.time()
    print(f"\n── {label} ──")
    fn()
    print(f"   {time.time()-t:.1f}s")


# ── LIVER ──────────────────────────────────────────────────────────────────────
#
#  Anatomy (all in a single 400³ grid, spacing=1 mm/voxel):
#   Right lobe  — dominant, occupies right 60% (high x)
#   Left lobe   — tapers to a point, occupies left 40% (low x)
#   Caudate lobe — posterior-right (low y)
#   Quadrate lobe — inferior-anterior (high y, mid z)
#   Gallbladder  — pear shape, inferior right surface
#
#  All built in the SAME grid so marching cubes voxel coords are shared.
#  export_group applies ONE uniform scale + ONE center translation.

def _liver():
    np.random.seed(42)
    G = 400

    # ── Right lobe (large wedge, right side of grid) ───────────────────────
    m = ellipsoid_mask((G,G,G), G*0.62, G*0.50, G*0.50,
                       rx=G*0.22, ry=G*0.18, rz=G*0.14,
                       noise=0.28, noise_scale=5)
    # Flatten diaphragmatic (superior) surface
    z_arr = np.arange(G, dtype=np.float32)
    dome = np.exp(-((z_arr - G*0.64)**2) / (2*(G*0.04)**2))
    m *= (1 - 0.65 * dome[np.newaxis, np.newaxis, :])
    # Gallbladder fossa notch (inferior surface)
    fossa = ellipsoid_mask((G,G,G), G*0.60, G*0.62, G*0.36,
                           rx=G*0.05, ry=G*0.04, rz=G*0.04)
    m = subtract_mask(m, fossa, 0.90)
    m = gaussian_filter(np.clip(m, 0, None), 1.8)
    mesh_r = marching(m, spacing=0.9)

    # ── Left lobe (smaller, left side, tapers to a point) ─────────────────
    m2 = ellipsoid_mask((G,G,G), G*0.32, G*0.50, G*0.52,
                        rx=G*0.14, ry=G*0.12, rz=G*0.10,
                        noise=0.24, noise_scale=4)
    # Taper the medial (right) end
    x_arr = np.arange(G, dtype=np.float32)
    taper = np.clip((G*0.46 - x_arr) / (G*0.12), 0, 1)
    m2 *= taper[:, np.newaxis, np.newaxis]
    m2 = gaussian_filter(np.clip(m2, 0, None), 1.5)
    mesh_l = marching(m2, spacing=0.9)

    # ── Caudate lobe (small, posterior-right behind portal vein) ──────────
    m3 = ellipsoid_mask((G,G,G), G*0.60, G*0.28, G*0.56,
                        rx=G*0.07, ry=G*0.06, rz=G*0.055,
                        noise=0.18, noise_scale=2.5)
    m3 = gaussian_filter(np.clip(m3, 0, None), 1.2)
    mesh_ca = marching(m3, spacing=0.9)

    # ── Quadrate lobe (inferior, between gallbladder and round ligament) ──
    m4 = ellipsoid_mask((G,G,G), G*0.50, G*0.65, G*0.38,
                        rx=G*0.06, ry=G*0.055, rz=G*0.05,
                        noise=0.16, noise_scale=2.5)
    m4 = gaussian_filter(np.clip(m4, 0, None), 1.2)
    mesh_q = marching(m4, spacing=0.9)

    # ── Gallbladder (pear shape = body + neck, inferior right) ────────────
    gb_body = ellipsoid_mask((G,G,G), G*0.60, G*0.64, G*0.36,
                              rx=G*0.055, ry=G*0.045, rz=G*0.075,
                              noise=0.12, noise_scale=2)
    gb_neck = ellipsoid_mask((G,G,G), G*0.60, G*0.61, G*0.46,
                              rx=G*0.030, ry=G*0.025, rz=G*0.040,
                              noise=0.10, noise_scale=2)
    m5 = union_masks(gb_body, gb_neck)
    m5 = gaussian_filter(np.clip(m5, 0, None), 1.0)
    mesh_gb = marching(m5, spacing=0.9)

    export_group([
        (mesh_r,  'Liver Right Lobe.stl'),
        (mesh_l,  'Liver Left Lobe.stl'),
        (mesh_ca, 'Liver Caudate Lobe.stl'),
        (mesh_q,  'Liver Quadrate Lobe.stl'),
        (mesh_gb, 'Gallbladder.stl'),
    ], target_scale_mm=280)


# ── SPLEEN ─────────────────────────────────────────────────────────────────────
#
#  Coffee-bean / wedge shape with hilum concavity, notched superior border.
#  Split into body + superior pole + inferior pole (all in same grid).

def _spleen():
    np.random.seed(43)
    G = 320

    # ── Body (main mass, slightly convex diaphragmatic surface) ───────────
    m = ellipsoid_mask((G,G,G), G*0.50, G*0.50, G*0.50,
                       rx=G*0.24, ry=G*0.16, rz=G*0.20,
                       noise=0.24, noise_scale=4)
    # Hilum — concave medial face (right side)
    hilum = ellipsoid_mask((G,G,G), G*0.72, G*0.50, G*0.50,
                           rx=G*0.12, ry=G*0.14, rz=G*0.16)
    m = subtract_mask(m, hilum, 0.82)
    # 3 notches on superior border
    for (xi, yi, zi) in [(0.46, 0.38, 0.68), (0.50, 0.42, 0.63), (0.54, 0.46, 0.58)]:
        notch = ellipsoid_mask((G,G,G), G*xi, G*yi, G*zi,
                               rx=G*0.045, ry=G*0.038, rz=G*0.038)
        m = subtract_mask(m, notch, 0.72)
    # Diaphragmatic surface — flatten left face
    x_arr = np.arange(G, dtype=np.float32)
    flat = np.clip((x_arr - G*0.26) / (G*0.08), 0, 1)
    m *= (1 - 0.55 * flat[:, np.newaxis, np.newaxis])
    m = gaussian_filter(np.clip(m, 0, None), 1.5)
    mesh_body = marching(m, spacing=0.9)

    # ── Superior pole (rounded, more cranial — higher z) ──────────────────
    m2 = ellipsoid_mask((G,G,G), G*0.46, G*0.42, G*0.74,
                        rx=G*0.11, ry=G*0.10, rz=G*0.09,
                        noise=0.18, noise_scale=3)
    m2 = gaussian_filter(np.clip(m2, 0, None), 1.2)
    mesh_sup = marching(m2, spacing=0.9)

    # ── Inferior pole (more caudal — lower z) ─────────────────────────────
    m3 = ellipsoid_mask((G,G,G), G*0.53, G*0.57, G*0.27,
                        rx=G*0.10, ry=G*0.09, rz=G*0.08,
                        noise=0.16, noise_scale=3)
    m3 = gaussian_filter(np.clip(m3, 0, None), 1.2)
    mesh_inf = marching(m3, spacing=0.9)

    export_group([
        (mesh_body, 'Spleen Body.stl'),
        (mesh_sup,  'Spleen Superior Pole.stl'),
        (mesh_inf,  'Spleen Inferior Pole.stl'),
    ], target_scale_mm=130)


# ── KIDNEYS ────────────────────────────────────────────────────────────────────
#
#  Bean-shaped, hilum faces medially.
#  3 structures: cortex (outer shell) + medulla (inner) + renal pelvis (central).
#  Left and right kidneys are separate sets of STL files.
#
#  Key: cortex is built FIRST; medulla uses the same grid center but smaller radii;
#  pelvis is yet smaller, centred at hilum.  All are in ONE shared grid per side.

def _kidneys():
    for side in ['Left', 'Right']:
        np.random.seed(44 if side == 'Left' else 45)
        G = 300
        sign = +1 if side == 'Left' else -1  # hilum faces right for left kidney

        # Grid centre for the kidney
        kx, ky, kz = G * 0.50, G * 0.50, G * 0.50

        # ── Cortex (outer bean shape) ──────────────────────────────────────
        m = ellipsoid_mask((G,G,G), kx, ky, kz,
                           rx=G*0.22, ry=G*0.15, rz=G*0.28,
                           noise=0.18, noise_scale=3.5)
        # Hilum indent (medial concavity)
        hx = kx + sign * G * 0.14
        hilum = ellipsoid_mask((G,G,G), hx, ky, kz,
                               rx=G*0.10, ry=G*0.11, rz=G*0.18)
        m = subtract_mask(m, hilum, 0.90)
        # Fetal lobulation ripples
        zg = np.arange(G, dtype=np.float32) - kz
        ripple = 0.12 * np.sin(zg / (G * 0.065) * np.pi)
        m += ripple[np.newaxis, np.newaxis, :] * (m > 0.35)
        m = np.clip(m, 0, None)
        m = gaussian_filter(m, 1.4)
        mesh_cortex = marching(m, spacing=0.9)

        # ── Medulla (smaller ellipsoid, same centre, NOT centered separately)
        # We build it at a position slightly toward the hilum
        mx = kx + sign * G * 0.04
        m2 = ellipsoid_mask((G,G,G), mx, ky, kz,
                            rx=G*0.13, ry=G*0.09, rz=G*0.20,
                            noise=0.14, noise_scale=2.5)
        # Renal pyramids: 6 small bumps radiating outward
        for dz in np.linspace(-0.12, 0.12, 6):
            pyr = ellipsoid_mask((G,G,G),
                                 mx + sign * G * 0.07, ky,
                                 kz + dz * G,
                                 rx=G*0.042, ry=G*0.036, rz=G*0.042)
            m2 = union_masks(m2, pyr * 0.55)
        m2 = gaussian_filter(np.clip(m2, 0, None), 1.1)
        mesh_med = marching(m2, spacing=0.9)

        # ── Renal pelvis / sinus (Y-shaped collecting system at hilum) ─────
        px = kx + sign * G * 0.07
        upper = ellipsoid_mask((G,G,G), px, ky, kz + G*0.10,
                               rx=G*0.058, ry=G*0.048, rz=G*0.068,
                               noise=0.10, noise_scale=2)
        lower = ellipsoid_mask((G,G,G), px, ky, kz - G*0.10,
                               rx=G*0.058, ry=G*0.048, rz=G*0.068,
                               noise=0.10, noise_scale=2)
        mid   = ellipsoid_mask((G,G,G), px, ky, kz,
                               rx=G*0.040, ry=G*0.035, rz=G*0.11,
                               noise=0.08, noise_scale=2)
        m3 = union_masks(upper, lower, mid)
        m3 = gaussian_filter(np.clip(m3, 0, None), 1.0)
        mesh_pelvis = marching(m3, spacing=0.9)

        export_group([
            (mesh_cortex, f'{side} Kidney Cortex.stl'),
            (mesh_med,    f'{side} Kidney Medulla.stl'),
            (mesh_pelvis, f'{side} Renal Pelvis.stl'),
        ], target_scale_mm=130)


# ── LUNGS ──────────────────────────────────────────────────────────────────────
#
#  Left: upper lobe (superior) + lower lobe (inferior) separated by oblique fissure
#  Right: upper + middle + lower — middle lobe is a wedge on the anterior right
#
#  CRITICAL: lobes are placed at DIFFERENT z positions in the same grid:
#    upper lobe → z > G*0.50   (superior)
#    lower lobe → z < G*0.50   (inferior)
#    middle (right) → z ≈ G*0.50, anterior face (high y)

def _lungs():
    for side in ['Left', 'Right']:
        np.random.seed(46 if side == 'Left' else 47)
        G = 350
        sign = -1 if side == 'Left' else +1  # mediastinal side

        # ── Upper lobe (top portion of lung, z > centre) ──────────────────
        m_u = ellipsoid_mask((G,G,G), G*0.50, G*0.50, G*0.72,
                             rx=G*0.18, ry=G*0.15, rz=G*0.22,
                             noise=0.16, noise_scale=4.5)
        # Mediastinal concavity (heart pushes in from medial side)
        med = ellipsoid_mask((G,G,G), G*0.50 + sign*G*0.16, G*0.50, G*0.70,
                             rx=G*0.10, ry=G*0.17, rz=G*0.20)
        m_u = subtract_mask(m_u, med, 0.72)
        # Apex dome taper
        z_arr = np.arange(G, dtype=np.float32)
        apex = np.exp(-((z_arr - G*0.94)**2) / (2*(G*0.045)**2))
        m_u *= (1 - 0.75 * apex[np.newaxis, np.newaxis, :])
        # Rib impressions (subtle costal scalloping)
        rib = 0.04 * np.sin(z_arr / (G*0.032) * np.pi)
        m_u += rib[np.newaxis, np.newaxis, :] * (m_u > 0.35)
        m_u = gaussian_filter(np.clip(m_u, 0, None), 1.6)
        mesh_upper = marching(m_u, spacing=0.9)

        # ── Lower lobe (bottom portion, z < centre, large diaphragmatic base)
        m_l = ellipsoid_mask((G,G,G), G*0.50, G*0.50, G*0.28,
                             rx=G*0.21, ry=G*0.17, rz=G*0.23,
                             noise=0.16, noise_scale=4.5)
        # Diaphragmatic concavity — flatten inferior surface
        dia = ellipsoid_mask((G,G,G), G*0.50, G*0.50, G*0.06,
                             rx=G*0.23, ry=G*0.19, rz=G*0.08)
        m_l = subtract_mask(m_l, dia, 0.82)
        # Cardiac notch (left lower lobe only)
        if side == 'Left':
            card = ellipsoid_mask((G,G,G), G*0.38, G*0.64, G*0.33,
                                  rx=G*0.09, ry=G*0.09, rz=G*0.11)
            m_l = subtract_mask(m_l, card, 0.80)
        m_l = gaussian_filter(np.clip(m_l, 0, None), 1.6)
        mesh_lower = marching(m_l, spacing=0.9)

        parts = [
            (mesh_upper, f'{side} Upper Lobe.stl'),
            (mesh_lower, f'{side} Lower Lobe.stl'),
        ]

        # ── Middle lobe (right only — wedge at z≈G*0.52, anterior face) ───
        if side == 'Right':
            m_m = ellipsoid_mask((G,G,G), G*0.50, G*0.66, G*0.52,
                                 rx=G*0.17, ry=G*0.11, rz=G*0.12,
                                 noise=0.12, noise_scale=3.5)
            m_m = gaussian_filter(np.clip(m_m, 0, None), 1.4)
            mesh_mid = marching(m_m, spacing=0.9)
            parts.append((mesh_mid, 'Right Middle Lobe.stl'))

        export_group(parts, target_scale_mm=300)


# ── BONE / MSK ─────────────────────────────────────────────────────────────────
#
#  8 structures — each is its OWN organ (exported independently):
#   Vertebral body, spinous process, transverse processes, articular facets
#   Femoral shaft, femoral head+neck, femoral condyles, rib
#
#  Vertebra parts share one grid (they're all part of one vertebra).
#  Femur parts share one grid (they're part of one femur).
#  Rib is standalone.

def _bone():
    np.random.seed(48)

    # ── VERTEBRA (body + spinous process + transverse processes + facets) ──
    GV = 260

    # Vertebral body (cylinder-ish, endplate concavities)
    vb = ellipsoid_mask((GV,GV,GV), GV*0.50, GV*0.60, GV*0.50,
                        rx=GV*0.28, ry=GV*0.22, rz=GV*0.22,
                        noise=0.12, noise_scale=2.5)
    for zc in [GV*0.70, GV*0.30]:
        ep = ellipsoid_mask((GV,GV,GV), GV*0.50, GV*0.60, zc,
                            rx=GV*0.30, ry=GV*0.24, rz=GV*0.065)
        vb = subtract_mask(vb, ep, 0.62)
    x_arr = np.arange(GV, dtype=np.float32)
    trab = 0.015 * np.sin(x_arr / (GV*0.025) * np.pi)
    vb += trab[:, np.newaxis, np.newaxis] * (vb > 0.4)
    vb = gaussian_filter(np.clip(vb, 0, None), 1.0)

    # Spinous process (posterior spike, low y relative to body)
    sp = ellipsoid_mask((GV,GV,GV), GV*0.50, GV*0.18, GV*0.50,
                        rx=GV*0.07, ry=GV*0.20, rz=GV*0.09,
                        noise=0.10, noise_scale=2)
    y_arr = np.arange(GV, dtype=np.float32)
    taper_y = np.clip((y_arr - GV*0.08) / (GV*0.08), 0, 1)
    sp *= taper_y[np.newaxis, :, np.newaxis]
    sp = gaussian_filter(np.clip(sp, 0, None), 1.0)

    # Transverse processes (two lateral wings at x≈0.18 and x≈0.82)
    tp_l = ellipsoid_mask((GV,GV,GV), GV*0.18, GV*0.52, GV*0.50,
                          rx=GV*0.15, ry=GV*0.065, rz=GV*0.075, noise=0.10, noise_scale=2)
    tp_r = ellipsoid_mask((GV,GV,GV), GV*0.82, GV*0.52, GV*0.50,
                          rx=GV*0.15, ry=GV*0.065, rz=GV*0.075, noise=0.10, noise_scale=2)
    tp = union_masks(tp_l, tp_r)
    tp = gaussian_filter(np.clip(tp, 0, None), 1.0)

    # Articular facets (4 small ovals at corners)
    fa = np.zeros((GV,GV,GV), dtype=np.float32)
    for (fx, fz) in [(0.34, 0.66), (0.66, 0.66), (0.34, 0.34), (0.66, 0.34)]:
        f = ellipsoid_mask((GV,GV,GV), GV*fx, GV*0.36, GV*fz,
                           rx=GV*0.065, ry=GV*0.042, rz=GV*0.058,
                           noise=0.08, noise_scale=1.5)
        fa = union_masks(fa, f)
    fa = gaussian_filter(np.clip(fa, 0, None), 1.0)

    export_group([
        (marching(vb, 0.9), 'Vertebral Body.stl'),
        (marching(sp, 0.9), 'Spinous Process.stl'),
        (marching(tp, 0.9), 'Transverse Processes.stl'),
        (marching(fa, 0.9), 'Articular Facets.stl'),
    ], target_scale_mm=100)

    # ── FEMUR (shaft + head/neck + condyles) ──────────────────────────────
    GF = 340
    np.random.seed(49)

    # Shaft (long narrow ellipsoid, z-aligned)
    shaft = ellipsoid_mask((GF,GF,GF), GF*0.50, GF*0.50, GF*0.50,
                           rx=GF*0.085, ry=GF*0.078, rz=GF*0.44,
                           noise=0.08, noise_scale=2.5)
    # Anterior bow
    shaft_roll = np.roll(shaft, 4, axis=0)
    shaft = gaussian_filter(shaft * 0.55 + shaft_roll * 0.45, 0.9)
    # Periosteal roughness
    z_arr = np.arange(GF, dtype=np.float32) - GF*0.50
    rough = 0.010 * np.sin(z_arr / (GF*0.016) * np.pi)
    shaft += rough[np.newaxis, np.newaxis, :] * (shaft > 0.35)
    shaft = gaussian_filter(np.clip(shaft, 0, None), 1.0)

    # Head + neck (superior end, high z) — sphere on angled neck
    head = ellipsoid_mask((GF,GF,GF), GF*0.36, GF*0.58, GF*0.82,
                          rx=GF*0.13, ry=GF*0.13, rz=GF*0.13,
                          noise=0.10, noise_scale=2)
    fovea = ellipsoid_mask((GF,GF,GF), GF*0.34, GF*0.60, GF*0.84,
                           rx=GF*0.038, ry=GF*0.038, rz=GF*0.038)
    head = subtract_mask(head, fovea, 0.70)
    neck = ellipsoid_mask((GF,GF,GF), GF*0.44, GF*0.54, GF*0.76,
                          rx=GF*0.09, ry=GF*0.085, rz=GF*0.12,
                          noise=0.08, noise_scale=2)
    gt = ellipsoid_mask((GF,GF,GF), GF*0.62, GF*0.42, GF*0.78,
                        rx=GF*0.10, ry=GF*0.085, rz=GF*0.10,
                        noise=0.10, noise_scale=2)
    lt = ellipsoid_mask((GF,GF,GF), GF*0.40, GF*0.60, GF*0.68,
                        rx=GF*0.055, ry=GF*0.055, rz=GF*0.055,
                        noise=0.08, noise_scale=1.5)
    hn = union_masks(head, neck, gt, lt)
    hn = gaussian_filter(np.clip(hn, 0, None), 1.2)

    # Condyles (two knuckles at inferior end, low z)
    med_c = ellipsoid_mask((GF,GF,GF), GF*0.34, GF*0.50, GF*0.17,
                           rx=GF*0.12, ry=GF*0.13, rz=GF*0.10,
                           noise=0.10, noise_scale=2)
    lat_c = ellipsoid_mask((GF,GF,GF), GF*0.66, GF*0.50, GF*0.17,
                           rx=GF*0.12, ry=GF*0.13, rz=GF*0.10,
                           noise=0.10, noise_scale=2)
    troch = ellipsoid_mask((GF,GF,GF), GF*0.50, GF*0.62, GF*0.17,
                           rx=GF*0.09, ry=GF*0.085, rz=GF*0.08)
    cond = union_masks(med_c, lat_c)
    cond = subtract_mask(cond, troch, 0.52)
    cond = gaussian_filter(np.clip(cond, 0, None), 1.1)

    export_group([
        (marching(shaft, 0.9), 'Femoral Shaft.stl'),
        (marching(hn,    0.9), 'Femoral Head and Neck.stl'),
        (marching(cond,  0.9), 'Femoral Condyles.stl'),
    ], target_scale_mm=420)

    # ── RIB (standalone arc) ──────────────────────────────────────────────
    G = 280
    np.random.seed(52)
    m_rib = np.zeros((G,G,G), dtype=np.float32)
    n_seg = 20
    for i in range(n_seg):
        t = i / (n_seg - 1)          # 0 → 1
        angle = np.pi * t             # sweeps 180°
        cx = G * (0.50 + 0.38 * np.cos(angle))
        cy = G * (0.50 + 0.22 * np.sin(angle) * 0.45)
        cz = G * (0.50 - 0.08 * np.sin(angle))
        r  = G * (0.045 + 0.014 * np.sin(np.pi * t))
        seg = ellipsoid_mask((G,G,G), cx, cy, cz,
                             rx=r, ry=r*0.68, rz=r*0.62,
                             noise=0.06, noise_scale=1.5)
        m_rib = union_masks(m_rib, seg)
    # Rib head (articular facet at posterior end)
    head_r = ellipsoid_mask((G,G,G), G*0.88, G*0.50, G*0.50,
                            rx=G*0.055, ry=G*0.048, rz=G*0.042)
    m_rib = union_masks(m_rib, head_r)
    m_rib = gaussian_filter(np.clip(m_rib, 0, None), 1.0)
    mesh_rib = marching(m_rib, spacing=0.9)
    export_group([(mesh_rib, 'Rib.stl')], target_scale_mm=240)


# ── MAIN ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    # Remove all old organ STLs
    for f in os.listdir(OUT):
        if f.endswith('.stl'):
            os.remove(os.path.join(OUT, f))

    print(f"\n{'='*60}")
    print("Organ STL generation — shared-grid, group-centered export")
    print(f"Output: {os.path.abspath(OUT)}")
    print(f"{'='*60}\n")

    gen('Liver  (5 sub-structures)', _liver)
    gen('Spleen (3 sub-structures)', _spleen)
    gen('Kidneys (3 per side)',       _kidneys)
    gen('Lungs  (2-3 lobes each)',    _lungs)
    gen('Bone/MSK (8 structures)',    _bone)

    files = sorted(f for f in os.listdir(OUT) if f.endswith('.stl'))
    print(f"\n{'='*60}")
    print(f"Total: {len(files)} organ STL files")
    for f in files:
        kb = os.path.getsize(os.path.join(OUT, f)) // 1024
        print(f"  {f}  ({kb} KB)")
    print(f"{'='*60}\n")
