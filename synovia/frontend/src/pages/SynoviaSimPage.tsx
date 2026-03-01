import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useWebSocketFEA } from '../hooks/useWebSocketFEA';
import { STLViewer } from '../components/STLViewer';
import type { ViewMode } from '../components/STLViewer';
import { BodySilhouette } from '../components/BodySilhouette';
import { AgentTerminal } from '../components/AgentTerminal';
import { RecoveryChart } from '../components/RecoveryChart';
import { PatientContextPanel } from '../components/PatientContextPanel';
import { uploadScan, getSegmentationStatus, api } from '../utils/api';
import { resumeAudioContext } from '../utils/audio';
import type { WSStatus, NoFlyZone, UncertaintyBounds, RecoveryPoint } from '../types';
import { MOCK_PATIENTS, searchPatients } from '../data/mockPatients';
import type { PatientData } from '../data/mockPatients';
import { computeESI, TriageBadge } from '../components/TriageBadge';

// ── Organ system registry ──────────────────────────────────────────────────
const ORGAN_SYSTEMS = [
  {
    id: 'brain',
    label: 'Brain / Cortical',
    color: '#7ef0ff',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
    params: ['Motor', 'Language', 'Cognitive'],
    E: 2000, nu: 0.45,
    outputs: ['Motor deficits', 'Recovery timeline', 'Cognitive impact'],
  },
  {
    id: 'liver',
    label: 'Liver',
    color: '#ff8c42',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2C8 2 4 5 4 9c0 5 4 8 8 13 4-5 8-8 8-13 0-4-4-7-8-7z"/>
      </svg>
    ),
    params: ['Hyperelastic', 'Highly vascularized'],
    E: 3000, nu: 0.49,
    outputs: ['Hepatic function %', 'Bleeding risk', 'Regeneration'],
  },
  {
    id: 'spleen',
    label: 'Spleen',
    color: '#c084fc',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="12" rx="7" ry="9"/>
        <path d="M5 12c0-3 2-5 7-5"/>
      </svg>
    ),
    params: ['Highly compliant', 'Rupture prone'],
    E: 800, nu: 0.48,
    outputs: ['Immune risk', 'Infection susceptibility', 'Vaccination protocol'],
  },
  {
    id: 'kidney',
    label: 'Kidney',
    color: '#fb7185',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2C8.5 2 6 5 6 9c0 5 2 8 6 13 4-5 6-8 6-13 0-4-2.5-7-6-7z"/>
      </svg>
    ),
    params: ['Stiff capsule', 'Soft parenchyma'],
    E: 4000, nu: 0.44,
    outputs: ['GFR reduction %', 'Dialysis probability', 'Function timeline'],
  },
  {
    id: 'lung',
    label: 'Lung',
    color: '#86efac',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4c0 0-4 2-4 8 0 3 2 5 4 8 2-3 4-5 4-8 0-6-4-8-4-8z"/>
        <path d="M12 4v4"/>
      </svg>
    ),
    params: ['Poroelastic', 'Pressure-sensitive'],
    E: 1200, nu: 0.40,
    outputs: ['FEV1 reduction', 'Ventilation dependency', 'O₂ saturation'],
  },
  {
    id: 'bone',
    label: 'Bone / MSK',
    color: '#fcd34d',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 3a3 3 0 0 0-3 3l-7 12a3 3 0 1 0 4 1l7-12a3 3 0 0 0-1-4z"/>
        <path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
      </svg>
    ),
    params: ['Rigid cortical', 'Porous trabecular'],
    E: 18000, nu: 0.30,
    outputs: ['Load capacity', 'Mobility impact', 'Fixation requirements'],
  },
] as const;

type OrganId = typeof ORGAN_SYSTEMS[number]['id'];

// ── Default patient (J. Martinez — original Synovia mock) ─────────────────
const DEFAULT_PATIENT = MOCK_PATIENTS['2'] ?? MOCK_PATIENTS[Object.keys(MOCK_PATIENTS)[0]!]!;

// ── Severity helpers ───────────────────────────────────────────────────────
const SEV: Record<string, { label: string; color: string }> = {
  SEVERE:   { label: 'SEVERE',   color: '#ff3a4c' },
  MODERATE: { label: 'MODERATE', color: '#ffb020' },
  MILD:     { label: 'MILD',     color: '#fcd34d' },
  NONE:     { label: 'NONE',     color: 'rgba(255,255,255,0.25)' },
};

// ── Inline panel divider ───────────────────────────────────────────────────
function PDiv() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '14px 0' }} />;
}

// ── Section header ─────────────────────────────────────────────────────────
function SectionHead({ label, accent }: { label: string; accent?: string }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: accent ?? 'rgba(255,255,255,0.35)',
      marginBottom: 10,
      fontWeight: 600,
    }}>{label}</div>
  );
}

// ── EMS Critical Summary Panel — now fully dynamic ────────────────────────
function EMSPanel({ patient, onDismiss, onPatientChange }: {
  patient: PatientData;
  onDismiss: () => void;
  onPatientChange: (p: PatientData) => void;
}) {
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<PatientData[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  const handleSearch = (q: string) => {
    setSearchQ(q);
    setSearchResults(q.trim() ? searchPatients(q) : []);
  };

  const esi = computeESI(patient.vitals, patient.allergies);

  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: 'absolute', zIndex: 50,
        top: 16, left: 16, bottom: 16,
        width: 310,
        display: 'flex', flexDirection: 'column',
        background: 'rgba(7,11,18,0.92)',
        backdropFilter: 'blur(28px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      {/* Header bar */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(0,255,136,0.04)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--acid)',
            boxShadow: '0 0 8px var(--acid)',
            animation: 'chipPulse 1.4s ease-in-out infinite',
          }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--acid)' }}>
            EMS · Critical Summary
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setShowSearch(v => !v)}
            title="Switch patient"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: showSearch ? 'var(--acid)' : 'rgba(255,255,255,0.3)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
          <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'rgba(255,255,255,0.3)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Patient search (slide-in) */}
      {showSearch && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, background: 'rgba(0,0,0,0.25)' }}>
          <input
            type="text"
            value={searchQ}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search name or MRN…"
            autoFocus
            style={{
              width: '100%', padding: '8px 10px', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(0,255,136,0.25)',
              borderRadius: 7, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
            }}
          />
          {searchResults.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {searchResults.map(p => (
                <button
                  key={p.id}
                  onClick={() => { onPatientChange(p); setShowSearch(false); setSearchQ(''); setSearchResults([]); }}
                  style={{
                    padding: '8px 10px', background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7,
                    cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,255,136,0.30)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
                >
                  <div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>{p.mrn}</div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--acid)', opacity: 0.7 }}>SELECT →</span>
                </button>
              ))}
            </div>
          )}
          {searchQ && searchResults.length === 0 && (
            <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
              No patients found
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', scrollbarWidth: 'none' }}>
        {/* Identity + ESI */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
              {patient.name}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
              DOB {patient.dob} · MRN {patient.mrn}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <span className="chip chip-ice" style={{ fontSize: 9 }}>BLD {patient.bloodType}</span>
              <span className="chip" style={{ fontSize: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: 'var(--text-muted)' }}>
                {patient.sex} · {patient.age}y
              </span>
              {patient.dnr && <span className="chip chip-red" style={{ fontSize: 9, fontWeight: 700 }}>DNR</span>}
            </div>
          </div>
          <TriageBadge level={esi} />
        </div>

        {/* Chief complaint */}
        {patient.chiefComplaint && (
          <>
            <SectionHead label="Chief Complaint" accent="rgba(255,176,32,0.55)" />
            <div style={{
              padding: '8px 11px', marginBottom: 14,
              background: 'rgba(255,176,32,0.06)', border: '1px solid rgba(255,176,32,0.18)',
              borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: 12,
              color: '#ffb020', lineHeight: 1.5,
            }}>
              {patient.chiefComplaint}
            </div>
          </>
        )}

        {/* Vitals strip */}
        <SectionHead label="Vitals" accent="rgba(0,255,136,0.45)" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, marginBottom: 14 }}>
          {[
            { l: 'HR', v: `${patient.vitals.heartRate}`, u: 'bpm', bad: patient.vitals.heartRate > 100 || patient.vitals.heartRate < 50 },
            { l: 'SpO₂', v: `${patient.vitals.spo2}`, u: '%', bad: patient.vitals.spo2 < 95 },
            { l: 'BP', v: `${patient.vitals.bloodPressureSystolic}/${patient.vitals.bloodPressureDiastolic}`, u: '', bad: patient.vitals.bloodPressureSystolic < 90 || patient.vitals.bloodPressureSystolic > 160 },
            { l: 'Temp', v: `${patient.vitals.temperature}`, u: '°F', bad: patient.vitals.temperature > 100.4 },
            { l: 'RR', v: `${patient.vitals.respiratoryRate}`, u: '/min', bad: patient.vitals.respiratoryRate > 20 },
            ...(patient.vitals.gcs !== undefined ? [{ l: 'GCS', v: `${patient.vitals.gcs}`, u: '/15', bad: patient.vitals.gcs < 14 }] : []),
          ].map(item => (
            <div key={item.l} style={{
              padding: '6px 8px',
              background: item.bad ? 'rgba(255,176,32,0.07)' : 'rgba(255,255,255,0.025)',
              border: `1px solid ${item.bad ? 'rgba(255,176,32,0.22)' : 'rgba(255,255,255,0.06)'}`,
              borderRadius: 7,
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: item.bad ? '#ffb020' : 'var(--text-dim)', letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 2 }}>{item.l}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: item.bad ? '#ffb020' : 'var(--text)', lineHeight: 1 }}>
                {item.v}<span style={{ fontSize: 9, opacity: 0.6, marginLeft: 1 }}>{item.u}</span>
              </div>
            </div>
          ))}
        </div>

        <PDiv />

        {/* Allergies */}
        <SectionHead label="Allergies" accent="#ff3a4c66" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
          {(patient.allergies ?? []).length > 0 ? (patient.allergies ?? []).map((a, i) => (
            <span key={i} className="chip chip-red" style={{ fontSize: 10 }}>{a.substance}</span>
          )) : (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>No known allergies</span>
          )}
        </div>

        {/* Medications */}
        <SectionHead label="Active Medications" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
          {(patient.medications ?? []).filter(m => m.active).map((m, i) => (
            <div key={i} style={{
              padding: '5px 10px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-muted)',
            }}>{m.name}{m.dose ? ` · ${m.dose}` : ''}</div>
          ))}
          {(patient.medications ?? []).filter(m => m.active).length === 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>None</span>
          )}
        </div>

        {/* Surgical history */}
        {(patient.surgicalHistory ?? []).length > 0 && (
          <>
            <PDiv />
            <SectionHead label="Surgical History" accent="rgba(184,164,255,0.6)" />
            {(patient.surgicalHistory ?? []).map((sh, i) => (
                <div key={i} style={{
                  padding: '10px 12px',
                  background: 'rgba(184,164,255,0.05)',
                  border: '1px solid rgba(184,164,255,0.15)',
                  borderRadius: 8, marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'rgba(184,164,255,0.9)' }}>{sh.notes}</span>
                    <span className="data-label">{sh.date}</span>
                  </div>
                  {sh.bodyPart && (
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--amber)',
                      letterSpacing: '0.06em', padding: '3px 8px',
                      background: 'rgba(255,176,32,0.08)', border: '1px solid rgba(255,176,32,0.2)', borderRadius: 4,
                    }}>
                      {sh.bodyPart}
                    </div>
                  )}
                </div>
            ))}
          </>
        )}
      </div>
    </motion.div>
  );
}

// ── Clinical results panel ─────────────────────────────────────────────────
function ClinicalResultsPanel({
  status, maxStressKpa, clinicalSections, selectedStructureName, organId, uncertaintyBounds, recoveryPoints,
}: {
  status: WSStatus;
  maxStressKpa: number | null;
  clinicalSections: Record<string, any>;
  selectedStructureName?: string;
  organId?: OrganId;
  uncertaintyBounds?: UncertaintyBounds | null;
  recoveryPoints?: RecoveryPoint[];
}) {
  const organ = ORGAN_SYSTEMS.find(o => o.id === organId);
  const hasData = Object.keys(clinicalSections ?? {}).length > 0;

  if (status === 'idle' && !hasData) {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14, textAlign: 'center',
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.14)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--acid)',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
            <line x1="12" y1="22" x2="12" y2="15.5"/>
            <polyline points="22 8.5 12 15.5 2 8.5"/>
          </svg>
        </div>
        <div>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            Select a structure
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.6 }}>
            Click any organ structure in the<br />3D viewer to run FEA analysis
          </p>
        </div>
      </div>
    );
  }

  const sevColor = (sev: string) => SEV[sev]?.color ?? 'rgba(255,255,255,0.4)';

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px' }}>
      {/* Status */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span className={`status-badge ${status}`}>
            <span className="status-dot" />
            {status === 'idle' ? 'STANDBY' :
             status === 'connecting' ? 'CONNECTING' :
             status === 'solver_running' ? 'FEA RUNNING' :
             status === 'streaming' ? 'STREAMING AI' :
             status === 'complete' ? 'COMPLETE' : 'ERROR'}
          </span>
          {organ && (
            <span className="chip" style={{ background: `${organ.color}12`, border: `1px solid ${organ.color}28`, color: organ.color, fontSize: 9 }}>
              {organ.label.toUpperCase()}
            </span>
          )}
        </div>

        {selectedStructureName && (
          <div>
            <div className="data-label" style={{ marginBottom: 3 }}>Target structure</div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ice)', fontWeight: 400 }}>
              {selectedStructureName}
            </p>
          </div>
        )}
      </div>

      {/* Stress metric */}
      {maxStressKpa !== null && (
        <div style={{
          padding: '12px 14px', marginBottom: 14,
          background: 'rgba(126,240,255,0.05)',
          border: '1px solid rgba(126,240,255,0.14)',
          borderRadius: 10,
        }}>
          <div className="data-label" style={{ marginBottom: 4 }}>Peak von Mises stress</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: 'var(--ice)', lineHeight: 1 }}>
              {maxStressKpa.toFixed(2)}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>kPa</span>
          </div>
          {uncertaintyBounds && (
            <div style={{ marginTop: 8 }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.min(100, uncertaintyBounds.confidence_pct)}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span className="data-label">Confidence</span>
                <span className="data-label" style={{ color: 'var(--acid)' }}>{uncertaintyBounds.confidence_pct.toFixed(0)}%</span>
              </div>
            </div>
          )}
        </div>
      )}

      <PDiv />

      {/* Removal summary */}
      {clinicalSections.removalSummary ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginBottom: 14 }}>
          <SectionHead label="Resection summary" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {clinicalSections.removalSummary.eloquentCortex !== undefined && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-muted)' }}>Critical tissue involved</span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  color: clinicalSections.removalSummary.eloquentCortex ? 'var(--red)' : 'var(--acid)',
                }}>
                  {clinicalSections.removalSummary.eloquentCortex ? 'YES' : 'NO'}
                </span>
              </div>
            )}
            {clinicalSections.removalSummary.affectedRegions?.slice(0, 4).map((r: string, i: number) => (
              <div key={i} style={{
                padding: '4px 10px',
                background: 'rgba(255,58,76,0.07)',
                border: '1px solid rgba(255,58,76,0.16)',
                borderRadius: 5,
                fontFamily: 'var(--font-mono)', fontSize: 10,
                color: '#ff6b7a',
              }}>{r}</div>
            ))}
          </div>
        </motion.div>
      ) : (status === 'streaming' || status === 'solver_running') && (
        <div style={{ marginBottom: 14 }}>
          <SectionHead label="Resection summary" />
          <div className="skeleton" style={{ height: 13, width: '78%', marginBottom: 6 }} />
          <div className="skeleton" style={{ height: 13, width: '60%', marginBottom: 6 }} />
          <div className="skeleton" style={{ height: 13, width: '70%' }} />
        </div>
      )}

      {/* Neurological / functional deficits */}
      {clinicalSections.neurologicalDeficits ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginBottom: 14 }}>
          <SectionHead label="Predicted deficits" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {Object.entries(clinicalSections.neurologicalDeficits).map(([type, info]: [string, any]) => {
              if (!info || typeof info !== 'object') return null;
              const sev = info.severity ?? 'NONE';
              return (
                <div key={type} style={{
                  padding: '8px 10px',
                  background: 'rgba(255,255,255,0.025)',
                  borderRadius: 7,
                  borderLeft: `2px solid ${sevColor(sev)}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      {type}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: sevColor(sev), letterSpacing: '0.06em' }}>
                      {sev}
                    </span>
                  </div>
                  {info.affected && info.description && (
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, fontWeight: 300 }}>
                      {info.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      ) : status === 'streaming' && (
        <div style={{ marginBottom: 14 }}>
          <SectionHead label="Predicted deficits" />
          <div className="skeleton" style={{ height: 52, marginBottom: 6 }} />
          <div className="skeleton" style={{ height: 52 }} />
        </div>
      )}

      {/* Surgical approach */}
      {clinicalSections.surgicalApproach && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginBottom: 14 }}>
          <SectionHead label="Surgical approach" />
          <div style={{
            padding: '10px 12px',
            background: 'rgba(184,164,255,0.05)',
            border: '1px solid rgba(184,164,255,0.14)',
            borderRadius: 8,
          }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--lavender)', marginBottom: 5 }}>
              {clinicalSections.surgicalApproach.recommendedApproach}
            </p>
            {clinicalSections.surgicalApproach.margins?.recommended && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                Margin: {clinicalSections.surgicalApproach.margins.recommended}
              </p>
            )}
            {clinicalSections.surgicalApproach.mapping?.required && (
              <span className="chip chip-amber" style={{ fontSize: 9, marginTop: 6 }}>Mapping required</span>
            )}
          </div>
        </motion.div>
      )}

      {/* Risks */}
      {clinicalSections.risks && clinicalSections.risks.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginBottom: 14 }}>
          <SectionHead label="Risk assessment" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {clinicalSections.risks.slice(0, 3).map((risk: any, i: number) => (
              <div key={i} style={{
                padding: '8px 10px',
                background: 'rgba(255,255,255,0.025)',
                borderRadius: 7,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{risk.type}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--amber)' }}>{risk.probability}</span>
                </div>
                {risk.reversibility && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9,
                    color: risk.reversibility === 'permanent' ? 'var(--red)' : 'var(--acid)',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>{risk.reversibility}</span>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Recovery */}
      {clinicalSections.recoveryPrognosis && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginBottom: 14 }}>
          <SectionHead label="Recovery prognosis" />
          {clinicalSections.recoveryPrognosis.longTermOutcome?.mostLikely && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 8, fontWeight: 300 }}>
              {clinicalSections.recoveryPrognosis.longTermOutcome.mostLikely}
            </p>
          )}
          {clinicalSections.recoveryPrognosis.neuroplasticity?.potential && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-muted)' }}>Plasticity potential</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10,
                color: clinicalSections.recoveryPrognosis.neuroplasticity.potential === 'HIGH' ? 'var(--acid)' :
                       clinicalSections.recoveryPrognosis.neuroplasticity.potential === 'MODERATE' ? 'var(--amber)' : 'var(--red)',
              }}>
                {clinicalSections.recoveryPrognosis.neuroplasticity.potential}
              </span>
            </div>
          )}
        </motion.div>
      )}

      {/* Recovery chart */}
      {recoveryPoints && recoveryPoints.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginBottom: 14 }}>
          <SectionHead label="Recovery trajectory" />
          <div style={{ height: 140 }}>
            <RecoveryChart data={recoveryPoints} />
          </div>
        </motion.div>
      )}

      {/* Recommendations */}
      {clinicalSections.recommendations && clinicalSections.recommendations.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <SectionHead label="Recommendations" accent="rgba(0,255,136,0.4)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {clinicalSections.recommendations.slice(0, 3).map((rec: string, i: number) => (
              <div key={i} style={{
                padding: '8px 10px 8px 12px',
                background: 'rgba(0,255,136,0.04)',
                border: '1px solid rgba(0,255,136,0.12)',
                borderRadius: 7,
                borderLeft: '2px solid var(--acid)',
                fontFamily: 'var(--font-body)',
                fontSize: 11, color: 'var(--text-muted)',
                lineHeight: 1.5, fontWeight: 300,
              }}>{rec}</div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ── Organ selector strip ───────────────────────────────────────────────────
function OrganStrip({
  selected, onChange,
}: { selected: OrganId | null; onChange: (id: OrganId) => void }) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '0 4px',
      overflowX: 'auto',
    }}>
      {ORGAN_SYSTEMS.map(organ => {
        const isActive = selected === organ.id;
        return (
          <button
            key={organ.id}
            onClick={() => onChange(organ.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px',
              background: isActive ? `${organ.color}18` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isActive ? organ.color + '45' : 'rgba(255,255,255,0.09)'}`,
              borderRadius: 9,
              cursor: 'pointer',
              transition: 'all 0.18s var(--ease)',
              flexShrink: 0,
              color: isActive ? organ.color : 'rgba(255,255,255,0.5)',
              boxShadow: isActive ? `0 0 18px ${organ.color}20` : 'none',
            }}
          >
            <span style={{ color: isActive ? organ.color : 'rgba(255,255,255,0.35)' }}>
              {organ.icon}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: isActive ? organ.color : 'rgba(255,255,255,0.50)',
              whiteSpace: 'nowrap',
              fontWeight: isActive ? 600 : 400,
            }}>
              {organ.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Simulation input modal ─────────────────────────────────────────────────
function SimInputModal({
  organ, onRun, onClose, defaultAge,
}: {
  organ: typeof ORGAN_SYSTEMS[number];
  onRun: (params: { patientAge: number; volumeToRemove: string; procedureType: string; reason: string }) => void;
  onClose: () => void;
  defaultAge?: number;
}) {
  const [age, setAge] = useState(defaultAge ?? 45);
  const [volume, setVolume] = useState('40%');
  const [procedure, setProcedure] = useState('resection');
  const [reason, setReason] = useState('Trauma');

  const PROCEDURES = ['resection', 'partial resection', 'biopsy', 'debulking', 'excision', 'repair'];
  const REASONS = ['Trauma', 'Tumor', 'Laceration', 'Hemorrhage', 'Abscess', 'Cyst', 'Other'];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(3,5,10,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        style={{
          width: 420,
          background: 'var(--bg-02)',
          border: `1px solid ${organ.color}28`,
          borderRadius: 18,
          overflow: 'hidden',
          boxShadow: `0 0 60px ${organ.color}12, 0 24px 80px rgba(0,0,0,0.6)`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px',
          borderBottom: `1px solid ${organ.color}18`,
          background: `${organ.color}06`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: `${organ.color}14`,
              border: `1px solid ${organ.color}28`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: organ.color,
            }}>{organ.icon}</div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                {organ.label} Simulation
              </div>
              <div className="data-label">FEA · PINNs · AI analysis</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '22px' }}>
          {/* Patient age */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <label className="data-label">Patient age</label>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: organ.color }}>{age} yrs</span>
            </div>
            <input
              type="range" min={18} max={90} value={age}
              onChange={e => setAge(+e.target.value)}
              style={{ width: '100%', accentColor: organ.color }}
            />
          </div>

          {/* Volume */}
          <div style={{ marginBottom: 18 }}>
            <label className="data-label" style={{ display: 'block', marginBottom: 8 }}>Resection volume</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {['15%', '25%', '40%', '60%', '80%'].map(v => (
                <button
                  key={v}
                  onClick={() => setVolume(v)}
                  style={{
                    padding: '5px 11px',
                    background: volume === v ? `${organ.color}18` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${volume === v ? organ.color + '40' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 6, cursor: 'pointer',
                    fontFamily: 'var(--font-mono)', fontSize: 11,
                    color: volume === v ? organ.color : 'var(--text-muted)',
                    transition: 'all 0.15s',
                  }}
                >{v}</button>
              ))}
            </div>
          </div>

          {/* Procedure */}
          <div style={{ marginBottom: 18 }}>
            <label className="data-label" style={{ display: 'block', marginBottom: 8 }}>Procedure type</label>
            <select
              value={procedure} onChange={e => setProcedure(e.target.value)}
              style={{ width: '100%', accentColor: organ.color }}
            >
              {PROCEDURES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Reason */}
          <div style={{ marginBottom: 24 }}>
            <label className="data-label" style={{ display: 'block', marginBottom: 8 }}>Indication</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  style={{
                    padding: '5px 12px',
                    background: reason === r ? `${organ.color}14` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${reason === r ? organ.color + '36' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 6, cursor: 'pointer',
                    fontFamily: 'var(--font-body)', fontSize: 12,
                    color: reason === r ? organ.color : 'var(--text-muted)',
                    transition: 'all 0.15s',
                  }}
                >{r}</button>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button
            className="btn btn-primary"
            style={{ width: '100%', background: organ.color, color: '#050510' }}
            onClick={() => onRun({ patientAge: age, volumeToRemove: volume, procedureType: procedure, reason })}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Run Synovia Simulation
          </button>

          {/* Expected outputs */}
          <div style={{ marginTop: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {organ.outputs.map(o => (
              <span key={o} className="chip" style={{
                background: `${organ.color}08`, border: `1px solid ${organ.color}1c`,
                color: organ.color, fontSize: 9, opacity: 0.75,
              }}>{o}</span>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Upload zone ────────────────────────────────────────────────────────────
function UploadZone({ onUpload, isUploading }: { onUpload: (f: File) => void; isUploading: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handle = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onUpload(files[0]);
  };

  return (
    <div
      onDragEnter={() => setDrag(true)}
      onDragLeave={() => setDrag(false)}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files); }}
      onClick={() => ref.current?.click()}
      style={{
        border: `1.5px dashed ${drag ? 'var(--acid)' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: 12,
        padding: '20px 16px',
        cursor: 'pointer',
        textAlign: 'center',
        background: drag ? 'var(--acid-glow)' : 'transparent',
        transition: 'all 0.18s var(--ease)',
      }}
    >
      <input ref={ref} type="file" accept=".nii,.nii.gz,.dcm,.gz" style={{ display: 'none' }} onChange={e => handle(e.target.files)} />
      {isUploading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 20, height: 20, border: '2px solid var(--acid)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spinSlow 0.7s linear infinite' }} />
          <span className="data-label">Processing scan…</span>
        </div>
      ) : (
        <>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" style={{ margin: '0 auto 8px' }}>
            <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
          </svg>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Drop NIfTI / DICOM<br />or click to browse
          </p>
        </>
      )}
    </div>
  );
}

// ── Organ case ID mapping ──────────────────────────────────────────────────
const ORGAN_CASE_ID: Record<string, string> = {
  liver:  'organ-liver',
  spleen: 'organ-spleen',
  kidney: 'organ-kidney',
  lung:   'organ-lung',
  bone:   'organ-bone',
};

// ── Main page ──────────────────────────────────────────────────────────────
export function SynoviaSimPage() {
  const [phase, setPhase] = useState<'body' | 'organ'>('body');
  const [caseId, setCaseId] = useState<string | null>(null);
  const [stlFiles, setStlFiles] = useState<any[]>([]);
  // Per-organ STL file cache so switching organs doesn't re-fetch unnecessarily
  const [organStlCache, setOrganStlCache] = useState<Record<string, any[]>>({});
  const [selectedStructure, setSelectedStructure] = useState<string | null>(null);
  const [selectedStructureName, setSelectedStructureName] = useState<string | undefined>();
  const [activeOrgan, setActiveOrgan] = useState<OrganId | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [showEMSPanel, setShowEMSPanel] = useState(false);
  const [xrayMode, setXrayMode] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('ER');
  const [resectionPct, setResectionPct] = useState(0);
  const [noFlyZones, setNoFlyZones] = useState<NoFlyZone[]>([]);
  const [simModal, setSimModal] = useState(false);
  const [feaParams, setFeaParams] = useState<any>(null);
  const [recoveryPoints, setRecoveryPoints] = useState<RecoveryPoint[]>([]);
  const [uncertaintyBounds, setUncertaintyBounds] = useState<UncertaintyBounds | null>(null);

  // ── Active patient — defaults to J. Martinez, switchable via EMS panel search ──
  const [patient, setPatient] = useState<PatientData>(DEFAULT_PATIENT);
  // Right panel tab: 'agent' | 'patient'
  const [rightTab, setRightTab] = useState<'agent' | 'patient'>('agent');

  const { wsState, rerunFEA, updateFEAParams: setHookFEAParams } = useWebSocketFEA(caseId);
  const { status, displacementField, maxStressKpa, bounds, clinicalSections, error } = wsState;
  // Compat shims for older call sites
  const reset = useCallback(() => {
    // wsState resets on next runWSFEA call; no explicit reset needed
  }, []);
  const runFEA = useCallback((_args: any) => {
    // Trigger rerun with current state — actual run happens via handleRunSim → rerunFEA
    rerunFEA();
  }, [rerunFEA]);


  const loadSampleCase = useCallback(async () => {
    setIsSegmenting(true);
    try {
      const res = await api.get('/stl/sample-case-001');
      if (res.data?.stl_files?.length) {
        setCaseId('sample-case-001');
        setStlFiles(res.data.stl_files);
      }
    } catch {
      // silent fail
    } finally {
      setIsSegmenting(false);
    }
  }, []);

  // Whenever active organ changes, clear then load the right STLs
  useEffect(() => {
    if (!activeOrgan) return;

    // Clear immediately so old viewer unmounts before new one mounts
    setStlFiles([]);
    setCaseId(null);
    setSelectedStructure(null);
    setSelectedStructureName(undefined);

    if (activeOrgan === 'brain') {
      loadSampleCase();
      return;
    }

    const organCaseId = ORGAN_CASE_ID[activeOrgan];
    if (!organCaseId) return;

    // Use cache if already fetched this session
    if (organStlCache[activeOrgan]) {
      setCaseId(organCaseId);
      setStlFiles(organStlCache[activeOrgan]);
      return;
    }

    setIsSegmenting(true);
    api.get(`/stl/${organCaseId}`)
      .then(res => {
        if (res.data?.stl_files?.length) {
          const files = res.data.stl_files;
          setCaseId(organCaseId);
          setStlFiles(files);
          setOrganStlCache(prev => ({ ...prev, [activeOrgan]: files }));
        }
      })
      .catch(() => {/* silent */})
      .finally(() => setIsSegmenting(false));
  }, [activeOrgan, loadSampleCase]);

  const handleUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      resumeAudioContext();
      // Pass the active organ system so the backend runs the right segmentation
      const organSystem = activeOrgan ?? 'brain';
      const res = await uploadScan(file, organSystem);
      const newCaseId = res.case_id;
      setCaseId(newCaseId);
      setStlFiles([]);
      setIsSegmenting(true);

      // Poll status then STL list — TotalSegmentator can take 1-3 min on CPU
      let tries = 0;
      const poll = async () => {
        tries++;
        try {
          const statusRes = await getSegmentationStatus(newCaseId);
          if (statusRes.status === 'ready' || statusRes.status === 'error') {
            const stlRes = await api.get(`/stl/${newCaseId}`);
            if (stlRes.data?.stl_files?.length > 0) {
              setStlFiles(stlRes.data.stl_files);
            }
            setIsSegmenting(false);
            return;
          }
        } catch { /* ignore transient errors */ }

        if (tries < 90) {  // poll up to ~3 min
          setTimeout(poll, 2000);
        } else {
          setIsSegmenting(false);
        }
      };
      setTimeout(poll, 3000);
    } catch (e) {
      console.error(e);
      setIsSegmenting(false);
    } finally {
      setIsUploading(false);
    }
  }, [activeOrgan]);

  const handleStructureSelect = useCallback((structure: any, coordinates?: { x: number; y: number; z: number }) => {
    setSelectedStructure(structure.filename);
    setSelectedStructureName(structure.name);
    reset();
    setSimModal(true);
  }, [reset]);

  const handleRunSim = useCallback((params: any) => {
    setSimModal(false);
    setFeaParams(params);
    setHookFEAParams({
      volume_to_remove: params.volumeToRemove,
      patient_age: params.patientAge,
      procedure_type: params.procedureType,
      reason: params.reason,
    });
    rerunFEA();
  }, [rerunFEA, setHookFEAParams]);

  const handleBodyOrganSelect = useCallback((id: OrganId) => {
    reset();
    setActiveOrgan(id);
    setPhase('organ');
  }, [reset]);

  const handleBackToBody = useCallback(() => {
    setPhase('body');
    setSelectedStructure(null);
    setSelectedStructureName(undefined);
  }, []);


  const activeOrganObj = ORGAN_SYSTEMS.find(o => o.id === activeOrgan);

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Background */}
      <div className="scan-grid" />

      {/* ── TOP BAR ──────────────────────────────────────────────── */}
      <div style={{
        height: 58,
        display: 'flex', alignItems: 'center',
        padding: '0 20px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(3,5,10,0.78)',
        backdropFilter: 'blur(24px)',
        zIndex: 10,
        gap: 16,
        flexShrink: 0,
      }}>
        {/* Logo */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <div style={{
            width: 32, height: 32,
            background: 'var(--acid-dim)',
            border: '1px solid var(--acid-line)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--acid)" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2l9 4.5V17L12 22 3 17V6.5L12 2z"/>
              <path d="M12 22V12M3 6.5l9 5.5 9-5.5"/>
            </svg>
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            Synovia
          </span>
        </Link>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.10)' }} />

        {/* Back button — only in organ phase */}
        {phase === 'organ' && (
          <>
            <button
              onClick={handleBackToBody}
              className="btn btn-ghost btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em' }}>Body View</span>
            </button>
            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.10)' }} />
          </>
        )}

        {/* Organ breadcrumb strip — only in organ phase */}
        {phase === 'organ' && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <OrganStrip selected={activeOrgan} onChange={id => {
              reset();
              setActiveOrgan(id);
            }} />
          </div>
        )}

        {/* Spacer in body phase */}
        {phase === 'body' && <div style={{ flex: 1 }} />}

        {/* Right tools */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* EMS / ER mode toggle */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 9, overflow: 'hidden' }}>
            <button
              onClick={() => { setViewMode('EMS'); setShowEMSPanel(true); }}
              className="btn btn-ghost btn-sm"
              style={{
                borderRadius: 0, border: 'none',
                borderRight: '1px solid rgba(255,255,255,0.09)',
                color: viewMode === 'EMS' ? '#ff3a4c' : 'rgba(255,255,255,0.50)',
                background: viewMode === 'EMS' ? 'rgba(255,58,76,0.10)' : 'transparent',
                fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em',
                padding: '8px 14px',
                display: 'flex', alignItems: 'center', gap: 7,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
              EMS
              {/* Live patient name + ESI pill */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 2 }}>
                <span style={{ fontSize: 11, color: viewMode === 'EMS' ? '#ff3a4c' : 'rgba(255,255,255,0.40)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {patient.name.split(' ')[1] ?? patient.name}
                </span>
                <TriageBadge level={computeESI(patient.vitals, patient.allergies)} compact />
              </span>
            </button>
            <button
              onClick={() => { setViewMode('ER'); setShowEMSPanel(false); }}
              className="btn btn-ghost btn-sm"
              style={{
                borderRadius: 0, border: 'none',
                color: viewMode === 'ER' ? 'var(--acid)' : 'rgba(255,255,255,0.50)',
                background: viewMode === 'ER' ? 'rgba(0,255,136,0.08)' : 'transparent',
                fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em',
                padding: '8px 14px',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
              </svg>
              ER SURGEON
            </button>
          </div>

          {/* X-ray toggle */}
          <button
            onClick={() => setXrayMode(v => !v)}
            className="btn btn-ghost btn-sm"
            style={{
              borderColor: xrayMode ? 'var(--ice-line)' : undefined,
              color: xrayMode ? 'var(--ice)' : undefined,
              fontSize: 12, padding: '8px 14px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            X-Ray
          </button>

          {/* Status indicator */}
          {status !== 'idle' && (
            <span className={`status-badge ${status}`} style={{ fontSize: 12 }}>
              <span className="status-dot" />
              {status === 'solver_running' ? 'FEA' :
               status === 'streaming' ? 'AI' :
               status === 'complete' ? 'DONE' :
               status === 'error' ? 'ERR' : (status ?? '').toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {/* ── MAIN CONTENT ──────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

        {/* EMS Panel */}
        <AnimatePresence>
          {showEMSPanel && (
            <EMSPanel
              patient={patient}
              onDismiss={() => setShowEMSPanel(false)}
              onPatientChange={p => setPatient(p)}
            />
          )}
        </AnimatePresence>

        {/* ── LEFT AREA (viewer + body silhouette) ─────────────── */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* ── BODY SILHOUETTE PHASE ─────────────────────────────── */}
        <AnimatePresence mode="wait">
          {phase === 'body' && (
            <motion.div
              key="body-phase"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              style={{ position: 'absolute', inset: 0, zIndex: 5 }}
            >
              <BodySilhouette onOrganSelect={handleBodyOrganSelect} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── MAIN VIEWER ──────────────────────────────────────── */}
        {phase === 'organ' && <div style={{ position: 'absolute', inset: 0 }}>

          {/* ── NON-BRAIN: 3D organ STL viewer (same pipeline as brain) ── */}
          {activeOrgan !== 'brain' && (<>
            {isSegmenting && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(3,5,10,0.85)', backdropFilter: 'blur(8px)', gap: 16,
              }}>
                <div style={{
                  width: 48, height: 48,
                  border: `2px solid ${activeOrganObj?.color ?? 'rgba(0,255,136,0.2)'}40`,
                  borderTopColor: activeOrganObj?.color ?? 'var(--acid)',
                  borderRadius: '50%',
                  animation: 'spinSlow 0.8s linear infinite',
                }} />
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                  Loading {activeOrganObj?.label} model…
                </p>
              </div>
            )}

            {stlFiles.length > 0 && caseId ? (
              <STLViewer
                stlFiles={stlFiles}
                caseId={caseId}
                selectedStructure={selectedStructure}
                onStructureSelect={handleStructureSelect}
                displacementField={displacementField}
                xrayMode={xrayMode}
                noFlyZones={noFlyZones}
                viewMode={viewMode}
                resectionPct={resectionPct}
                traumaOrgan={activeOrgan ?? undefined}
              />
            ) : !isSegmenting && (
              <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 24, padding: 48,
              }}>
                <div style={{
                  width: 110, height: 110,
                  background: `${activeOrganObj?.color ?? '#fff'}08`,
                  border: `1px solid ${activeOrganObj?.color ?? '#fff'}22`,
                  borderRadius: 24,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                  color: activeOrganObj?.color,
                }}>
                  {activeOrganObj?.icon}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4, fontWeight: 600 }}>
                    {activeOrganObj?.label}
                  </span>
                </div>
                <div style={{ textAlign: 'center', maxWidth: 340 }}>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                    Load a CT scan to begin
                  </p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.6 }}>
                    Upload a NIfTI CT scan — TotalSegmentator will automatically
                    segment the {activeOrganObj?.label} into clickable 3D structures.
                  </p>
                </div>
                <div style={{ width: '100%', maxWidth: 320 }}>
                  <UploadZone onUpload={handleUpload} isUploading={isUploading} />
                </div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'center' }}>
                  CT NIfTI (.nii.gz) · TotalSegmentator · marching cubes → STL
                </p>
              </div>
            )}
          </>)}

          {/* ── BRAIN: 3D STL viewer ── */}
          {activeOrgan === 'brain' && (<>
            {isSegmenting && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(3,5,10,0.85)', backdropFilter: 'blur(8px)', gap: 16,
              }}>
                <div style={{
                  width: 48, height: 48,
                  border: '2px solid rgba(0,255,136,0.2)',
                  borderTopColor: 'var(--acid)',
                  borderRadius: '50%',
                  animation: 'spinSlow 0.8s linear infinite',
                }} />
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                  Segmenting structures…
                </p>
              </div>
            )}

            {stlFiles.length > 0 && caseId ? (
              <STLViewer
                stlFiles={stlFiles}
                caseId={caseId}
                selectedStructure={selectedStructure}
                onStructureSelect={handleStructureSelect}
                displacementField={displacementField}
                xrayMode={xrayMode}
                noFlyZones={noFlyZones}
                viewMode={viewMode}
                resectionPct={resectionPct}
                traumaOrgan={activeOrgan ?? undefined}
              />
            ) : !isSegmenting && (
              <div style={{
                height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 24, padding: 48,
              }}>
                <div style={{
                  width: 160, height: 160,
                  background: 'rgba(126,240,255,0.06)',
                  border: '1px solid rgba(126,240,255,0.18)',
                  borderRadius: 28,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#7ef0ff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  </svg>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#7ef0ff', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 8, fontWeight: 600 }}>Brain / Cortical</span>
                </div>
                <div style={{ textAlign: 'center', maxWidth: 320 }}>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                    Load a scan to begin
                  </p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.6 }}>
                    Drop a NIfTI / DICOM file, or use the sample brain to explore the FEA engine.
                  </p>
                </div>
                <div style={{ width: '100%', maxWidth: 320 }}>
                  <UploadZone onUpload={handleUpload} isUploading={isUploading} />
                </div>
                <button className="btn btn-ghost btn-sm" onClick={loadSampleCase}>
                  Load sample brain
                </button>
              </div>
            )}
          </>)}

          {/* Resection slider in page — wired to STLViewer via resectionPct prop */}
          {stlFiles.length > 0 && viewMode === 'ER' && (
            <div style={{
              position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              padding: '14px 24px',
              background: 'rgba(5,8,16,0.88)',
              border: '1px solid rgba(126,240,255,0.20)',
              borderRadius: 14,
              backdropFilter: 'blur(16px)',
              minWidth: 340,
              zIndex: 5,
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'rgba(126,240,255,0.70)',
                  fontWeight: 600,
                }}>
                  Resection Volume
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700,
                  color: resectionPct > 50 ? '#ff6b7a' : resectionPct > 20 ? '#fbbf24' : '#7ef0ff',
                  transition: 'color 0.3s',
                  letterSpacing: '-0.02em',
                }}>
                  {resectionPct.toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min={0} max={100} step={1}
                value={resectionPct}
                onChange={e => setResectionPct(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#7ef0ff', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.08em' }}>CONSERVATIVE</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.08em' }}>RADICAL</span>
              </div>
            </div>
          )}
        </div>}{/* end absolute viewer */}
        </div>{/* end left flex area */}

        {/* ── RIGHT PANEL — always 340px ───────────────────────── */}
        <div style={{
          width: 340,
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(7,11,18,0.6)',
          backdropFilter: 'blur(20px)',
          flexShrink: 0,
          overflow: 'hidden',
        }}>
          {/* Tab row — Agent | Patient (always shown, patient always loaded) */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(0,0,0,0.20)',
            flexShrink: 0,
          }}>
            {(['agent', 'patient'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  background: rightTab === tab ? 'rgba(0,255,136,0.08)' : 'transparent',
                  border: 'none',
                  borderBottom: rightTab === tab ? '2px solid var(--acid)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase',
                  color: rightTab === tab ? 'var(--acid)' : 'rgba(255,255,255,0.35)',
                  fontWeight: rightTab === tab ? 700 : 500,
                  transition: 'all 0.15s ease',
                }}
              >
                {tab === 'agent' ? 'Surgical Agent' : patient.name.split(' ')[0]}
              </button>
            ))}
          </div>

          {/* Agent Terminal */}
          {rightTab === 'agent' && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <AgentTerminal
                  organId={activeOrgan}
                  phase={phase}
                  wsStatus={status}
                  maxStressKpa={maxStressKpa}
                  selectedStructureName={selectedStructureName}
                  onRunSim={() => setSimModal(true)}
                  patientContext={{
                    name: patient.name,
                    bloodType: patient.bloodType,
                    allergies: patient.allergies,
                  }}
                />
              </div>

              {/* Deep Analysis collapsible */}
              <details style={{ borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
                <summary style={{
                  padding: '12px 16px',
                  fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.10em',
                  textTransform: 'uppercase', color: 'rgba(255,255,255,0.40)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  userSelect: 'none', listStyle: 'none', fontWeight: 600,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--acid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
                  </svg>
                  Deep Analysis
                  <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>▼</span>
                </summary>
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  <ClinicalResultsPanel
                    status={status}
                    maxStressKpa={maxStressKpa}
                    clinicalSections={clinicalSections}
                    selectedStructureName={selectedStructureName}
                    organId={activeOrgan ?? undefined}
                    uncertaintyBounds={uncertaintyBounds}
                    recoveryPoints={recoveryPoints}
                  />
                </div>
              </details>

              {/* Upload zone */}
              {phase === 'organ' && (
                <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600 }}>
                      {activeOrgan === 'brain' ? 'Upload NIfTI MRI' : 'Upload NIfTI CT'}
                    </span>
                  </div>
                  <UploadZone onUpload={handleUpload} isUploading={isUploading} />
                </div>
              )}
            </div>
          )}

          {/* Patient context panel */}
          {rightTab === 'patient' && (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <PatientContextPanel patient={patient} />
            </div>
          )}
        </div>
      </div>

      {/* ── SIM INPUT MODAL ─────────────────────────────────────── */}
      <AnimatePresence>
        {simModal && activeOrganObj && (
          <SimInputModal
            organ={activeOrganObj}
            onRun={handleRunSim}
            onClose={() => setSimModal(false)}
            defaultAge={patient.age}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
