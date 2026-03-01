import { useState, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Environment, useGLTF } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

interface HybridBodyModelProps {
  selectedBodyPart: string | null;
  onBodyPartSelect: (bodyPart: string) => void;
  patientData: Record<string, string>;
  skeletonFile?: string;
  analysisText?: string;
  highlightedParts?: string[];
}

const BODY_PARTS = [
  { id: 'head',           name: 'HEAD',        type: 'sphere',  position: [0, 2.72, 0]        as [number,number,number], args: [0.44, 16, 16] },
  { id: 'neck',           name: 'NECK',        type: 'capsule', position: [0, 2.2, 0]         as [number,number,number], args: [0.14, 0.3, 4, 8] },
  { id: 'chest',          name: 'CHEST',       type: 'capsule', position: [0, 1.25, 0]        as [number,number,number], args: [0.50, 0.8, 4, 12] },
  { id: 'heart',          name: 'HEART',       type: 'sphere',  position: [-0.16, 1.38, 0.2]  as [number,number,number], args: [0.16, 10, 10] },
  { id: 'left-lung',      name: 'L LUNG',      type: 'capsule', position: [0.34, 1.2, 0.05]   as [number,number,number], args: [0.15, 0.48, 4, 8] },
  { id: 'right-lung',     name: 'R LUNG',      type: 'capsule', position: [-0.34, 1.2, 0.05]  as [number,number,number], args: [0.15, 0.48, 4, 8] },
  { id: 'abdomen',        name: 'ABDOMEN',     type: 'capsule', position: [0, 0.0, 0]         as [number,number,number], args: [0.44, 0.65, 4, 12] },
  { id: 'stomach',        name: 'STOMACH',     type: 'sphere',  position: [-0.2, 0.15, 0.18]  as [number,number,number], args: [0.15, 8, 8] },
  { id: 'liver',          name: 'LIVER',       type: 'capsule', position: [0.28, 0.1, 0.1]    as [number,number,number], args: [0.14, 0.2, 4, 8] },
  { id: 'left-kidney',    name: 'L KIDNEY',    type: 'capsule', position: [0.24, -0.18, 0.1]  as [number,number,number], args: [0.1, 0.18, 4, 8] },
  { id: 'right-kidney',   name: 'R KIDNEY',    type: 'capsule', position: [-0.24,-0.18, 0.1]  as [number,number,number], args: [0.1, 0.18, 4, 8] },
  { id: 'left-shoulder',  name: 'L SHOULDER',  type: 'sphere',  position: [0.76, 1.82, 0]     as [number,number,number], args: [0.22, 12, 12] },
  { id: 'right-shoulder', name: 'R SHOULDER',  type: 'sphere',  position: [-0.76, 1.82, 0]    as [number,number,number], args: [0.22, 12, 12] },
  { id: 'left-arm',       name: 'L ARM',       type: 'capsule', position: [0.9, 1.05, 0]      as [number,number,number], args: [0.13, 0.85, 4, 10] },
  { id: 'right-arm',      name: 'R ARM',       type: 'capsule', position: [-0.9, 1.05, 0]     as [number,number,number], args: [0.13, 0.85, 4, 10] },
  { id: 'left-forearm',   name: 'L FOREARM',   type: 'capsule', position: [0.92, 0.12, 0]     as [number,number,number], args: [0.11, 0.78, 4, 10] },
  { id: 'right-forearm',  name: 'R FOREARM',   type: 'capsule', position: [-0.92, 0.12, 0]    as [number,number,number], args: [0.11, 0.78, 4, 10] },
  { id: 'spine',          name: 'SPINE',       type: 'capsule', position: [0, 0.85, -0.08]    as [number,number,number], args: [0.06, 2.3, 4, 8] },
  { id: 'pelvis',         name: 'PELVIS',      type: 'capsule', position: [0, -0.82, 0]       as [number,number,number], args: [0.44, 0.32, 4, 12] },
  { id: 'left-thigh',     name: 'L THIGH',     type: 'capsule', position: [0.3, -1.32, 0]     as [number,number,number], args: [0.17, 0.85, 4, 10] },
  { id: 'right-thigh',    name: 'R THIGH',     type: 'capsule', position: [-0.3, -1.32, 0]    as [number,number,number], args: [0.17, 0.85, 4, 10] },
  { id: 'left-shin',      name: 'L SHIN',      type: 'capsule', position: [0.3, -2.48, 0]     as [number,number,number], args: [0.13, 1.0, 4, 10] },
  { id: 'right-shin',     name: 'R SHIN',      type: 'capsule', position: [-0.3, -2.48, 0]    as [number,number,number], args: [0.13, 1.0, 4, 10] },
  { id: 'left-wrist',     name: 'L WRIST',     type: 'sphere',  position: [0.97, -0.38, 0]    as [number,number,number], args: [0.1, 8, 8] },
  { id: 'right-wrist',    name: 'R WRIST',     type: 'sphere',  position: [-0.97,-0.38, 0]    as [number,number,number], args: [0.1, 8, 8] },
  { id: 'left-foot',      name: 'L FOOT',      type: 'box',     position: [0.3, -3.5, 0.1]    as [number,number,number], args: [0.24, 0.13, 0.38] },
  { id: 'right-foot',     name: 'R FOOT',      type: 'box',     position: [-0.3, -3.5, 0.1]   as [number,number,number], args: [0.24, 0.13, 0.38] },
] as const;

function PartGeometry({ type, args }: { type: string; args: readonly number[] }) {
  if (type === 'sphere')  return <sphereGeometry  args={[args[0], args[1] ?? 14, args[2] ?? 14]} />;
  if (type === 'capsule') return <capsuleGeometry args={[args[0], args[1], args[2] ?? 4, args[3] ?? 10]} />;
  return <boxGeometry args={[args[0], args[1], args[2] ?? 0.4]} />;
}

function BodyPart({
  part, isSelected, isHovered, hasData, isHighlighted, onClick, onHover,
}: {
  part: (typeof BODY_PARTS)[number];
  isSelected: boolean; isHovered: boolean; hasData: boolean;
  isHighlighted: boolean; onClick: () => void; onHover: (h: boolean) => void;
}) {
  const fillRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!fillRef.current) return;
    const mat = fillRef.current.material as THREE.MeshStandardMaterial;
    const t = clock.getElapsedTime();
    if (isSelected)         mat.emissiveIntensity = 0.65 + 0.35 * Math.sin(t * 4);
    else if (isHighlighted) mat.emissiveIntensity = 0.4  + 0.2  * Math.sin(t * 3);
    else if (isHovered)     mat.emissiveIntensity = 0.3;
    else if (hasData)       mat.emissiveIntensity = 0.2;
    else                    mat.emissiveIntensity = 0;
  });

  const active = isSelected || isHighlighted || isHovered || hasData;
  const color    = isSelected ? '#22d3ee' : isHighlighted ? '#f97316' : isHovered ? '#67e8f9' : hasData ? '#f87171' : '#22d3ee';
  const emissive = isSelected ? '#0e7490' : isHighlighted ? '#c2410c' : isHovered ? '#0e7490' : hasData ? '#7f1d1d' : '#000000';
  const fillOpacity = isSelected ? 0.22 : isHighlighted ? 0.18 : isHovered ? 0.15 : hasData ? 0.12 : 0;
  const wireOpacity = isSelected ? 0.7  : isHighlighted ? 0.55 : isHovered ? 0.45 : hasData ? 0.3  : 0;

  return (
    <group>
      <mesh
        position={part.position}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(true);  document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { onHover(false); document.body.style.cursor = 'default'; }}
      >
        <PartGeometry type={part.type} args={part.args} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {active && (
        <mesh ref={fillRef} position={part.position}>
          <PartGeometry type={part.type} args={part.args} />
          <meshStandardMaterial
            color={color} emissive={emissive} emissiveIntensity={0}
            transparent opacity={fillOpacity}
            metalness={0.1} roughness={0.4}
            side={THREE.FrontSide} depthWrite={false}
          />
        </mesh>
      )}
      {active && (
        <mesh position={part.position}>
          <PartGeometry type={part.type} args={part.args} />
          <meshBasicMaterial color={color} transparent opacity={wireOpacity} wireframe depthWrite={false} />
        </mesh>
      )}
      {(isSelected || isHovered || isHighlighted) && (
        <Text
          position={[
            part.position[0] + 0.1,
            part.position[1] + (part.type === 'capsule' ? (part.args[1] as number) / 2 + 0.25 : (part.args[0] as number) + 0.25),
            part.position[2] + 0.3,
          ]}
          fontSize={0.13}
          color={isHighlighted ? '#fb923c' : '#22d3ee'}
          anchorX="left" anchorY="middle"
          renderOrder={10} depthOffset={-10}
        >
          {part.name}
        </Text>
      )}
    </group>
  );
}

function ScanLine() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (Math.sin(clock.getElapsedTime() * 0.5) + 1) / 2;
    ref.current.position.y = -4 + t * 8;
    (ref.current.material as THREE.MeshBasicMaterial).opacity =
      0.025 + 0.015 * Math.abs(Math.sin(clock.getElapsedTime() * 2));
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[4, 4]} />
      <meshBasicMaterial color="#22d3ee" transparent opacity={0.025} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function SkeletonModel({ file }: { file: string }) {
  const { scene } = useGLTF(`/blender_files/${file}`);
  useEffect(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#52c8e0'),
          emissive: new THREE.Color('#0c4a5e'),
          emissiveIntensity: 0.18,
          roughness: 0.55, metalness: 0.08,
          transparent: true, opacity: 0.88,
          side: THREE.DoubleSide,
        });
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [scene]);
  return <primitive object={scene} position={[0, -3.75, 0]} scale={[4, 4, 4]} />;
}

useGLTF.preload('/blender_files/overview-skeleton.glb');

export function HybridBodyModel({
  selectedBodyPart, onBodyPartSelect, patientData,
  skeletonFile = 'overview-skeleton.glb',
  analysisText, highlightedParts: externalHighlights = [],
}: HybridBodyModelProps) {
  const [hoveredPart, setHoveredPart] = useState<string | null>(null);
  const [localHighlights, setLocalHighlights] = useState<string[]>([]);
  const combinedHighlights = [...new Set([...externalHighlights, ...localHighlights])];

  const hasData = (id: string) => {
    const d = patientData[id];
    return typeof d === 'string' && d.trim().length > 0;
  };

  const handlePartClick = (id: string) =>
    onBodyPartSelect(selectedBodyPart === id ? '' : id);

  useEffect(() => {
    if (!analysisText?.trim()) { setLocalHighlights([]); return; }
    const text = analysisText.toLowerCase();
    const matches = BODY_PARTS
      .filter((p) => text.includes(p.id.replace(/-/g, ' ')) || text.includes(p.id))
      .map((p) => p.id);
    setLocalHighlights(matches);
  }, [analysisText]);

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-xl"
      style={{ background: 'radial-gradient(ellipse at 50% 30%, #071524 0%, #020810 100%)' }}
    >
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="absolute top-3 left-3  h-6 w-6 border-t-2 border-l-2 border-cyan-500/50" />
        <div className="absolute top-3 right-3 h-6 w-6 border-t-2 border-r-2 border-cyan-500/50" />
        <div className="absolute bottom-3 left-3  h-6 w-6 border-b-2 border-l-2 border-cyan-500/50" />
        <div className="absolute bottom-3 right-3 h-6 w-6 border-b-2 border-r-2 border-cyan-500/50" />
        <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-0.5 text-xs font-semibold tracking-widest text-cyan-400 uppercase">
          3D ANATOMY SCAN
        </div>
        {selectedBodyPart && (
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 rounded-lg border border-cyan-500/40 bg-black/70 px-4 py-2 text-sm font-bold tracking-wider text-cyan-300 uppercase backdrop-blur-sm">
            ▶ {selectedBodyPart.replace(/-/g, ' ')}
          </div>
        )}
        {combinedHighlights.length > 0 && !selectedBodyPart && (
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 rounded-lg border border-orange-500/40 bg-black/70 px-4 py-2 text-xs font-semibold text-orange-300 uppercase backdrop-blur-sm">
            {combinedHighlights.length} region{combinedHighlights.length > 1 ? 's' : ''} flagged
          </div>
        )}
      </div>
      <Canvas
        camera={{ position: [0, 0.5, 7], fov: 50 }}
        style={{ background: 'transparent' }}
        shadows
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.8 }}
      >
        <ambientLight intensity={0.25} color="#7ab8cc" />
        <directionalLight position={[3, 8, 5]}  intensity={0.9} color="#d4eaf5" castShadow />
        <directionalLight position={[-4, 3, 2]} intensity={0.4} color="#4a9ab8" />
        <pointLight position={[0, 4, 4]}  intensity={0.5} color="#22d3ee" distance={14} />
        <pointLight position={[0, -3, 3]} intensity={0.25} color="#0369a1" distance={10} />
        <directionalLight position={[0, 2, -5]} intensity={0.2} color="#0c4a6e" />
        <Suspense fallback={null}>
          <Environment preset="studio" />
          <SkeletonModel file={skeletonFile} />
          <ScanLine />
          {BODY_PARTS.map((part) => (
            <BodyPart
              key={part.id} part={part}
              isSelected={selectedBodyPart === part.id}
              isHovered={hoveredPart === part.id}
              hasData={hasData(part.id)}
              isHighlighted={combinedHighlights.includes(part.id)}
              onClick={() => handlePartClick(part.id)}
              onHover={(h) => setHoveredPart(h ? part.id : null)}
            />
          ))}
          <EffectComposer>
            <Bloom intensity={0.35} luminanceThreshold={0.6} luminanceSmoothing={0.85} mipmapBlur />
            <Vignette eskil={false} offset={0.28} darkness={0.6} />
          </EffectComposer>
        </Suspense>
        <OrbitControls
          enablePan enableZoom enableRotate
          minDistance={3} maxDistance={14}
          target={[0, 0, 0]}
          autoRotate={!selectedBodyPart && !hoveredPart}
          autoRotateSpeed={0.35}
          dampingFactor={0.06} enableDamping
        />
      </Canvas>
    </div>
  );
}
