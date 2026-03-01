import React from 'react';
import type { Vitals, Allergy } from '../data/mockPatients';

// ESI 1–5 triage levels
// 1 = Immediate (resuscitation), 2 = Emergent, 3 = Urgent, 4 = Less Urgent, 5 = Non-Urgent
export type ESILevel = 1 | 2 | 3 | 4 | 5;

interface ESIConfig {
  label: string;
  sublabel: string;
  color: string;
  bg: string;
  border: string;
}

const ESI_CONFIG: Record<ESILevel, ESIConfig> = {
  1: { label: 'ESI-1', sublabel: 'IMMEDIATE',  color: '#ff3a4c', bg: 'rgba(255,58,76,0.15)',   border: 'rgba(255,58,76,0.40)' },
  2: { label: 'ESI-2', sublabel: 'EMERGENT',   color: '#ff7c2a', bg: 'rgba(255,124,42,0.14)',  border: 'rgba(255,124,42,0.38)' },
  3: { label: 'ESI-3', sublabel: 'URGENT',     color: '#ffb020', bg: 'rgba(255,176,32,0.14)',  border: 'rgba(255,176,32,0.38)' },
  4: { label: 'ESI-4', sublabel: 'LESS URGENT', color: '#00ff88', bg: 'rgba(0,255,136,0.10)', border: 'rgba(0,255,136,0.32)' },
  5: { label: 'ESI-5', sublabel: 'NON-URGENT', color: '#7ef0ff', bg: 'rgba(126,240,255,0.10)', border: 'rgba(126,240,255,0.28)' },
};

// ─── ESI computation ─────────────────────────────────────────────────────────
export function computeESI(vitals: Vitals, allergies?: Allergy[]): ESILevel {
  // ESI-1: immediately life-threatening vitals
  if (
    vitals.spo2 < 88 ||
    vitals.heartRate > 140 ||
    vitals.bloodPressureSystolic < 70 ||
    (vitals.gcs !== undefined && vitals.gcs <= 8)
  ) return 1;

  // ESI-2: high risk / severely abnormal
  const criticalKeywords = ['penicillin', 'latex', 'contrast', 'sulfa', 'aspirin'];
  const criticalAllergy = (allergies ?? []).some(a =>
    a.severity === 'LIFE_THREATENING' ||
    criticalKeywords.some(kw => a.substance.toLowerCase().includes(kw))
  );
  if (
    vitals.spo2 < 92 ||
    vitals.heartRate > 120 ||
    vitals.bloodPressureSystolic < 90 ||
    vitals.bloodPressureSystolic > 180 ||
    vitals.temperature > 103 ||
    (vitals.gcs !== undefined && vitals.gcs <= 12) ||
    criticalAllergy
  ) return 2;

  // ESI-3: multiple resources needed / moderately abnormal
  if (
    vitals.heartRate > 100 ||
    vitals.spo2 < 95 ||
    vitals.bloodPressureSystolic < 100 ||
    vitals.temperature > 101.5 ||
    vitals.respiratoryRate > 24 ||
    (vitals.gcs !== undefined && vitals.gcs <= 14)
  ) return 3;

  // ESI-4: one resource needed / mild
  if (
    vitals.heartRate > 90 ||
    vitals.temperature > 100.4 ||
    vitals.respiratoryRate > 20
  ) return 4;

  return 5;
}

// ─── Badge component ─────────────────────────────────────────────────────────

interface TriageBadgeProps {
  level: ESILevel;
  compact?: boolean;  // small pill for top bars
}

export const TriageBadge: React.FC<TriageBadgeProps> = ({ level, compact = false }) => {
  const cfg = ESI_CONFIG[level];

  if (compact) {
    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 9999,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 700,
        color: cfg.color,
        letterSpacing: '0.08em',
        whiteSpace: 'nowrap',
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: cfg.color,
          boxShadow: `0 0 6px ${cfg.color}`,
          flexShrink: 0,
        }} />
        {cfg.label}
      </div>
    );
  }

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '8px 16px',
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 10,
      gap: 2,
      minWidth: 70,
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 20,
        fontWeight: 800,
        color: cfg.color,
        letterSpacing: '-0.02em',
        lineHeight: 1,
      }}>
        {level}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 700,
        color: cfg.color,
        opacity: 0.75,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        {cfg.sublabel}
      </span>
    </div>
  );
};
