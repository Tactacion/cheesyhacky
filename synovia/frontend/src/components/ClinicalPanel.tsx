import React from 'react';
import type { WSStatus } from '../types';

interface ClinicalPanelProps {
  status: WSStatus;
  maxStressKpa: number | null;
  clinicalSections: Record<string, any>;
  selectedStructureName?: string;
}

// ── Status badge (top of panel) ───────────────────────────────────────────────
function StatusBadge({ status }: { status: WSStatus }) {
  const labels: Record<WSStatus, string> = {
    idle:           'STANDBY',
    connecting:     'CONNECTING',
    solver_running: 'FDM SOLVER RUNNING',
    streaming:      'STREAMING GEMINI',
    complete:       'ANALYSIS COMPLETE',
    error:          'ERROR',
  };
  return (
    <span className={`status-badge ${status}`}>
      <span className="status-dot" />
      {labels[status]}
    </span>
  );
}

// ── Skeleton shimmer placeholder ──────────────────────────────────────────────
function SectionSkeleton({ title }: { title: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="data-label" style={{ marginBottom: 6 }}>{title}</div>
      <div className="skeleton" style={{ height: 14, width: '80%', marginBottom: 6 }} />
      <div className="skeleton" style={{ height: 14, width: '60%', marginBottom: 6 }} />
      <div className="skeleton" style={{ height: 14, width: '70%' }} />
    </div>
  );
}

// ── Neurological deficits section ─────────────────────────────────────────────
function DeficitsSection({ data }: { data: Record<string, any> }) {
  const severityColor: Record<string, string> = {
    SEVERE:   '#FF4444',
    MODERATE: '#FF8C00',
    MILD:     '#FFD700',
    NONE:     '#6B7280',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Object.entries(data).map(([type, info]: [string, any]) => {
        if (!info || typeof info !== 'object') return null;
        const sev = info.severity ?? 'NONE';
        const affected = info.affected;
        return (
          <div key={type} style={{
            padding: '8px 10px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 6,
            borderLeft: `2px solid ${severityColor[sev] ?? '#6B7280'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <span className="data-label" style={{ color: 'var(--text-primary)', opacity: 0.7 }}>
                {type.toUpperCase()}
              </span>
              <span style={{
                fontFamily: 'var(--font-data)',
                fontSize: 9,
                color: severityColor[sev] ?? '#6B7280',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}>
                {sev}
              </span>
            </div>
            {affected && info.description && (
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                {info.description}
              </p>
            )}
            {!affected && (
              <p style={{ fontSize: 11, color: '#4B5563', margin: 0 }}>Not affected</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Risks section ─────────────────────────────────────────────────────────────
function RisksSection({ data }: { data: any[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.slice(0, 4).map((risk: any, i: number) => (
        <div key={i} style={{
          padding: '8px 10px',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: 6,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500 }}>{risk.type}</span>
            <span className="data-label" style={{ color: '#FF8C00' }}>{risk.probability}</span>
          </div>
          {risk.reversibility && (
            <span style={{
              fontSize: 9,
              fontFamily: 'var(--font-data)',
              color: risk.reversibility === 'permanent' ? '#FF4444' : '#39FF14',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              {risk.reversibility}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Surgical approach section ──────────────────────────────────────────────────
function ApproachSection({ data }: { data: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.recommendedApproach && (
        <div>
          <span className="data-label">Recommended approach</span>
          <p style={{ fontSize: 12, color: 'var(--text-primary)', margin: '4px 0 0', fontWeight: 500 }}>
            {data.recommendedApproach}
          </p>
        </div>
      )}
      {data.margins?.recommended && (
        <div>
          <span className="data-label">Resection margin</span>
          <p className="data-value" style={{ margin: '3px 0 0' }}>{data.margins.recommended}</p>
        </div>
      )}
      {data.mapping?.required && (
        <div style={{
          padding: '6px 10px',
          background: 'rgba(0,245,255,0.06)',
          borderRadius: 6,
          border: '1px solid rgba(0,245,255,0.15)',
        }}>
          <span className="data-label">Intraoperative mapping required</span>
          {data.mapping.reason && (
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '3px 0 0' }}>{data.mapping.reason}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Recovery prognosis section ────────────────────────────────────────────────
function PrognosisSection({ data }: { data: any }) {
  const potentialColor: Record<string, string> = { HIGH: '#39FF14', MODERATE: '#FFD700', LOW: '#FF4444' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.neuroplasticity && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="data-label">Neuroplasticity potential</span>
          <span className="data-value" style={{ color: potentialColor[data.neuroplasticity.potential] ?? '#E8EAF0' }}>
            {data.neuroplasticity.potential}
          </span>
        </div>
      )}
      {data.longTermOutcome?.mostLikely && (
        <div>
          <span className="data-label">Most likely outcome</span>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
            {data.longTermOutcome.mostLikely}
          </p>
        </div>
      )}
      {data.rehabilitation?.duration && (
        <div>
          <span className="data-label">Rehab duration</span>
          <p className="data-value" style={{ margin: '3px 0 0' }}>{data.rehabilitation.duration}</p>
        </div>
      )}
    </div>
  );
}

// ── Section card wrapper ───────────────────────────────────────────────────────
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="animate-fade-in-up" style={{ marginBottom: 12 }}>
      <div className="data-label" style={{ marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

// ── Removal summary section ────────────────────────────────────────────────────
function RemovalSection({ data }: { data: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.eloquentCortex !== undefined && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="data-label">Eloquent cortex involved</span>
          <span className="data-value" style={{ color: data.eloquentCortex ? '#FF4444' : '#39FF14' }}>
            {data.eloquentCortex ? 'YES' : 'NO'}
          </span>
        </div>
      )}
      {data.affectedRegions?.length > 0 && (
        <div>
          <span className="data-label">Affected regions</span>
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {data.affectedRegions.slice(0, 5).map((r: string, i: number) => (
              <span key={i} style={{
                fontSize: 10,
                fontFamily: 'var(--font-data)',
                padding: '2px 7px',
                background: 'rgba(255,107,53,0.12)',
                border: '1px solid rgba(255,107,53,0.25)',
                borderRadius: 100,
                color: '#FF8C00',
              }}>{r}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ClinicalPanel ────────────────────────────────────────────────────────
export function ClinicalPanel({ status, maxStressKpa, clinicalSections, selectedStructureName }: ClinicalPanelProps) {
  const hasAnything = Object.keys(clinicalSections).length > 0 || status !== 'idle';

  if (!hasAnything) {
    return (
      <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,245,255,0.06)', border: '1px solid rgba(0,245,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,245,255,0.5)" strokeWidth="1.5">
            <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
        </div>
        <p style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Select a brain structure<br />to run analysis
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <StatusBadge status={status} />

        {selectedStructureName && (
          <div>
            <div className="data-label">Target structure</div>
            <p style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-primary)', margin: '3px 0 0', fontWeight: 500 }}>
              {selectedStructureName}
            </p>
          </div>
        )}

        {maxStressKpa !== null && (
          <div style={{ padding: '10px 12px', background: 'rgba(0,245,255,0.04)', border: '1px solid rgba(0,245,255,0.12)', borderRadius: 8 }}>
            <div className="data-label">Peak von Mises stress</div>
            <div className="data-value-large" style={{ marginTop: 4 }}>
              {maxStressKpa.toFixed(2)}
              <span style={{ fontSize: 12, marginLeft: 4, opacity: 0.6 }}>kPa</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ height: 1, background: 'var(--border-01)', marginBottom: 16 }} />

      {/* Sections — progressive */}
      {clinicalSections.removalSummary ? (
        <SectionCard title="Removal summary">
          <RemovalSection data={clinicalSections.removalSummary} />
        </SectionCard>
      ) : (status === 'streaming' || status === 'solver_running') ? (
        <SectionSkeleton title="Removal summary" />
      ) : null}

      {clinicalSections.neurologicalDeficits ? (
        <SectionCard title="Neurological deficits">
          <DeficitsSection data={clinicalSections.neurologicalDeficits} />
        </SectionCard>
      ) : (status === 'streaming') ? (
        <SectionSkeleton title="Neurological deficits" />
      ) : null}

      {clinicalSections.surgicalApproach ? (
        <SectionCard title="Surgical approach">
          <ApproachSection data={clinicalSections.surgicalApproach} />
        </SectionCard>
      ) : (status === 'streaming') ? (
        <SectionSkeleton title="Surgical approach" />
      ) : null}

      {clinicalSections.risks ? (
        <SectionCard title="Risk assessment">
          <RisksSection data={clinicalSections.risks} />
        </SectionCard>
      ) : (status === 'streaming') ? (
        <SectionSkeleton title="Risk assessment" />
      ) : null}

      {clinicalSections.recoveryPrognosis ? (
        <SectionCard title="Recovery prognosis">
          <PrognosisSection data={clinicalSections.recoveryPrognosis} />
        </SectionCard>
      ) : (status === 'streaming') ? (
        <SectionSkeleton title="Recovery prognosis" />
      ) : null}
    </div>
  );
}
