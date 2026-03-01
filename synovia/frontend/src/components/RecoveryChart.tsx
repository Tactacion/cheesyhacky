import React, { useState } from 'react';
import type { RecoveryPoint } from '../types';

interface Props {
  data: RecoveryPoint[];
  structureName: string;
}

type Metric = 'function_pct' | 'stress_kpa' | 'plasticity_pct';

const METRICS: { key: Metric; label: string; color: string; unit: string }[] = [
  { key: 'function_pct',   label: 'Functional Recovery', color: '#5EEAD4', unit: '%' },
  { key: 'plasticity_pct', label: 'Neuroplasticity',     color: '#818CF8', unit: '%' },
  { key: 'stress_kpa',     label: 'Tissue Stress',       color: '#FDA4AF', unit: ' kPa' },
];

export function RecoveryChart({ data, structureName }: Props) {
  const [active, setActive] = useState<Metric>('function_pct');
  const [hovered, setHovered] = useState<number | null>(null);

  const metric = METRICS.find(m => m.key === active)!;
  const values = data.map(d => d[active] as number);
  const maxVal = Math.max(...values, 1);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || 1;

  const W = 260, H = 90, PAD = 8;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;

  // SVG polyline points
  const pts = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1)) * plotW;
    const y = PAD + plotH - ((d[active] as number - minVal) / range) * plotH;
    return `${x},${y}`;
  });
  const polyline = pts.join(' ');

  // Area fill path
  const firstX = PAD, lastX = PAD + plotW;
  const baseY = PAD + plotH;
  const area = `M${firstX},${baseY} ${pts.map(p => `L${p}`).join(' ')} L${lastX},${baseY} Z`;

  const hovPt = hovered !== null ? data[hovered] : null;

  return (
    <div style={{ padding: '14px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            4D Recovery Trajectory
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{structureName} · 12-month model</div>
        </div>
        {hovPt && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: metric.color, letterSpacing: '-0.02em' }}>
              {(hovPt[active] as number).toFixed(1)}{metric.unit}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Month {hovPt.month}</div>
          </div>
        )}
      </div>

      {/* Metric tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setActive(m.key)}
            style={{
              padding: '3px 9px', borderRadius: 100, fontSize: 10, fontWeight: 500,
              cursor: 'pointer', border: '1px solid',
              background: active === m.key ? `${m.color}22` : 'transparent',
              color: active === m.key ? m.color : 'var(--text-dim)',
              borderColor: active === m.key ? `${m.color}44` : 'rgba(255,255,255,0.08)',
              transition: 'all 0.15s',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* SVG Chart */}
      <div style={{ position: 'relative' }}>
        <svg
          width={W} height={H}
          onMouseLeave={() => setHovered(null)}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id={`grad-${active}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={metric.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={metric.color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(t => (
            <line key={t}
              x1={PAD} y1={PAD + plotH * (1 - t)}
              x2={PAD + plotW} y2={PAD + plotH * (1 - t)}
              stroke="rgba(255,255,255,0.04)" strokeWidth="1"
            />
          ))}

          {/* Area */}
          <path d={area} fill={`url(#grad-${active})`} />

          {/* Line */}
          <polyline
            points={polyline}
            fill="none"
            stroke={metric.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Hover hit zones + dots */}
          {data.map((d, i) => {
            const x = PAD + (i / (data.length - 1)) * plotW;
            const y = PAD + plotH - ((d[active] as number - minVal) / range) * plotH;
            return (
              <g key={i}>
                <rect
                  x={x - 8} y={PAD} width={16} height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHovered(i)}
                  style={{ cursor: 'crosshair' }}
                />
                {hovered === i && (
                  <>
                    <line x1={x} y1={PAD} x2={x} y2={PAD + plotH}
                      stroke={metric.color} strokeWidth="1" strokeOpacity="0.3" strokeDasharray="3 3" />
                    <circle cx={x} cy={y} r={4} fill={metric.color} />
                    <circle cx={x} cy={y} r={7} fill={metric.color} fillOpacity="0.15" />
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {/* Month labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, paddingLeft: PAD, paddingRight: PAD }}>
          {[0, 3, 6, 9, 12].map(m => (
            <span key={m} style={{ fontSize: 9, color: 'var(--text-dim)' }}>
              {m === 0 ? 'Op' : `${m}m`}
            </span>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 12, marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>At 6 months</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: metric.color }}>
            {(data[6]?.[active] as number ?? 0).toFixed(1)}{metric.unit}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>At 12 months</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: metric.color }}>
            {(data[12]?.[active] as number ?? 0).toFixed(1)}{metric.unit}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Δ Recovery</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#5EEAD4' }}>
            +{((data[12]?.function_pct ?? 0) - (data[0]?.function_pct ?? 0)).toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}
