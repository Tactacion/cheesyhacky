import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ── Spleen Bleed Overlay ───────────────────────────────────────────────────
export function SpleenBleedOverlay({
  bounds,
  resectionPct,
}: {
  bounds: THREE.Box3 | null;
  resectionPct: number;
}) {
  const sphereRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const growRef = useRef(0);
  const birthTime = useRef(performance.now());

  const PARTICLE_COUNT = 120;

  const { geo: particleGeo, velocities, maxRadius } = useMemo(() => {
    if (!bounds) return { geo: new THREE.BufferGeometry(), velocities: new Float32Array(0), maxRadius: 1 };
    const size = bounds.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.45;
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const vels = new Float32Array(PARTICLE_COUNT * 3);
    const center = bounds.getCenter(new THREE.Vector3());
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Random point inside sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const rad = Math.random() * r * 0.4;
      positions[i * 3]     = center.x + rad * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = center.y + rad * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = center.z + rad * Math.cos(phi);
      // Random outward velocity
      vels[i * 3]     = (Math.random() - 0.5) * 0.04;
      vels[i * 3 + 1] = (Math.random() - 0.5) * 0.04 - 0.01; // slight downward bias
      vels[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return { geo: g, velocities: vels, maxRadius: r };
  }, [bounds]);

  useFrame((_, delta) => {
    if (!bounds) return;

    // Grow sphere
    growRef.current = Math.min(growRef.current + delta / 2, 1);
    const size = bounds.getSize(new THREE.Vector3());
    const targetR = Math.max(size.x, size.y, size.z) * 0.45;

    if (sphereRef.current) {
      const r = targetR * growRef.current;
      sphereRef.current.scale.setScalar(r);
      const mat = sphereRef.current.material as THREE.MeshStandardMaterial;
      const t = performance.now() / 1000;
      mat.opacity = 0.12 + Math.sin(t * 1.4) * 0.04;
    }

    // Animate particles
    if (pointsRef.current && particleGeo.attributes.position) {
      const pos = particleGeo.attributes.position as THREE.BufferAttribute;
      const center = bounds.getCenter(new THREE.Vector3());
      const slowdown = resectionPct > 50 ? 0.92 : 1.0;
      const speedMult = 1 + resectionPct / 100;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        velocities[i * 3]     *= slowdown;
        velocities[i * 3 + 1] *= slowdown;
        velocities[i * 3 + 2] *= slowdown;

        pos.setX(i, pos.getX(i) + velocities[i * 3] * delta * speedMult * 60);
        pos.setY(i, pos.getY(i) + velocities[i * 3 + 1] * delta * speedMult * 60);
        pos.setZ(i, pos.getZ(i) + velocities[i * 3 + 2] * delta * speedMult * 60);

        // Reset if outside sphere
        const dx = pos.getX(i) - center.x;
        const dy = pos.getY(i) - center.y;
        const dz = pos.getZ(i) - center.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > maxRadius * growRef.current) {
          pos.setX(i, center.x + (Math.random() - 0.5) * 0.1);
          pos.setY(i, center.y + (Math.random() - 0.5) * 0.1);
          pos.setZ(i, center.z + (Math.random() - 0.5) * 0.1);
          velocities[i * 3]     = (Math.random() - 0.5) * 0.04;
          velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.04 - 0.01;
          velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
        }
      }
      pos.needsUpdate = true;
    }
  });

  if (!bounds) return null;

  const center = bounds.getCenter(new THREE.Vector3());

  return (
    <group>
      {/* Blood sphere — scale=1 → actual radius set in useFrame */}
      <mesh ref={sphereRef} position={center}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          color="#cc1a2a"
          transparent
          opacity={0.12}
          depthWrite={false}
        />
      </mesh>

      {/* Bleeding particles */}
      <points ref={pointsRef} geometry={particleGeo}>
        <pointsMaterial
          color="#ff2233"
          size={0.8}
          transparent
          opacity={0.6}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
    </group>
  );
}

// ── Lung Collapse Overlay ──────────────────────────────────────────────────
export function LungCollapseOverlay({
  bounds,
  resectionPct,
}: {
  bounds: THREE.Box3 | null;
  resectionPct: number;
}) {
  const lungRef = useRef<THREE.Mesh>(null);
  const tubeRef = useRef<THREE.Mesh>(null);
  const lungScaleRef = useRef(0.55);

  const tubeGeo = useMemo(() => new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8), []);

  useFrame((_, delta) => {
    if (!bounds) return;

    // Lerp lung scale: 0.55 (collapsed) → 1.0 (expanded) based on resectionPct
    const targetScale = 0.55 + (resectionPct / 100) * 0.45;
    lungScaleRef.current += (targetScale - lungScaleRef.current) * delta * 1.5;

    if (lungRef.current) {
      lungRef.current.scale.set(0.6, lungScaleRef.current, 0.5);
      const mat = lungRef.current.material as THREE.MeshStandardMaterial;
      const t = performance.now() / 1000;
      mat.opacity = 0.12 + Math.sin(t * 2) * 0.03;
    }

    // Chest tube: lerps inward as resection increases
    if (tubeRef.current && bounds) {
      const center = bounds.getCenter(new THREE.Vector3());
      const startX = bounds.max.x + 0.3;
      const endX = center.x;
      const tubePct = Math.min(resectionPct / 100, 1);
      tubeRef.current.position.x = startX + (endX - startX) * tubePct;
      tubeRef.current.position.y = center.y;
      tubeRef.current.position.z = center.z;
    }
  });

  if (!bounds) return null;

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.38;

  return (
    <group>
      {/* Collapsed lung ellipsoid */}
      <mesh ref={lungRef} position={center}>
        <sphereGeometry args={[r, 20, 20]} />
        <meshStandardMaterial
          color="#86efac"
          transparent
          opacity={0.15}
          depthWrite={false}
        />
      </mesh>

      {/* Chest tube */}
      <mesh
        ref={tubeRef}
        geometry={tubeGeo}
        position={[bounds.max.x + 0.3, center.y, center.z]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <meshStandardMaterial
          color="#aaaaaa"
          metalness={0.9}
          roughness={0.1}
        />
      </mesh>
    </group>
  );
}

// ── Femur Fracture Overlay ─────────────────────────────────────────────────
export function FemurFractureOverlay({
  bounds,
  resectionPct,
}: {
  bounds: THREE.Box3 | null;
  resectionPct: number;
}) {
  const rodRef = useRef<THREE.Mesh>(null);
  const rodOpacityRef = useRef(0);
  const rodCrossedThreshold = useRef(false);
  const thresholdTime = useRef(0);

  // Fracture flakes — procedurally generated once
  const flakes = useMemo(() => {
    if (!bounds) return [];
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    return Array.from({ length: 16 }, (_, i) => ({
      id: i,
      position: new THREE.Vector3(
        center.x + (Math.random() - 0.5) * size.x * 0.4,
        center.y + (Math.random() - 0.5) * size.y * 0.3,
        center.z + (Math.random() - 0.5) * size.z * 0.4,
      ),
      rotation: new THREE.Euler(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      ),
    }));
  }, [bounds]);

  // Rod geometry — height based on bounds
  const rodGeo = useMemo(() => {
    if (!bounds) return new THREE.CylinderGeometry(0.06, 0.06, 1, 12);
    const size = bounds.getSize(new THREE.Vector3());
    return new THREE.CylinderGeometry(0.06, 0.06, size.y * 0.85, 12);
  }, [bounds]);

  useFrame((_, delta) => {
    if (!bounds || !rodRef.current) return;

    const showRod = resectionPct > 35;
    if (showRod && !rodCrossedThreshold.current) {
      rodCrossedThreshold.current = true;
      thresholdTime.current = performance.now() / 1000;
    }
    if (!showRod) {
      rodCrossedThreshold.current = false;
      rodOpacityRef.current = 0;
    }

    if (showRod) {
      const elapsed = performance.now() / 1000 - thresholdTime.current;
      rodOpacityRef.current = Math.min(elapsed, 1); // fade in over 1s
    }

    const mat = rodRef.current.material as THREE.MeshStandardMaterial;
    mat.opacity = rodOpacityRef.current * 0.92;
    rodRef.current.visible = rodOpacityRef.current > 0.01;
  });

  if (!bounds) return null;

  const center = bounds.getCenter(new THREE.Vector3());

  return (
    <group>
      {/* Fracture flakes */}
      {flakes.map(flake => (
        <mesh key={flake.id} position={flake.position} rotation={flake.rotation}>
          <boxGeometry args={[0.3, 0.05, 0.2]} />
          <meshStandardMaterial
            color="#f5f0e8"
            transparent
            opacity={0.85}
            roughness={0.5}
            metalness={0.1}
          />
        </mesh>
      ))}

      {/* Titanium intramedullary rod */}
      <mesh ref={rodRef} geometry={rodGeo} position={center} visible={false}>
        <meshStandardMaterial
          color="#8899aa"
          metalness={0.95}
          roughness={0.05}
          transparent
          opacity={0}
        />
      </mesh>
    </group>
  );
}
