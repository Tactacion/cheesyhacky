import React, { useState } from 'react';

type OrganId = 'brain' | 'liver' | 'spleen' | 'kidney' | 'lung' | 'bone';

interface BodySilhouetteProps {
  onOrganSelect: (id: OrganId) => void;
}

// Hotspot positions as % of image dimensions (3029 x 2693)
// Tuned to the actual organ locations in the Internal_organs.png
const HOTSPOTS: {
  id: OrganId; label: string; color: string;
  x: number; y: number; // percent of container
}[] = [
  { id: 'brain',  label: 'Brain',    color: '#7ef0ff', x: 55,  y: 10  },
  { id: 'lung',   label: 'Lungs',    color: '#86efac', x: 58,  y: 28  },
  { id: 'liver',  label: 'Liver',    color: '#ff8c42', x: 38,  y: 42  },
  { id: 'spleen', label: 'Spleen',   color: '#c084fc', x: 63,  y: 38  },
  { id: 'kidney', label: 'Kidneys',  color: '#fb7185', x: 38,  y: 54  },
  { id: 'bone',   label: 'Skeleton', color: '#fcd34d', x: 30,  y: 62  },
];

export function BodySilhouette({ onOrganSelect }: BodySilhouetteProps) {
  const [hovered, setHovered] = useState<OrganId | null>(null);

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative',
    }}>
      {/* Glow behind hovered organ */}
      {hovered && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse 40% 50% at 50% 42%, ${HOTSPOTS.find(h=>h.id===hovered)?.color}18 0%, transparent 70%)`,
          transition: 'background 0.3s ease',
        }} />
      )}

      {/* Image + hotspot container */}
      <div style={{ position: 'relative', height: '92%', aspectRatio: '3029/2693' }}>

        {/* The real anatomy image — white bg stripped with mix-blend-mode */}
        <img
          src="/assets/anatomy_body.png"
          alt="Human anatomy"
          style={{
            width: '100%', height: '100%',
            objectFit: 'contain',
            mixBlendMode: 'luminosity',
            filter: 'invert(1) hue-rotate(180deg) saturate(1.4) brightness(0.9)',
            borderRadius: 8,
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />

        {/* Clickable hotspot dots */}
        {HOTSPOTS.map(spot => {
          const isHov = hovered === spot.id;
          return (
            <div
              key={spot.id}
              onMouseEnter={() => setHovered(spot.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onOrganSelect(spot.id)}
              style={{
                position: 'absolute',
                left: `${spot.x}%`,
                top: `${spot.y}%`,
                transform: 'translate(-50%, -50%)',
                cursor: 'pointer',
                zIndex: 10,
              }}
            >
              {/* Pulse ring */}
              <div style={{
                position: 'absolute',
                width: isHov ? 36 : 24,
                height: isHov ? 36 : 24,
                borderRadius: '50%',
                border: `1.5px solid ${spot.color}`,
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                opacity: isHov ? 0.6 : 0.3,
                transition: 'all 0.2s ease',
                animation: 'pulse-ring 2s ease-out infinite',
              }} />
              {/* Core dot */}
              <div style={{
                width: isHov ? 14 : 10,
                height: isHov ? 14 : 10,
                borderRadius: '50%',
                background: spot.color,
                boxShadow: `0 0 ${isHov ? 14 : 6}px ${spot.color}`,
                transition: 'all 0.2s ease',
              }} />
              {/* Label */}
              <div style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: `translate(14px, -50%)`,
                background: 'rgba(3,8,20,0.92)',
                border: `1px solid ${spot.color}${isHov ? 'cc' : '55'}`,
                borderRadius: 5,
                padding: '3px 10px',
                fontFamily: 'Space Mono, monospace',
                fontSize: 10,
                fontWeight: 700,
                color: spot.color,
                letterSpacing: '0.1em',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                opacity: isHov ? 1 : 0.7,
                boxShadow: isHov ? `0 0 10px ${spot.color}44` : 'none',
                transition: 'all 0.2s ease',
              }}>
                {spot.label.toUpperCase()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom hint */}
      <div style={{
        position: 'absolute', bottom: 12, left: 0, right: 0,
        textAlign: 'center',
        fontFamily: 'Space Mono, monospace',
        fontSize: 9, letterSpacing: '0.15em',
        color: 'rgba(100,180,255,0.35)',
        pointerEvents: 'none',
      }}>
        CLICK AN ORGAN TO SIMULATE
      </div>
    </div>
  );
}
