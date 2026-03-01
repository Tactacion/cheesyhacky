import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { BlendFunction, KernelSize } from 'postprocessing';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { STLFileInfo, DisplacementField, NoFlyZone } from '../types';
import '../shaders/FresnelMaterial';
import { NoFlyZoneOverlay } from './NoFlyZones';
import { SpleenBleedOverlay, LungCollapseOverlay, FemurFractureOverlay } from './TraumaScene';

export type ViewMode = 'EMS' | 'ER';

interface STLViewerProps {
  stlFiles: STLFileInfo[];
  caseId: string;
  selectedStructure: string | null;
  onStructureSelect: (structure: STLFileInfo, coordinates?: { x: number; y: number; z: number }) => void;
  onHoverChange?: (name: string | null) => void;
  displacementField?: DisplacementField | null;
  brainBounds?: THREE.Box3 | null;
  xrayMode?: boolean;
  noFlyZones?: NoFlyZone[];
  locked?: boolean;
  viewMode?: ViewMode;
  resectionPct?: number; // 0-100, controlled from outside
  traumaOrgan?: string;  // 'spleen' | 'lung' | 'bone' — triggers trauma overlays
}

// ── Trilinear interpolation into displacement grid ────────────────────────────
function trilinearInterp(field: DisplacementField, nx: number, ny: number, nz: number): [number, number, number] {
  const N = field.length;
  const fx = ((nx + 1) / 2) * (N - 1);
  const fy = ((ny + 1) / 2) * (N - 1);
  const fz = ((nz + 1) / 2) * (N - 1);
  const i0 = Math.max(0, Math.min(N - 2, Math.floor(fx)));
  const j0 = Math.max(0, Math.min(N - 2, Math.floor(fy)));
  const k0 = Math.max(0, Math.min(N - 2, Math.floor(fz)));
  const tx = fx - i0, ty = fy - j0, tz = fz - k0;
  const r: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    r[c] =
      field[i0  ][j0  ][k0  ][c]*(1-tx)*(1-ty)*(1-tz) +
      field[i0+1][j0  ][k0  ][c]*   tx *(1-ty)*(1-tz) +
      field[i0  ][j0+1][k0  ][c]*(1-tx)*   ty *(1-tz) +
      field[i0+1][j0+1][k0  ][c]*   tx *   ty *(1-tz) +
      field[i0  ][j0  ][k0+1][c]*(1-tx)*(1-ty)*   tz  +
      field[i0+1][j0  ][k0+1][c]*   tx *(1-ty)*   tz  +
      field[i0  ][j0+1][k0+1][c]*(1-tx)*   ty *   tz  +
      field[i0+1][j0+1][k0+1][c]*   tx *   ty *   tz;
  }
  return r;
}

// ── Stress Vector Field (InstancedMesh of cones) ──────────────────────────────
function StressVectorField({
  bounds,
  clippingPlane,
  visible,
}: {
  bounds: THREE.Box3 | null;
  clippingPlane: THREE.Plane | null;
  visible: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const COUNT = 2000;

  // Generate random positions inside the bounding box once
  const positions = useMemo<Float32Array>(() => {
    if (!bounds) return new Float32Array(COUNT * 3);
    const arr = new Float32Array(COUNT * 3);
    const size = bounds.getSize(new THREE.Vector3());
    const min = bounds.min;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3    ] = min.x + Math.random() * size.x;
      arr[i * 3 + 1] = min.y + Math.random() * size.y;
      arr[i * 3 + 2] = min.z + Math.random() * size.z;
    }
    return arr;
  }, [bounds]);

  const geo = useMemo(() => {
    // Thin cylinder (arrow body) pointing up (+Y)
    return new THREE.CylinderGeometry(0.12, 0.35, 2.5, 5, 1);
  }, []);

  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.4,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
  }), []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorArr = useMemo(() => new Float32Array(COUNT * 3), []);

  useEffect(() => {
    if (!meshRef.current || !bounds) return;
    const mesh = meshRef.current;
    const planeNorm = new THREE.Vector3(1, 0, 0);

    for (let i = 0; i < COUNT; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];

      // Distance to clipping plane (positive = not clipped side)
      let distToPlane = 1.0;
      if (clippingPlane) {
        distToPlane = clippingPlane.distanceToPoint(new THREE.Vector3(px, py, pz));
      }

      // Stress = high near cut plane (within 15 units), low far away
      const bounds_size = bounds.getSize(new THREE.Vector3());
      const maxDim = Math.max(bounds_size.x, bounds_size.y, bounds_size.z);
      const proximity = Math.max(0, 1 - Math.abs(distToPlane) / (maxDim * 0.25));
      const stress = proximity * proximity; // nonlinear falloff

      // Scale: stressed vectors are larger
      const scale = 0.3 + stress * 2.8;

      // Random orientation biased upward
      dummy.position.set(px, py, pz);
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.4,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.4,
      );
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Color: blue (low) → green → yellow → red (high stress)
      const c = new THREE.Color();
      c.setHSL((1 - stress) * 0.67, 0.9, 0.55); // 0.67=blue, 0=red
      colorArr[i * 3    ] = c.r;
      colorArr[i * 3 + 1] = c.g;
      colorArr[i * 3 + 2] = c.b;
    }

    mesh.instanceMatrix.needsUpdate = true;
    // Set vertex colors via instance color attribute
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colorArr, 3);
    mesh.instanceColor.needsUpdate = true;
  }, [bounds, clippingPlane, positions, dummy, colorArr]);

  // Animate: pulse stressed vectors
  useFrame(({ clock }) => {
    if (!meshRef.current || !bounds) return;
    const mesh = meshRef.current;
    const t = clock.elapsedTime;
    const bounds_size = bounds.getSize(new THREE.Vector3());
    const maxDim = Math.max(bounds_size.x, bounds_size.y, bounds_size.z);

    for (let i = 0; i < COUNT; i++) {
      const px = positions[i * 3];
      let distToPlane = 1.0;
      if (clippingPlane) {
        distToPlane = clippingPlane.distanceToPoint(new THREE.Vector3(px, 0, 0));
      }
      const proximity = Math.max(0, 1 - Math.abs(distToPlane) / (maxDim * 0.25));
      const stress = proximity * proximity;

      if (stress > 0.3) {
        mesh.getMatrixAt(i, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        const pulse = 1 + Math.sin(t * 3 + i * 0.1) * 0.15 * stress;
        dummy.scale.setScalar(dummy.scale.x * pulse);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!visible || !bounds) return null;

  return (
    <instancedMesh ref={meshRef} args={[geo, mat, COUNT]} frustumCulled={false} />
  );
}

// ── Single STL mesh (dual-pass: solid base + wireframe FEA overlay) ───────────
function STLMesh({
  url, name, isSelected, isHovered, onSelect, onHover, onUnhover,
  index, onBboxUpdate, displacementField, brainBounds, xrayMode,
  clippingPlanes, viewMode,
}: {
  url: string; name: string;
  isSelected: boolean; isHovered: boolean;
  onSelect: (coords?: { x: number; y: number; z: number }) => void;
  onHover: () => void; onUnhover: () => void;
  index: number;
  onBboxUpdate?: (bbox: THREE.Box3) => void;
  displacementField?: DisplacementField | null;
  brainBounds?: THREE.Box3 | null;
  xrayMode?: boolean;
  clippingPlanes?: THREE.Plane[];
  viewMode?: ViewMode;
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const matRef = useRef<any>(null);
  const wireMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const origPos = useRef<Float32Array | null>(null);
  const tgtPos  = useRef<Float32Array | null>(null);
  const deformT = useRef(0);

  useEffect(() => {
    const loader = new STLLoader();
    loader.load(url, (g) => {
      g.computeVertexNormals();
      const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
      setGeometry(g);
      onBboxUpdate?.(box);
    }, undefined, err => console.error(`[STL] ${name}:`, err));
  }, [url]);

  useEffect(() => {
    if (!geometry) return;
    origPos.current = new Float32Array((geometry.attributes.position as THREE.BufferAttribute).array);
  }, [geometry]);

  useEffect(() => {
    if (!isSelected || !displacementField || !geometry || !origPos.current || !brainBounds) {
      if (!isSelected && origPos.current && geometry) {
        const pa = geometry.attributes.position as THREE.BufferAttribute;
        pa.array.set(origPos.current); pa.needsUpdate = true;
        geometry.computeVertexNormals();
        tgtPos.current = null; deformT.current = 0;
      }
      return;
    }
    const orig = origPos.current, n = orig.length / 3;
    const tgt = new Float32Array(n * 3);
    const SCALE = 80000;
    const bc = brainBounds.getCenter(new THREE.Vector3());
    const bs = brainBounds.getSize(new THREE.Vector3());
    const bm = Math.max(bs.x, bs.y, bs.z);
    for (let i = 0; i < n; i++) {
      const vx = orig[i*3], vy = orig[i*3+1], vz = orig[i*3+2];
      const [dx,dy,dz] = trilinearInterp(displacementField,
        bm > 0 ? (vx-bc.x)/(bm/2) : 0,
        bm > 0 ? (vy-bc.y)/(bm/2) : 0,
        bm > 0 ? (vz-bc.z)/(bm/2) : 0
      );
      tgt[i*3]=vx+dx*SCALE; tgt[i*3+1]=vy+dy*SCALE; tgt[i*3+2]=vz+dz*SCALE;
    }
    tgtPos.current = tgt; deformT.current = 0;
  }, [isSelected, displacementField, geometry, brainBounds]);

  useFrame(({ clock }, delta) => {
    if (!matRef.current) return;

    const baseOpacity = xrayMode ? 0.08 : 0.14;
    const selOpacity  = xrayMode ? 0.7  : 0.92;
    const hovOpacity  = xrayMode ? 0.3  : 0.45;

    if (isSelected) {
      matRef.current.uFresnelScale = 1.6 + Math.sin(clock.elapsedTime * 1.4) * 0.2;
      matRef.current.uOpacity = selOpacity;
      matRef.current.uSSSStrength = 0.7;
    } else if (isHovered) {
      matRef.current.uFresnelScale = 1.4;
      matRef.current.uOpacity = hovOpacity;
      matRef.current.uSSSStrength = 0.5;
    } else {
      matRef.current.uFresnelScale = 1.0;
      matRef.current.uOpacity = baseOpacity;
      matRef.current.uSSSStrength = 0.3;
    }

    // Wireframe opacity pulses subtly
    if (wireMatRef.current) {
      wireMatRef.current.opacity = isSelected
        ? 0.28 + Math.sin(clock.elapsedTime * 2.2) * 0.06
        : isHovered ? 0.22 : 0.10;
    }

    // Deform animation
    if (isSelected && tgtPos.current && geometry && origPos.current) {
      const t = deformT.current;
      if (t < 1.0) {
        deformT.current = Math.min(t + delta / 1.5, 1.0);
        const s = t * t * (3 - 2 * t);
        const orig = origPos.current, tgt = tgtPos.current;
        const pa = geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < orig.length / 3; i++) {
          pa.setXYZ(i,
            orig[i*3]  + (tgt[i*3]  - orig[i*3])  * s,
            orig[i*3+1]+ (tgt[i*3+1]-orig[i*3+1]) * s,
            orig[i*3+2]+ (tgt[i*3+2]-orig[i*3+2]) * s,
          );
        }
        pa.needsUpdate = true;
        geometry.computeVertexNormals();
      }
    }
  });

  if (!geometry) return null;

  const hue = (index * 137.508) % 360;
  const baseHex = new THREE.Color().setHSL(hue / 360, 0.35, 0.07);
  const rimHex  = new THREE.Color().setHSL(hue / 360, 0.65, isHovered ? 0.72 : 0.58);
  const sssHex  = new THREE.Color().setHSL(((hue + 20) % 360) / 360, 0.5, 0.75);
  const selBase = new THREE.Color(0x0d2030);
  const selRim  = new THREE.Color(0x5eead4);
  const selSss  = new THREE.Color(0x7dd3fc);

  // Wireframe emissive color — teal for selected, organ hue for others
  const wireColor = isSelected
    ? new THREE.Color(0x00ffcc)
    : new THREE.Color().setHSL(hue / 360, 0.8, 0.6);

  const clipPlanes = clippingPlanes ?? [];

  return (
    <group
      onClick={e => { e.stopPropagation(); const p = e.point; onSelect({ x: p.x, y: p.y, z: p.z }); }}
      onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'crosshair'; onHover(); }}
      onPointerOut={() => { document.body.style.cursor = 'default'; onUnhover(); }}
    >
      {/* Pass 1: Solid Fresnel base */}
      <mesh geometry={geometry}>
        {/* @ts-ignore */}
        <fresnelMaterial
          ref={matRef}
          uBaseColor={isSelected ? selBase : baseHex}
          uRimColor={isSelected ? selRim : rimHex}
          uSSSColor={isSelected ? selSss : sssHex}
          uFresnelPower={isSelected ? 2.4 : isHovered ? 2.8 : 3.8}
          uFresnelScale={isSelected ? 1.6 : 1.0}
          uOpacity={isSelected ? 0.88 : 0.12}
          uSSSStrength={isSelected ? 0.7 : 0.3}
          transparent
          depthWrite={isSelected}
          side={THREE.DoubleSide}
          clippingPlanes={clipPlanes}
        />
      </mesh>

      {/* Pass 2: Wireframe FEA overlay — only in ER mode */}
      {viewMode !== 'EMS' && (
        <mesh geometry={geometry}>
          <meshBasicMaterial
            ref={wireMatRef}
            wireframe={true}
            transparent={true}
            opacity={0.10}
            color={wireColor}
            depthWrite={false}
            clippingPlanes={clipPlanes}
          />
        </mesh>
      )}
    </group>
  );
}

// ── Reactive camera fitter — re-fits as STLs load incrementally ──────────────
function ReactiveCameraFitter({ bounds }: { bounds: THREE.Box3 | null }) {
  const lastFitBounds = useRef<THREE.Box3 | null>(null);
  const lastChangeTime = useRef(0);
  const settled = useRef(false);
  const lerpT = useRef(0);
  const targetPos = useRef(new THREE.Vector3());
  const targetCenter = useRef(new THREE.Vector3());

  useFrame(({ camera, clock }) => {
    if (!bounds) return;
    const now = clock.elapsedTime;

    // Detect significant bounds change
    const prev = lastFitBounds.current;
    let changed = false;
    if (!prev) {
      changed = true;
    } else {
      const dMin = prev.min.distanceTo(bounds.min);
      const dMax = prev.max.distanceTo(bounds.max);
      changed = dMin > 0.5 || dMax > 0.5;
    }

    if (changed) {
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const dist = Math.max(size.x, size.y, size.z) * 1.6 || 50;
      targetCenter.current.copy(center);
      targetPos.current.set(center.x, center.y, center.z + dist);
      lastFitBounds.current = bounds.clone();
      lastChangeTime.current = now;
      settled.current = false;
      lerpT.current = 0;
    }

    // Settle after 2s of no changes
    if (!settled.current && now - lastChangeTime.current > 2.0) {
      settled.current = true;
    }

    // Smooth lerp toward target while not settled
    if (!settled.current) {
      lerpT.current = Math.min(lerpT.current + 0.04, 1);
      const s = lerpT.current * lerpT.current * (3 - 2 * lerpT.current); // smoothstep
      camera.position.lerp(targetPos.current, s * 0.12 + 0.01);
      (camera as THREE.PerspectiveCamera).lookAt(targetCenter.current);
    }
  });
  return null;
}

// ── EMS camera lock — front-facing orthographic-style ────────────────────────
function EMSCameraLock({ bounds }: { bounds: THREE.Box3 | null }) {
  useFrame(({ camera }) => {
    if (!bounds) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 1.8;
    camera.position.lerp(
      new THREE.Vector3(center.x, center.y, center.z + dist),
      0.06
    );
    (camera as THREE.PerspectiveCamera).lookAt(center);
  });
  return null;
}

// ── Intro rotation ─────────────────────────────────────────────────────────────
function IntroRotator({ active }: { active: boolean }) {
  const { camera } = useThree();
  const elapsed = useRef(0);
  const done = useRef(false);
  useFrame((_, delta) => {
    if (!active || done.current) return;
    elapsed.current += delta;
    if (elapsed.current < 3.0) {
      const angle = (elapsed.current / 3.0) * (Math.PI / 4);
      const r = camera.position.length();
      camera.position.x = r * Math.sin(angle);
      camera.position.z = r * Math.cos(angle);
      camera.lookAt(0, 0, 0);
    } else { done.current = true; }
  });
  return null;
}

// ── GL clipping enabler ───────────────────────────────────────────────────────
function EnableClipping({ planes }: { planes: THREE.Plane[] }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = true;
    gl.clippingPlanes = planes;
    return () => { gl.localClippingEnabled = false; gl.clippingPlanes = []; };
  }, [gl, planes]);
  return null;
}

// ── Physics metrics for ER HUD ───────────────────────────────────────────────
const ER_METRICS = [
  { label: 'Max Principal Stress', value: '45.2 kPa', color: '#ff6b7a' },
  { label: 'Von Mises (peak)',      value: '38.7 kPa', color: '#fbbf24' },
  { label: 'Mesh Nodes',            value: '1.24M',    color: '#7ef0ff' },
  { label: 'Tetrahedral Elements',  value: '4.81M',    color: '#7ef0ff' },
  { label: 'Young\'s Modulus',      value: 'E = 3.0 GPa', color: '#86efac' },
  { label: 'Poisson Ratio',         value: 'ν = 0.49',    color: '#86efac' },
  { label: 'PINN Convergence',      value: '99.3%',    color: '#00ff88' },
  { label: 'Solver Iterations',     value: '1,842',    color: '#a78bfa' },
];

// ── Main export ───────────────────────────────────────────────────────────────
export const STLViewer: React.FC<STLViewerProps> = ({
  stlFiles, caseId, selectedStructure, onStructureSelect,
  onHoverChange, displacementField, brainBounds, xrayMode,
  noFlyZones = [], locked = false,
  viewMode = 'ER',
  resectionPct: externalResectionPct,
  traumaOrgan,
}) => {
  const [allBounds, setAllBounds] = useState<THREE.Box3 | null>(null);
  const [maxVisible, setMaxVisible] = useState(20);
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const [introActive, setIntroActive] = useState(true);
  const [resectionPct, setResectionPct] = useState(0);

  // Use external control if provided
  const activePct = externalResectionPct !== undefined ? externalResectionPct : resectionPct;

  const visibleFiles = stlFiles.slice(0, maxVisible);

  useEffect(() => {
    if (maxVisible < stlFiles.length) {
      const t = setTimeout(() => setMaxVisible(v => Math.min(v + 10, stlFiles.length)), 500);
      return () => clearTimeout(t);
    }
  }, [maxVisible, stlFiles.length]);

  useEffect(() => {
    const t = setTimeout(() => setIntroActive(false), 4000);
    return () => clearTimeout(t);
  }, []);

  // Clipping plane — slices along the X axis of the bounding box
  const clippingPlane = useMemo<THREE.Plane | null>(() => {
    if (!allBounds || viewMode === 'EMS') return null;
    const min = allBounds.min.x;
    const max = allBounds.max.x;
    // activePct = 0 → no cut (plane far right), 100 → full cut (plane far left)
    const cutX = max - (activePct / 100) * (max - min);
    // Plane: normal points -X, constant pushes the cut
    return new THREE.Plane(new THREE.Vector3(-1, 0, 0), cutX);
  }, [allBounds, activePct, viewMode]);

  const clippingPlanes = useMemo(() =>
    clippingPlane ? [clippingPlane] : [],
  [clippingPlane]);

  const handleBboxUpdate = useCallback((bbox: THREE.Box3) => {
    setAllBounds(prev => {
      if (!prev) return bbox.clone();
      const c = prev.clone();
      c.min.x = Math.min(c.min.x, bbox.min.x); c.min.y = Math.min(c.min.y, bbox.min.y); c.min.z = Math.min(c.min.z, bbox.min.z);
      c.max.x = Math.max(c.max.x, bbox.max.x); c.max.y = Math.max(c.max.y, bbox.max.y); c.max.z = Math.max(c.max.z, bbox.max.z);
      return c;
    });
  }, []);

  const orbitTarget = useMemo(
    () => allBounds?.getCenter(new THREE.Vector3()).toArray() ?? [0, 0, 0],
    [allBounds]
  );

  const handleHover = useCallback((filename: string, name: string) => {
    setHoveredFile(filename);
    onHoverChange?.(name);
  }, [onHoverChange]);

  const handleUnhover = useCallback((filename: string) => {
    setHoveredFile(v => v === filename ? null : v);
    onHoverChange?.(null);
  }, [onHoverChange]);

  const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001/api').replace('/api', '');
  const isEMS = viewMode === 'EMS';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 0, 100], fov: 50 }}
        onCreated={({ scene }) => { scene.background = new THREE.Color(0x050810); }}
        gl={{ antialias: true, alpha: false }}
      >
        <fog attach="fog" args={['#050810', 120, 600]} />
        <ambientLight intensity={xrayMode ? 0.04 : 0.10} />
        <pointLight position={[0, 80, 60]} intensity={xrayMode ? 0.2 : 0.35} color="#001a2a" />
        <pointLight position={[60, -40, 20]} intensity={0.12} color="#0a0020" />

        {/* Enable local clipping on the renderer */}
        {clippingPlanes.length > 0 && <EnableClipping planes={clippingPlanes} />}

        <ReactiveCameraFitter bounds={allBounds} />
        {isEMS
          ? <EMSCameraLock bounds={allBounds} />
          : <IntroRotator active={introActive} />
        }

        {visibleFiles.map((f, i) => (
          <STLMesh
            key={f.filename}
            url={`${API_BASE}/api/stl/${caseId}/${f.filename}`}
            name={f.name}
            isSelected={selectedStructure === f.filename}
            isHovered={hoveredFile === f.filename}
            onSelect={coords => onStructureSelect(f, coords)}
            onHover={() => handleHover(f.filename, f.name)}
            onUnhover={() => handleUnhover(f.filename)}
            index={i}
            onBboxUpdate={handleBboxUpdate}
            displacementField={selectedStructure === f.filename ? displacementField : null}
            brainBounds={brainBounds ?? allBounds}
            xrayMode={xrayMode}
            clippingPlanes={clippingPlanes}
            viewMode={viewMode}
          />
        ))}

        {/* PINN Stress Vector Field — ER mode only */}
        <StressVectorField
          bounds={allBounds}
          clippingPlane={clippingPlane}
          visible={!isEMS && activePct > 0}
        />

        {/* Trauma overlays — procedural synthetic scenes */}
        {traumaOrgan === 'spleen' && (
          <SpleenBleedOverlay bounds={allBounds} resectionPct={activePct} />
        )}
        {traumaOrgan === 'lung' && (
          <LungCollapseOverlay bounds={allBounds} resectionPct={activePct} />
        )}
        {traumaOrgan === 'bone' && (
          <FemurFractureOverlay bounds={allBounds} resectionPct={activePct} />
        )}

        {allBounds && (
          <NoFlyZoneOverlay
            zones={noFlyZones}
            visible={noFlyZones.length > 0}
            brainBounds={allBounds}
          />
        )}

        {!isEMS && (
          <OrbitControls
            enablePan enableZoom enableRotate
            minDistance={10} maxDistance={500}
            target={orbitTarget as [number, number, number]}
          />
        )}

        <EffectComposer>
          <Bloom
            luminanceThreshold={0.45}
            luminanceSmoothing={0.9}
            intensity={isEMS ? 0.3 : 1.1}
            kernelSize={KernelSize.HUGE}
            blendFunction={BlendFunction.SCREEN}
          />
        </EffectComposer>
      </Canvas>

      {/* ── EMS HUD overlay ────────────────────────────────────────────── */}
      {isEMS && (
        <div style={{
          position: 'absolute', inset: 0,
          pointerEvents: 'none',
          display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 24,
        }}>
          {/* Top-left: scan header */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'rgba(255,58,76,0.7)',
            }}>
              ◉ SYNOVIA · EMS FIELD SCAN · ACTIVE
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700,
              letterSpacing: '0.06em', lineHeight: 1.1,
              color: '#ff3a4c',
              textShadow: '0 0 32px #ff3a4c88, 0 0 8px #ff3a4caa',
              animation: 'emsFlash 2.4s ease-in-out infinite',
            }}>
              PRE-EXISTING<br />DEFICIT DETECTED
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: 'rgba(255,176,32,0.9)',
              letterSpacing: '0.1em',
              marginTop: 4,
            }}>
              ⚡ LEFT HAND MOTOR · TEMPORAL LOBE · 2024-08-14
            </div>
          </div>

          {/* Bottom: scan grid corners */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              color: 'rgba(126,240,255,0.5)',
              letterSpacing: '0.12em',
              lineHeight: 1.8,
            }}>
              MRN: EZM-00421<br />
              BLOOD: A+<br />
              DNR: NO
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              color: 'rgba(126,240,255,0.4)',
              letterSpacing: '0.10em',
              textAlign: 'right',
              lineHeight: 1.8,
            }}>
              SCAN MODE: FIELD<br />
              CONTROLS: LOCKED<br />
              DO NOT RESECT
            </div>
          </div>

          {/* Corner brackets */}
          {[
            { top: 0, left: 0, borderTop: '2px solid', borderLeft: '2px solid' },
            { top: 0, right: 0, borderTop: '2px solid', borderRight: '2px solid' },
            { bottom: 0, left: 0, borderBottom: '2px solid', borderLeft: '2px solid' },
            { bottom: 0, right: 0, borderBottom: '2px solid', borderRight: '2px solid' },
          ].map((style, i) => (
            <div key={i} style={{
              position: 'absolute',
              width: 24, height: 24,
              borderColor: 'rgba(255,58,76,0.5)',
              ...style,
            }} />
          ))}
        </div>
      )}

      {/* ── ER Surgeon mode overlays ─────────────────────────────────────── */}
      {!isEMS && (
        <>
          {/* Resection slider — bottom center */}
          {externalResectionPct === undefined && (
            <div style={{
              position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              padding: '12px 20px',
              background: 'rgba(5,8,16,0.82)',
              border: '1px solid rgba(126,240,255,0.18)',
              borderRadius: 12,
              backdropFilter: 'blur(12px)',
              minWidth: 280,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9,
                  letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: 'rgba(126,240,255,0.6)',
                }}>
                  Resection Volume
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700,
                  color: activePct > 50 ? '#ff6b7a' : activePct > 20 ? '#fbbf24' : '#7ef0ff',
                  transition: 'color 0.3s',
                }}>
                  {activePct.toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min={0} max={100} step={1}
                value={activePct}
                onChange={e => setResectionPct(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#7ef0ff', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.08em' }}>CONSERVATIVE</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.08em' }}>RADICAL</span>
              </div>
            </div>
          )}

          {/* Physics metrics — top right */}
          <div style={{
            position: 'absolute', top: 12, right: 12,
            display: 'flex', flexDirection: 'column', gap: 3,
            padding: '10px 14px',
            background: 'rgba(5,8,16,0.75)',
            border: '1px solid rgba(126,240,255,0.12)',
            borderRadius: 10,
            backdropFilter: 'blur(10px)',
            minWidth: 220,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 8,
              letterSpacing: '0.16em', textTransform: 'uppercase',
              color: 'rgba(126,240,255,0.45)',
              marginBottom: 6,
              borderBottom: '1px solid rgba(126,240,255,0.1)',
              paddingBottom: 5,
            }}>
              ◈ FEA / PINN Metrics
            </div>
            {ER_METRICS.map((m) => (
              <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9,
                  color: 'rgba(255,255,255,0.35)',
                  letterSpacing: '0.04em',
                  whiteSpace: 'nowrap',
                }}>{m.label}</span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                  color: m.color,
                  whiteSpace: 'nowrap',
                }}>{m.value}</span>
              </div>
            ))}
          </div>

          {/* Wireframe label — top left */}
          <div style={{
            position: 'absolute', top: 12, left: 12,
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '7px 12px',
            background: 'rgba(5,8,16,0.75)',
            border: '1px solid rgba(0,255,136,0.15)',
            borderRadius: 8,
            backdropFilter: 'blur(8px)',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: 1,
              background: 'transparent',
              border: '1px solid rgba(0,255,136,0.7)',
              boxShadow: '0 0 6px #00ff8855',
            }} />
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'rgba(0,255,136,0.7)',
            }}>
              FEA Mesh Overlay · Active
            </span>
          </div>

          {/* Stress vector legend — bottom right */}
          {activePct > 0 && (
            <div style={{
              position: 'absolute', bottom: 20, right: 12,
              padding: '10px 14px',
              background: 'rgba(5,8,16,0.82)',
              border: '1px solid rgba(255,107,122,0.18)',
              borderRadius: 10,
              backdropFilter: 'blur(10px)',
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 8,
                letterSpacing: '0.14em', textTransform: 'uppercase',
                color: 'rgba(255,107,122,0.6)',
                marginBottom: 8,
              }}>PINN Stress Field</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { label: 'HIGH stress', color: '#ff3a4c' },
                  { label: 'MED stress',  color: '#fbbf24' },
                  { label: 'LOW stress',  color: '#00b4ff' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, boxShadow: `0 0 6px ${item.color}88` }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em' }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Click hint */}
          {stlFiles.length > 0 && (
            <div style={{
              position: 'absolute', bottom: activePct > 0 ? 86 : 80, left: '50%', transform: 'translateX(-50%)',
              pointerEvents: 'none',
              padding: '5px 13px',
              background: 'rgba(5,8,16,0.8)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 20,
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                Click any structure to run simulation
              </span>
            </div>
          )}
        </>
      )}

      {/* Structure count */}
      {maxVisible < stlFiles.length && (
        <div style={{
          position: 'absolute', top: 8, right: isEMS ? 8 : 250,
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--text-dim)',
        }}>
          {maxVisible}/{stlFiles.length} loaded
        </div>
      )}
    </div>
  );
};
