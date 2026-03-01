import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { NoFlyZone } from '../types';

interface Props {
  zones: NoFlyZone[];
  visible: boolean;
  scalpelPos?: [number, number, number] | null;
  brainBounds: THREE.Box3 | null;
}

// Convert normalized [-1,1] zone center to anatomical mm space
function normToAnat(norm: [number, number, number], bounds: THREE.Box3): THREE.Vector3 {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) / 2;
  return new THREE.Vector3(
    center.x + norm[0] * maxDim,
    center.y + norm[1] * maxDim,
    center.z + norm[2] * maxDim,
  );
}

function ZoneSphere({ zone, brainBounds, scalpelPos }: {
  zone: NoFlyZone;
  brainBounds: THREE.Box3;
  scalpelPos?: [number, number, number] | null;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  const worldPos = normToAnat(zone.center, brainBounds);
  const size = brainBounds.getSize(new THREE.Vector3());
  const scale = Math.max(size.x, size.y, size.z) / 2;
  const worldRadius = zone.radius * scale;

  const sevColor = zone.severity === 'fatal' ? '#FF2244' : zone.severity === 'critical' ? '#FF4444' : '#FF8C00';

  useFrame(({ clock }) => {
    if (!matRef.current) return;
    const t = clock.elapsedTime;

    let proximity = 1.0;
    if (scalpelPos) {
      const dist = new THREE.Vector3(...scalpelPos).distanceTo(worldPos);
      proximity = Math.max(0, 1 - dist / (worldRadius * 2.5));
    }

    // Pulse opacity — faster and brighter when scalpel is near
    const pulse = 0.08 + proximity * 0.25 + Math.sin(t * (2 + proximity * 4)) * (0.04 + proximity * 0.08);
    matRef.current.opacity = pulse;
  });

  return (
    <mesh ref={meshRef} position={worldPos.toArray()}>
      <sphereGeometry args={[worldRadius, 16, 16]} />
      <meshBasicMaterial
        ref={matRef}
        color={sevColor}
        transparent
        opacity={0.12}
        depthWrite={false}
        side={THREE.DoubleSide}
        wireframe={false}
      />
    </mesh>
  );
}

export function NoFlyZoneOverlay({ zones, visible, scalpelPos, brainBounds }: Props) {
  if (!visible || !brainBounds || zones.length === 0) return null;

  return (
    <>
      {zones.map(zone => (
        <ZoneSphere
          key={zone.id}
          zone={zone}
          brainBounds={brainBounds}
          scalpelPos={scalpelPos}
        />
      ))}
    </>
  );
}
