import React from 'react';
import * as THREE from 'three';
import type { STLFileInfo } from '../types';

function getColorForIndex(index: number): string {
  const hue = (index * 137.508) % 360;
  const color = new THREE.Color().setHSL(hue / 360, 0.7, 0.55);
  return `#${color.getHexString()}`;
}

interface STLStructureListProps {
  stlFiles: STLFileInfo[];
  selectedStructure: string | null;
  onSelect: (structure: STLFileInfo) => void;
  isLoading?: boolean;
}

export const STLStructureList: React.FC<STLStructureListProps> = ({
  stlFiles,
  selectedStructure,
  onSelect,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 32, borderRadius: 6, opacity: 0.7 - i * 0.08 }} />
        ))}
      </div>
    );
  }

  if (stlFiles.length === 0) {
    return (
      <div style={{ padding: '20px 14px', textAlign: 'center' }}>
        <p className="data-label" style={{ opacity: 0.5 }}>No structures loaded</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 8px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {stlFiles.map((f, i) => {
          const isSelected = selectedStructure === f.filename;
          const dotColor = getColorForIndex(i);
          return (
            <button
              key={f.filename}
              onClick={() => onSelect(f)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '7px 10px',
                borderRadius: 6,
                border: isSelected
                  ? '1px solid rgba(0,245,255,0.3)'
                  : '1px solid transparent',
                background: isSelected
                  ? 'rgba(0,245,255,0.06)'
                  : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              onMouseEnter={(e) => {
                if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              {/* Color dot */}
              <div style={{
                width: 7, height: 7,
                borderRadius: '50%',
                background: isSelected ? 'var(--accent-cyan)' : dotColor,
                flexShrink: 0,
                boxShadow: isSelected ? `0 0 6px var(--accent-cyan)` : 'none',
                transition: 'all 0.15s',
              }} />
              {/* Name */}
              <span style={{
                fontFamily: 'var(--font-data)',
                fontSize: 11,
                color: isSelected ? 'var(--accent-cyan)' : 'var(--text-primary)',
                letterSpacing: '0.02em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {f.name}
              </span>
              {/* Selected checkmark */}
              {isSelected && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M2 5l2.5 2.5L8 3" stroke="var(--accent-cyan)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
