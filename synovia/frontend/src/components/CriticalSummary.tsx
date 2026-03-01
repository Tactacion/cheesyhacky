import React from 'react';
import type { PatientData } from '../data/mockPatients';
import { analyzeInjury } from '../utils/injuryAnalyzer';
import type { InjuryFlag } from '../utils/injuryAnalyzer';

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3a4c',
  warning:  '#ffb020',
  info:     '#7ef0ff',
};

const SEV_BG: Record<string, string> = {
  critical: 'rgba(255,58,76,0.08)',
  warning:  'rgba(255,176,32,0.08)',
  info:     'rgba(126,240,255,0.06)',
};

const SEV_BORDER: Record<string, string> = {
  critical: 'rgba(255,58,76,0.28)',
  warning:  'rgba(255,176,32,0.28)',
  info:     'rgba(126,240,255,0.20)',
};

const SEV_ICON: Record<string, React.ReactNode> = {
  critical: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
    </svg>
  ),
  warning: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z"/>
    </svg>
  ),
  info: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" opacity="0.3"/>
      <path d="M12 8h.01M11 12h1v4h1"/>
    </svg>
  ),
};

function FlagRow({ flag }: { flag: InjuryFlag }) {
  const color = SEV_COLOR[flag.severity];
  return (
    <div style={{
      padding: '8px 12px',
      background: SEV_BG[flag.severity],
      border: `1px solid ${SEV_BORDER[flag.severity]}`,
      borderRadius: 8,
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <span style={{ color, flexShrink: 0, marginTop: 1 }}>
        {SEV_ICON[flag.severity]}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          fontWeight: 700,
          color,
          marginBottom: 2,
          letterSpacing: '0.04em',
        }}>
          {flag.label}
        </div>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.45,
        }}>
          {flag.detail}
        </div>
      </div>
    </div>
  );
}

interface CriticalSummaryProps {
  patient: PatientData;
}

export const CriticalSummary: React.FC<CriticalSummaryProps> = ({ patient }) => {
  const analysis = analyzeInjury(patient);
  const topFlags = analysis.flags.slice(0, 5);

  const riskColor =
    analysis.riskScore >= 75 ? '#ff3a4c' :
    analysis.riskScore >= 40 ? '#ffb020' :
    '#00ff88';

  return (
    <div style={{
      padding: 16,
      background: 'rgba(7,11,18,0.80)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: riskColor,
            boxShadow: `0 0 8px ${riskColor}`,
            animation: analysis.riskScore >= 75 ? 'chipPulse 1.4s ease-in-out infinite' : 'none',
          }} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.45)',
            fontWeight: 700,
          }}>
            Critical Summary
          </span>
        </div>
        {/* Risk score */}
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
          padding: '3px 10px',
          background: `${riskColor}12`,
          border: `1px solid ${riskColor}35`,
          borderRadius: 9999,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 16,
            fontWeight: 800,
            color: riskColor,
            lineHeight: 1,
          }}>
            {analysis.riskScore}
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: riskColor,
            opacity: 0.7,
            letterSpacing: '0.06em',
          }}>
            /100
          </span>
        </div>
      </div>

      {/* Summary text */}
      <p style={{
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        color: 'var(--text-muted)',
        lineHeight: 1.55,
        margin: 0,
        padding: '8px 12px',
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8,
      }}>
        {analysis.summary}
      </p>

      {/* Flags */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {topFlags.map(flag => (
          <FlagRow key={flag.id} flag={flag} />
        ))}
      </div>

      {/* Recommended organ */}
      {analysis.recommendedOrgan && (
        <div style={{
          padding: '7px 12px',
          background: 'rgba(0,255,136,0.05)',
          border: '1px solid rgba(0,255,136,0.18)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--acid)" strokeWidth="2" strokeLinecap="round">
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
          </svg>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--acid)',
            letterSpacing: '0.06em',
          }}>
            Suggested sim: {analysis.recommendedOrgan.toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );
};
