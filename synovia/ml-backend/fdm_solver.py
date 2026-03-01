"""
Finite Difference Method (FDM) Linear Elasticity Solver — Optimized
=====================================================================
Solves the Navier-Lame equations for a homogeneous isotropic elastic body.

Vectorized assembly using NumPy structured arrays for O(N³) speed.
Brain tissue: E ≈ 2000 Pa, ν ≈ 0.45
Grid: 20³ nodes in normalized [-1, 1]³ space
"""

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import spsolve
from typing import Tuple


def solve_fdm_elasticity(
    centroid: Tuple[float, float, float],
    radius: float,
    grid_size: int = 20,
    E: float = 2000.0,
    nu: float = 0.45,
) -> dict:
    """
    Run FDM linear elasticity solver.

    Parameters
    ----------
    centroid : (x, y, z) in normalized [-1, 1]³ — centre of removed region
    radius   : removal radius in normalized units
    grid_size: N for N³ grid (20 → ~1-2s solve time)
    E        : Young's modulus in Pa (brain tissue ~2000 Pa)
    nu       : Poisson's ratio (brain ~0.45)

    Returns
    -------
    dict: grid_size, displacements [N][N][N][3], max_stress_kpa, bounds
    """
    N = grid_size
    n_nodes = N ** 3
    n_dof = 3 * n_nodes

    lam = E * nu / ((1 + nu) * (1 - 2 * nu))
    mu  = E / (2 * (1 + nu))

    h  = 2.0 / (N - 1)
    h2 = h * h

    # ── Build coordinate grids ─────────────────────────────────────────────────
    coords = np.linspace(-1.0, 1.0, N)
    gx, gy, gz = np.meshgrid(coords, coords, coords, indexing='ij')
    # Shape (N, N, N) for each

    # ── Node index array ───────────────────────────────────────────────────────
    # node_idx[i,j,k] = i*N*N + j*N + k
    idx_arr = np.arange(n_nodes, dtype=np.int32).reshape(N, N, N)

    def dof(comp: int, node_flat: np.ndarray) -> np.ndarray:
        return comp * n_nodes + node_flat

    # ── Identify interior nodes ────────────────────────────────────────────────
    interior = np.ones((N, N, N), dtype=bool)
    interior[0, :, :] = False; interior[-1, :, :] = False
    interior[:, 0, :] = False; interior[:, -1, :] = False
    interior[:, :, 0] = False; interior[:, :, -1] = False

    # flat indices of interior nodes
    int_flat = idx_arr[interior]   # shape (n_int,)
    n_int = int_flat.size

    # Grid positions of interior nodes
    ix, iy, iz = np.where(interior)

    # ── Collect COO entries for K ──────────────────────────────────────────────
    rows_list, cols_list, vals_list = [], [], []

    def add(r: np.ndarray, c: np.ndarray, v: np.ndarray):
        rows_list.append(r)
        cols_list.append(c)
        vals_list.append(v)

    # Steps per component: c=0 → (i), c=1 → (j), c=2 → (k)
    step_dims = [(1, 0, 0), (0, 1, 0), (0, 0, 1)]

    for c in range(3):
        base_row = dof(c, int_flat)
        di, dj, dk = step_dims[c]

        # Laplacian μ∇²u_c — 7-point stencil
        # Diagonal contribution
        add(base_row, base_row, np.full(n_int, -6 * mu / h2))

        for (si, sj, sk) in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]:
            ni, nj, nk = ix + si, iy + sj, iz + sk
            # All 6 neighbors of interior nodes are within [0, N-1]
            # (interior excludes boundary so offsets ±1 are safe)
            col_flat = idx_arr[ni, nj, nk]
            add(base_row, dof(c, col_flat), np.full(n_int, mu / h2))

        # (λ+μ) ∂²u_c/∂x_c² self-derivative
        add(base_row, base_row, np.full(n_int, -2 * (lam + mu) / h2))

        ni1, nj1, nk1 = ix + di, iy + dj, iz + dk
        ni2, nj2, nk2 = ix - di, iy - dj, iz - dk

        # Clamp to avoid OOB (boundary DOFs will be overwritten anyway)
        ni1 = np.clip(ni1, 0, N-1); nj1 = np.clip(nj1, 0, N-1); nk1 = np.clip(nk1, 0, N-1)
        ni2 = np.clip(ni2, 0, N-1); nj2 = np.clip(nj2, 0, N-1); nk2 = np.clip(nk2, 0, N-1)

        add(base_row, dof(c, idx_arr[ni1, nj1, nk1]), np.full(n_int, (lam + mu) / h2))
        add(base_row, dof(c, idx_arr[ni2, nj2, nk2]), np.full(n_int, (lam + mu) / h2))

        # Cross-derivative (λ+μ) ∂²u_d/∂x_c∂x_d for d ≠ c
        for d in range(3):
            if d == c:
                continue
            dd_i, dd_j, dd_k = step_dims[d]
            coeff = (lam + mu) / (4 * h2)

            for sc in (+1, -1):
                for sd in (+1, -1):
                    ni = np.clip(ix + sc * di + sd * dd_i, 0, N-1)
                    nj = np.clip(iy + sc * dj + sd * dd_j, 0, N-1)
                    nk = np.clip(iz + sc * dk + sd * dd_k, 0, N-1)
                    add(base_row, dof(d, idx_arr[ni, nj, nk]),
                        np.full(n_int, sc * sd * coeff))

    # Boundary DOFs: identity rows (u = 0)
    bnd_flat = idx_arr[~interior].ravel()
    for c in range(3):
        bnd_dof = dof(c, bnd_flat)
        add(bnd_dof, bnd_dof, np.ones(bnd_dof.size))

    # Assemble COO → CSR
    rows_all = np.concatenate(rows_list).astype(np.int32)
    cols_all = np.concatenate(cols_list).astype(np.int32)
    vals_all = np.concatenate(vals_list)
    K = sparse.coo_matrix((vals_all, (rows_all, cols_all)), shape=(n_dof, n_dof)).tocsr()

    # ── Build force vector ─────────────────────────────────────────────────────
    F = np.zeros(n_dof)
    cx, cy, cz = centroid
    dist3d = np.sqrt((gx - cx)**2 + (gy - cy)**2 + (gz - cz)**2)
    inside = (dist3d < radius) & (dist3d > 1e-10) & interior

    if inside.any():
        dist_in  = dist3d[inside]
        dirs     = np.stack([
            (gx[inside] - cx) / dist_in,
            (gy[inside] - cy) / dist_in,
            (gz[inside] - cz) / dist_in,
        ], axis=1)   # (n_inside, 3)
        magnitude = (1.0 - dist_in / radius) * 0.4 * E
        flat_in = idx_arr[inside]
        for c in range(3):
            np.add.at(F, dof(c, flat_in), -dirs[:, c] * magnitude)

    # ── Solve ──────────────────────────────────────────────────────────────────
    U = spsolve(K, F)

    ux = U[0 * n_nodes : 1 * n_nodes].reshape(N, N, N)
    uy = U[1 * n_nodes : 2 * n_nodes].reshape(N, N, N)
    uz = U[2 * n_nodes : 3 * n_nodes].reshape(N, N, N)

    displacements = np.stack([ux, uy, uz], axis=-1)  # (N, N, N, 3)

    # ── Von Mises stress ────────────────────────────────────────────────────────
    eps_xx = np.gradient(ux, h, axis=0)
    eps_yy = np.gradient(uy, h, axis=1)
    eps_zz = np.gradient(uz, h, axis=2)
    eps_xy = 0.5 * (np.gradient(ux, h, axis=1) + np.gradient(uy, h, axis=0))
    eps_xz = 0.5 * (np.gradient(ux, h, axis=2) + np.gradient(uz, h, axis=0))
    eps_yz = 0.5 * (np.gradient(uy, h, axis=2) + np.gradient(uz, h, axis=1))

    tr_eps = eps_xx + eps_yy + eps_zz
    sig_xx = lam * tr_eps + 2 * mu * eps_xx
    sig_yy = lam * tr_eps + 2 * mu * eps_yy
    sig_zz = lam * tr_eps + 2 * mu * eps_zz
    sig_xy = 2 * mu * eps_xy
    sig_xz = 2 * mu * eps_xz
    sig_yz = 2 * mu * eps_yz

    vm = np.sqrt(0.5 * (
        (sig_xx - sig_yy)**2 + (sig_yy - sig_zz)**2 + (sig_zz - sig_xx)**2 +
        6 * (sig_xy**2 + sig_xz**2 + sig_yz**2)
    ))

    max_stress_kpa = round(float(np.nanmax(vm)) / 1000.0, 4)

    return {
        "grid_size": [N, N, N],
        "displacements": displacements.tolist(),
        "max_stress_kpa": max_stress_kpa,
        "bounds": {"min": [-1.0, -1.0, -1.0], "max": [1.0, 1.0, 1.0]},
    }


if __name__ == "__main__":
    import time
    print("FDM solver smoke test (20³ grid)...")
    t0 = time.time()
    result = solve_fdm_elasticity((0.0, 0.0, 0.0), 0.2, grid_size=20)
    dt = time.time() - t0
    print(f"  Solved in {dt:.2f}s")
    print(f"  max_stress_kpa:     {result['max_stress_kpa']}")
    arr = np.array(result['displacements'])
    print(f"  displacement shape: {arr.shape}")
    print(f"  max |displacement|: {np.abs(arr).max():.6e}")
