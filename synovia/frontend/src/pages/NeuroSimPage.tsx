import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useWebSocketFEA } from '../hooks/useWebSocketFEA';
import { STLViewer } from '../components/STLViewer';
import { RecoveryChart } from '../components/RecoveryChart';
import { uploadScan, api } from '../utils/api';
import { updateProximityAudio, stopAllAudio, resumeAudioContext } from '../utils/audio';
import type { WSStatus, NoFlyZone, ProximityAlert, UncertaintyBounds, RecoveryPoint } from '../types';

// ─── Spring configs ───────────────────────────────────────────────────────────
const spring = { type: 'spring', stiffness: 300, damping: 26 } as const;

// ─── Aurora ───────────────────────────────────────────────────────────────────
function Aurora() {
  return (
    <div className="aurora">
      <div className="aurora-blob" style={{ width: 700, height: 700, background: 'radial-gradient(circle, #312e81 0%, transparent 70%)', top: '-10%', left: '-5%', animationDuration: '22s' }} />
      <div className="aurora-blob" style={{ width: 600, height: 600, background: 'radial-gradient(circle, #0f4c5c 0%, transparent 70%)', bottom: '-5%', right: '-5%', animationDuration: '28s', animationDelay: '-8s' }} />
      <div className="aurora-blob" style={{ width: 500, height: 500, background: 'radial-gradient(circle, #1e1b4b 0%, transparent 70%)', top: '30%', right: '20%', animationDuration: '18s', animationDelay: '-4s' }} />
      <div className="aurora-blob" style={{ width: 400, height: 400, background: 'radial-gradient(circle, #134e4a 0%, transparent 70%)', bottom: '20%', left: '15%', animationDuration: '25s', animationDelay: '-12s' }} />
    </div>
  );
}

// ─── Severity helpers ─────────────────────────────────────────────────────────
const SEV: Record<string, { chip: string; dot: string }> = {
  SEVERE:   { chip: 'chip-peach',  dot: '#FDA4AF' },
  MODERATE: { chip: 'chip-amber',  dot: '#FCD34D' },
  MILD:     { chip: 'chip-teal',   dot: '#5EEAD4' },
  NONE:     { chip: 'chip-white',  dot: 'rgba(255,255,255,0.3)' },
};

function Skel({ w = '80%', h = 12 }: { w?: string; h?: number }) {
  return <div className="skeleton" style={{ width: w, height: h, marginBottom: 8 }} />;
}
function SLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{children}</div>;
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '4px 0' }}>
      <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right', lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

// ─── Uncertainty Card ─────────────────────────────────────────────────────────
function UncertaintyCard({ u }: { u: UncertaintyBounds }) {
  const riskColor = u.hallucination_risk_pct > 60 ? '#FDA4AF' : u.hallucination_risk_pct > 35 ? '#FCD34D' : '#5EEAD4';
  const confColor = u.confidence_pct > 70 ? '#5EEAD4' : u.confidence_pct > 45 ? '#FCD34D' : '#FDA4AF';
  const locked = u.confidence_pct < 40;

  return (
    <div style={{ padding: '14px 16px' }}>
      <SLabel>Epistemic Uncertainty</SLabel>

      {/* Confidence gauge */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>AI Confidence</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: confColor, letterSpacing: '-0.03em' }}>
            {u.confidence_pct.toFixed(0)}%
          </span>
        </div>
        <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 100, overflow: 'hidden' }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${u.confidence_pct}%` }}
            transition={{ duration: 0.8, ease: [0.16,1,0.3,1] }}
            style={{ height: '100%', borderRadius: 100, background: `linear-gradient(90deg, ${confColor}88, ${confColor})` }}
          />
        </div>
      </div>

      {/* Hallucination risk */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Hallucination Risk Bound</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: riskColor }}>{u.hallucination_risk_pct.toFixed(1)}%</span>
      </div>

      {/* CI */}
      <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, marginBottom: 10, fontFamily: 'monospace', fontSize: 11 }}>
        <div style={{ color: 'var(--text-dim)', marginBottom: 4 }}>95% Confidence Interval</div>
        <div style={{ color: 'var(--text-primary)' }}>
          [{u.ci_95_low.toFixed(3)}, {u.ci_95_high.toFixed(3)}] kPa
        </div>
        <div style={{ color: 'var(--text-dim)', marginTop: 4, fontSize: 10 }}>μ = {u.mu_kpa.toFixed(3)}, σ = {u.sigma_kpa.toFixed(3)}</div>
      </div>

      {/* Chebyshev formula */}
      <div style={{ padding: '8px 10px', background: 'rgba(129,140,248,0.06)', borderRadius: 10, border: '1px solid rgba(129,140,248,0.15)' }}>
        <div style={{ fontSize: 10, color: 'var(--blue)', marginBottom: 3, fontWeight: 500 }}>Chebyshev Bound</div>
        <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>{u.formula}</div>
      </div>

      {/* Lock warning */}
      {locked && (
        <motion.div
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(253,164,175,0.08)', border: '1px solid rgba(253,164,175,0.25)', borderRadius: 10 }}
        >
          <div style={{ fontSize: 11, color: '#FDA4AF', fontWeight: 600, marginBottom: 2 }}>⚠ Scalpel Locked</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Epistemic uncertainty exceeds safe threshold. Human override required.</div>
        </motion.div>
      )}
    </div>
  );
}

// ─── Deficit row ──────────────────────────────────────────────────────────────
function DeficitRow({ type, info }: { type: string; info: any }) {
  if (!info || typeof info !== 'object') return null;
  const sev = info.severity ?? 'NONE';
  const cfg = SEV[sev] ?? SEV.NONE;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, marginTop: 4, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, textTransform: 'capitalize' }}>{type}</span>
          <span className={`chip ${cfg.chip}`} style={{ padding: '1px 8px', fontSize: 10 }}>{sev}</span>
        </div>
        {info.affected && info.description && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>{info.description}</p>
        )}
        {!info.affected && <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>Not affected</p>}
      </div>
    </div>
  );
}

// ─── Proximity Alert Banner ───────────────────────────────────────────────────
function ProximityBanner({ alerts }: { alerts: ProximityAlert[] }) {
  if (alerts.length === 0) return null;
  const top = alerts[0];
  const isBreach = top.alert_level === 'breach';
  const isCrit = top.alert_level === 'critical';

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      style={{
        position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)',
        zIndex: 40, padding: '8px 20px', borderRadius: 100,
        background: isBreach ? 'rgba(255,34,68,0.15)' : isCrit ? 'rgba(255,68,68,0.10)' : 'rgba(255,140,0,0.10)',
        border: `1px solid ${isBreach ? 'rgba(255,34,68,0.5)' : isCrit ? 'rgba(255,68,68,0.35)' : 'rgba(255,140,0,0.35)'}`,
        display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: isBreach ? '0 0 30px rgba(255,34,68,0.15)' : undefined,
      }}
    >
      <motion.div
        animate={{ opacity: isBreach ? [1,0.2,1] : 1 }}
        transition={{ duration: 0.4, repeat: Infinity }}
        style={{ width: 6, height: 6, borderRadius: '50%', background: isBreach ? '#FF2244' : isCrit ? '#FF4444' : '#FF8C00' }}
      />
      <span style={{ fontSize: 12, fontWeight: 600, color: isBreach ? '#FF2244' : isCrit ? '#FF4444' : '#FF8C00' }}>
        {isBreach ? 'BREACH' : isCrit ? 'CRITICAL PROXIMITY' : 'PROXIMITY ALERT'}
      </span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {top.name} — {top.function}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {top.clearance < 0 ? `${Math.abs(top.clearance * 90).toFixed(0)}mm inside` : `${(top.clearance * 90).toFixed(0)}mm clearance`}
      </span>
    </motion.div>
  );
}

// ─── Boot lines ───────────────────────────────────────────────────────────────
const BOOT_LINES = [
  'Initializing neural imaging engine...', 'Parsing NIfTI headers...',
  'Mounting FDM elasticity solver...', 'Compiling Fresnel SSS shader...',
  'Connecting Kimi K2 Turbo...', 'Loading no-fly zone atlas...',
  'Initializing Monte Carlo uncertainty engine...', 'Ready.',
];

type Phase = 'idle' | 'booting' | 'live';

// ═════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═════════════════════════════════════════════════════════════════════════════
export function NeuroSimPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [caseId, setCaseId] = useState<string | null>(null);
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [xrayMode, setXrayMode] = useState(false);
  const [showNoFly, setShowNoFly] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [hoveredStructure, setHoveredStructure] = useState<string | null>(null);
  const [noFlyZones, setNoFlyZones] = useState<NoFlyZone[]>([]);
  const [proximityAlerts, setProximityAlerts] = useState<ProximityAlert[]>([]);
  const [lastClickCoords, setLastClickCoords] = useState<{x:number;y:number;z:number} | null>(null);
  const [activeTab, setActiveTab] = useState<'clinical' | 'uncertainty' | 'recovery'>('clinical');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bootRef = useRef<HTMLDivElement>(null);
  const alertCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { stlFiles, isPolling, selectedStructure, feaParams, updateFEAParams, selectStructure, rerunFEA, wsState } = useWebSocketFEA(caseId);

  // Pull extended data from wsState
  const uncertainty: UncertaintyBounds | null = wsState.clinicalSections.uncertainty ?? null;
  const recoveryCurve: RecoveryPoint[] | null = wsState.clinicalSections.recoveryCurve ?? null;

  // Fetch no-fly zones once
  useEffect(() => {
    api.get('/no-fly-zones').then(r => setNoFlyZones(r.data.zones)).catch(() => {});
  }, []);

  // Show panel when analysis starts
  useEffect(() => {
    if (wsState.status !== 'idle') setShowPanel(true);
  }, [wsState.status]);

  // Proximity check when hover changes
  useEffect(() => {
    if (!lastClickCoords || !showNoFly) { setProximityAlerts([]); return; }
    // Normalize click to [-1,1]
    const HALF = 90;
    const nx = Math.max(-1, Math.min(1, lastClickCoords.x / HALF));
    const ny = Math.max(-1, Math.min(1, lastClickCoords.y / HALF));
    const nz = Math.max(-1, Math.min(1, lastClickCoords.z / HALF));
    api.post('/proximity-check', { x: nx, y: ny, z: nz })
      .then(r => {
        const alerts: ProximityAlert[] = r.data.alerts;
        setProximityAlerts(alerts);
        if (audioEnabled && alerts.length > 0) {
          updateProximityAudio(alerts[0].clearance);
        } else {
          stopAllAudio();
        }
      }).catch(() => {});
  }, [lastClickCoords, showNoFly, audioEnabled]);

  // Boot sequence
  const runBootSequence = useCallback((id: string) => {
    setPhase('booting'); setBootLines([]); setCaseId(id);
    let i = 0;
    const iv = setInterval(() => {
      if (i < BOOT_LINES.length) {
        const line = BOOT_LINES[i]; if (line) setBootLines(p => [...p, line]); i++;
        if (bootRef.current) bootRef.current.scrollTop = bootRef.current.scrollHeight;
      } else { clearInterval(iv); setTimeout(() => setPhase('live'), 300); }
    }, 120);
  }, []);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return; setUploadError(null);
    const file = files[0];
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.nii') && !ext.endsWith('.nii.gz') && !ext.endsWith('.dcm') && !ext.endsWith('.dicom')) {
      setUploadError('Use .nii, .nii.gz, or .dcm'); return;
    }
    try { const r = await uploadScan(file); runBootSequence(r.case_id); }
    catch { runBootSequence('display-all'); }
  }, [runBootSequence]);

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);

  const handleStructureSelect = useCallback((structure: any, coords?: any) => {
    selectStructure(structure, coords);
    if (coords) setLastClickCoords(coords);
    setShowPanel(true);
    setActiveTab('clinical');
    if (audioEnabled) resumeAudioContext();
  }, [selectStructure, audioEnabled]);

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'x') { e.preventDefault(); setXrayMode(m => !m); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); setShowNoFly(m => !m); }
      if (e.key === 'Escape') setShowPanel(false);
    };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); stopAllAudio(); };
  }, []);

  const busy = ['connecting','solver_running','streaming'].includes(wsState.status);
  const locked = uncertainty ? uncertainty.confidence_pct < 40 : false;

  // Tab labels
  const tabCount = (tab: string) => {
    if (tab === 'uncertainty') return uncertainty ? '✓' : null;
    if (tab === 'recovery') return recoveryCurve ? '12m' : null;
    return null;
  };

  // ════════════════════════════════════════════════════════════════════
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', background: 'var(--bg)' }}>
      <Aurora />

      {/* ── IDLE ── */}
      <AnimatePresence>
        {phase === 'idle' && (
          <motion.div
            key="idle" initial={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.35 }}
            style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32 }}
            onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
          >
            <motion.div animate={{ scale: [1,1.03,1] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, rgba(94,234,212,0.2), rgba(94,234,212,0.04))', border: '1px solid rgba(94,234,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="14" stroke="rgba(94,234,212,0.35)" strokeWidth="1" />
                  <circle cx="16" cy="16" r="8"  stroke="rgba(94,234,212,0.55)" strokeWidth="1" strokeDasharray="3 2" />
                  <circle cx="16" cy="16" r="2.5" fill="rgba(94,234,212,0.9)" />
                </svg>
              </div>
            </motion.div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.04em', color: 'var(--text)', marginBottom: 6 }}>Synovia</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Neural Imaging & Surgical Intelligence — Kimi K2</div>
            </div>
            <motion.div
              animate={{ borderColor: isDragging ? 'rgba(94,234,212,0.5)' : 'rgba(255,255,255,0.10)', background: isDragging ? 'rgba(94,234,212,0.06)' : 'rgba(255,255,255,0.02)' }}
              onClick={() => fileInputRef.current?.click()}
              style={{ width: 380, padding: '32px 36px', borderRadius: 24, border: '1px dashed rgba(255,255,255,0.12)', cursor: 'pointer', textAlign: 'center', backdropFilter: 'blur(20px)' }}
            >
              <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.35 }}>⬆</div>
              <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500, marginBottom: 6 }}>Drop your scan file here</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>.nii · .nii.gz · .dcm · .dicom</div>
              {uploadError && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--peach)' }}>{uploadError}</div>}
            </motion.div>
            <input ref={fileInputRef} type="file" accept=".nii,.nii.gz,.dcm,.dicom" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
            <button onClick={() => runBootSequence('display-all')} style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-dim)', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.15)' }}>
              Use IXI648 sample scan
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── BOOT ── */}
      <AnimatePresence>
        {phase === 'booting' && (
          <motion.div key="boot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
            style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div ref={bootRef} style={{ width: 360 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 18, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 }}>Initializing</div>
              {bootLines.map((line, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.15 }}
                  style={{ fontSize: 14, color: line === 'Ready.' ? 'var(--teal)' : 'var(--text-muted)', marginBottom: 7, lineHeight: 1.4 }}>
                  {line === 'Ready.' ? '✓ ' : '· '}{line}
                </motion.div>
              ))}
              <motion.div animate={{ opacity: [1,0,1] }} transition={{ duration: 0.8, repeat: Infinity }}
                style={{ width: 2, height: 14, background: 'var(--teal)', borderRadius: 1, marginTop: 4 }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── LIVE ── */}
      {phase === 'live' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}
          style={{ position: 'absolute', inset: 0, zIndex: 10 }}
        >
          {/* Full-bleed canvas */}
          <div style={{ position: 'absolute', inset: 0 }}>
            {caseId && (
              <STLViewer
                stlFiles={stlFiles} caseId={caseId}
                selectedStructure={selectedStructure?.filename ?? null}
                onStructureSelect={handleStructureSelect}
                onHoverChange={setHoveredStructure}
                displacementField={wsState.displacementField}
                brainBounds={null}
                xrayMode={xrayMode}
                noFlyZones={showNoFly ? noFlyZones : []}
                locked={locked}
              />
            )}
            {isPolling && stlFiles.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <motion.div animate={{ opacity: [0.3,0.8,0.3] }} transition={{ duration: 2, repeat: Infinity }}
                  style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading brain structures...</motion.div>
              </div>
            )}
          </div>

          {/* ── Proximity alerts ── */}
          <AnimatePresence>
            {proximityAlerts.length > 0 && showNoFly && (
              <ProximityBanner key="alert" alerts={proximityAlerts} />
            )}
          </AnimatePresence>

          {/* ── Top left: case info ── */}
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.2 }}
            style={{ position: 'absolute', top: 16, left: 16, zIndex: 20 }}>
            <div className="card" style={{ padding: '12px 16px', minWidth: 190 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Active Case</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>IXI648 · T1 MRI</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <span className="chip chip-white" style={{ padding: '2px 8px', fontSize: 10 }}>{stlFiles.length} structures</span>
                <span className="chip chip-teal" style={{ padding: '2px 8px', fontSize: 10 }}>Kimi K2</span>
              </div>
              {selectedStructure && (
                <>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 3 }}>Selected</div>
                  <div style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 500 }}>{selectedStructure.name}</div>
                  {uncertainty && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                      <span className={`chip ${uncertainty.confidence_pct > 70 ? 'chip-teal' : uncertainty.confidence_pct > 45 ? 'chip-amber' : 'chip-peach'}`} style={{ padding: '1px 7px', fontSize: 9 }}>
                        {uncertainty.confidence_pct.toFixed(0)}% conf
                      </span>
                      {locked && <span className="chip chip-peach" style={{ padding: '1px 7px', fontSize: 9 }}>🔒 locked</span>}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>

          {/* ── Bottom dock ── */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.3 }}
            style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
            <div className="card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 100 }}>

              {/* X-ray */}
              <button onClick={() => setXrayMode(m => !m)} className={`dock-btn ${xrayMode ? 'active' : ''}`}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>
                <span>X-Ray</span>
              </button>

              {/* No-fly zones */}
              <button onClick={() => setShowNoFly(m => !m)} className={`dock-btn ${showNoFly ? 'active' : ''}`} style={showNoFly ? { background: 'rgba(255,68,68,0.12)', color: '#FF4444', borderColor: 'rgba(255,68,68,0.3)' } : {}}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M4.93 4.93l14.14 14.14"/></svg>
                <span>No-Fly</span>
              </button>

              {/* Audio */}
              <button onClick={() => { setAudioEnabled(m => !m); resumeAudioContext(); }} className={`dock-btn ${audioEnabled ? 'active' : ''}`}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                <span>Audio</span>
              </button>

              <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

              {/* Age */}
              <div className="dock-btn" style={{ flexDirection: 'row', gap: 5 }}>
                <span>Age</span>
                <input type="number" value={feaParams.patient_age} min={1} max={100}
                  onChange={e => updateFEAParams({ patient_age: parseInt(e.target.value) || 45 })}
                  style={{ width: 34, background: 'transparent', border: 'none', outline: 'none', color: 'var(--teal)', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 600, textAlign: 'center' }}
                />
              </div>

              {/* Procedure */}
              <div className="dock-btn" style={{ flexDirection: 'row', gap: 5 }}>
                <select value={feaParams.procedure_type} onChange={e => updateFEAParams({ procedure_type: e.target.value })}
                  style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-muted)', fontFamily: 'var(--font)', fontSize: 12, cursor: 'pointer' }}>
                  <option value="tumor resection">Tumor Resection</option>
                  <option value="biopsy">Biopsy</option>
                  <option value="epilepsy surgery">Epilepsy Surgery</option>
                  <option value="resection">Resection</option>
                </select>
              </div>

              {selectedStructure && (
                <button onClick={rerunFEA} disabled={busy || locked} className="dock-btn" style={{ opacity: (busy || locked) ? 0.4 : 1 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
                  <span>{locked ? 'Locked' : 'Re-run'}</span>
                </button>
              )}

              {wsState.status !== 'idle' && <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />}
              {busy && <span className="chip chip-teal"><span className="chip-dot pulse" />{wsState.status.replace('_',' ')}</span>}
              {wsState.status === 'complete' && <span className="chip chip-teal">✓ complete</span>}
              {wsState.status === 'error' && <span className="chip chip-peach">error</span>}
            </div>
          </motion.div>

          {/* ── Right panel: tabbed bento ── */}
          <AnimatePresence>
            {showPanel && wsState.status !== 'idle' && (
              <motion.div key="panel" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={spring}
                style={{ position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 20, overflowY: 'auto', padding: '16px 16px 100px', width: 320, display: 'flex', flexDirection: 'column' }}
              >
                {/* Close + tabs */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                    {(['clinical','uncertainty','recovery'] as const).map(tab => (
                      <button key={tab} onClick={() => setActiveTab(tab)}
                        style={{
                          padding: '4px 10px', borderRadius: 100, fontSize: 10, fontWeight: 500, cursor: 'pointer',
                          border: '1px solid', transition: 'all 0.15s',
                          background: activeTab === tab ? 'rgba(94,234,212,0.1)' : 'rgba(255,255,255,0.03)',
                          color: activeTab === tab ? 'var(--teal)' : 'var(--text-dim)',
                          borderColor: activeTab === tab ? 'rgba(94,234,212,0.3)' : 'rgba(255,255,255,0.08)',
                        }}>
                        {tab}{tabCount(tab) ? ` · ${tabCount(tab)}` : ''}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowPanel(false)} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 100, padding: '3px 10px', fontSize: 10, color: 'var(--text-dim)', cursor: 'pointer' }}>✕</button>
                </div>

                <LayoutGroup>

                  {/* Stress header — always shown */}
                  <motion.div layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: selectedStructure ? 10 : 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Surgical Analysis</div>
                      {busy && <span className="chip chip-teal"><span className="chip-dot pulse" />{wsState.status.replace('_',' ')}</span>}
                      {wsState.status === 'complete' && <span className="chip chip-teal">✓</span>}
                    </div>
                    {selectedStructure && <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{selectedStructure.name}</div>}
                    {wsState.maxStressKpa !== null && (
                      <div style={{ padding: '10px 12px', background: 'var(--teal-glow)', borderRadius: 12, border: '1px solid rgba(94,234,212,0.12)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Peak Von Mises Stress</span>
                        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--teal)', letterSpacing: '-0.02em' }}>
                          {wsState.maxStressKpa.toFixed(3)} <span style={{ fontSize: 11, opacity: 0.5 }}>kPa</span>
                        </span>
                      </div>
                    )}
                  </motion.div>

                  {/* CLINICAL TAB */}
                  {activeTab === 'clinical' && (
                    <>
                      {/* Removal summary */}
                      <AnimatePresence mode="popLayout">
                        {wsState.clinicalSections.removalSummary ? (
                          <motion.div key="rem" layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                            <SLabel>Resection Target</SLabel>
                            <Row label="Eloquent cortex">
                              <span style={{ color: wsState.clinicalSections.removalSummary.eloquentCortex ? 'var(--peach)' : 'var(--teal)' }}>
                                {wsState.clinicalSections.removalSummary.eloquentCortex ? 'Yes — mapping required' : 'No — clear margins'}
                              </span>
                            </Row>
                            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                              {wsState.clinicalSections.removalSummary.affectedRegions?.slice(0,4).map((r: string, i: number) => (
                                <span key={i} className="chip chip-lav" style={{ padding: '2px 9px', fontSize: 10 }}>{r}</span>
                              ))}
                            </div>
                          </motion.div>
                        ) : busy ? (
                          <motion.div key="rem-s" layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                            <SLabel>Resection Target</SLabel>
                            <Skel w="60%" /><Skel w="80%" />
                          </motion.div>
                        ) : null}
                      </AnimatePresence>

                      {/* Deficits */}
                      <AnimatePresence mode="popLayout">
                        {wsState.clinicalSections.neurologicalDeficits ? (
                          <motion.div key="def" layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                            <SLabel>Neurological Deficits</SLabel>
                            {Object.entries(wsState.clinicalSections.neurologicalDeficits).map(([k,v]) => (
                              <DeficitRow key={k} type={k} info={v} />
                            ))}
                          </motion.div>
                        ) : busy ? (
                          <motion.div key="def-s" layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                            <SLabel>Neurological Deficits</SLabel>
                            {[80,65,72,58].map((w,i) => <Skel key={i} w={`${w}%`} h={28} />)}
                          </motion.div>
                        ) : null}
                      </AnimatePresence>

                      {/* Surgical approach */}
                      <AnimatePresence mode="popLayout">
                        {wsState.clinicalSections.surgicalApproach ? (
                          <motion.div key="app" layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                            <SLabel>Surgical Approach</SLabel>
                            <Row label="Technique">{wsState.clinicalSections.surgicalApproach.recommendedApproach}</Row>
                            {wsState.clinicalSections.surgicalApproach.margins?.recommended && (
                              <Row label="Safe margin">{wsState.clinicalSections.surgicalApproach.margins.recommended}</Row>
                            )}
                            {wsState.clinicalSections.surgicalApproach.mapping?.required && (
                              <div style={{ marginTop: 8, padding: '7px 10px', background: 'rgba(129,140,248,0.08)', borderRadius: 10, border: '1px solid rgba(129,140,248,0.2)' }}>
                                <div style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 500 }}>Intraoperative Mapping Required</div>
                                {wsState.clinicalSections.surgicalApproach.mapping.reason && (
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{wsState.clinicalSections.surgicalApproach.mapping.reason}</div>
                                )}
                              </div>
                            )}
                          </motion.div>
                        ) : busy ? (
                          <motion.div key="app-s" layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                            <SLabel>Surgical Approach</SLabel>
                            <Skel w="70%" /><Skel w="50%" />
                          </motion.div>
                        ) : null}
                      </AnimatePresence>

                      {/* Risks */}
                      <AnimatePresence mode="popLayout">
                        {wsState.clinicalSections.risks ? (
                          <motion.div key="risk" layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                            <SLabel>Risk Assessment</SLabel>
                            {(Array.isArray(wsState.clinicalSections.risks) ? wsState.clinicalSections.risks.slice(0,3) : []).map((r: any, i: number) => (
                              <div key={i} style={{ padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                  <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{r.type}</span>
                                  <span style={{ fontSize: 11, color: 'var(--peach)', fontWeight: 600 }}>{r.probability}</span>
                                </div>
                                <span className={`chip ${r.reversibility === 'permanent' ? 'chip-peach' : r.reversibility?.includes('reversible') ? 'chip-amber' : 'chip-teal'}`} style={{ padding: '1px 7px', fontSize: 9 }}>{r.reversibility}</span>
                              </div>
                            ))}
                          </motion.div>
                        ) : busy ? (
                          <motion.div key="risk-s" layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                            <SLabel>Risk Assessment</SLabel>
                            <Skel w="75%" h={24} /><Skel w="60%" h={24} />
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </>
                  )}

                  {/* UNCERTAINTY TAB */}
                  {activeTab === 'uncertainty' && (
                    <AnimatePresence mode="popLayout">
                      {uncertainty ? (
                        <motion.div key="unc" layout transition={spring} className="card" style={{ marginBottom: 10 }}>
                          <UncertaintyCard u={uncertainty} />
                        </motion.div>
                      ) : (
                        <motion.div key="unc-s" layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                          <SLabel>Epistemic Uncertainty</SLabel>
                          {[50,80,60,40,70].map((w,i) => <Skel key={i} w={`${w}%`} h={i===0?32:14} />)}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  )}

                  {/* RECOVERY TAB */}
                  {activeTab === 'recovery' && (
                    <AnimatePresence mode="popLayout">
                      {recoveryCurve ? (
                        <motion.div key="rec" layout transition={spring} className="card" style={{ marginBottom: 10 }}>
                          <RecoveryChart data={recoveryCurve} structureName={selectedStructure?.name ?? ''} />
                        </motion.div>
                      ) : (
                        <motion.div key="rec-s" layout transition={spring} className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
                          <SLabel>4D Recovery Trajectory</SLabel>
                          <Skel w="100%" h={90} />
                          <div style={{ marginTop: 8 }}><Skel w="60%" /><Skel w="45%" /></div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  )}

                </LayoutGroup>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Canvas status bar ── */}
          <div className="status-bar">
            {hoveredStructure
              ? <><span style={{ color: 'var(--teal)', fontWeight: 500 }}>●</span><span style={{ color: 'var(--text-muted)' }}>{hoveredStructure}</span><span style={{ color: 'var(--text-dim)' }}>— click to analyze</span></>
              : <span>Hover to target · Click to simulate resection</span>
            }
            {showNoFly && proximityAlerts.length > 0 && (
              <span style={{ color: '#FF4444', fontWeight: 500 }}>
                ⚠ {proximityAlerts[0].name} — {(proximityAlerts[0].clearance * 90).toFixed(0)}mm
              </span>
            )}
            <span style={{ marginLeft: 'auto' }}>{stlFiles.length} structures · FDM 12³ · Monte Carlo N=40</span>
          </div>

          {/* Error toast */}
          <AnimatePresence>
            {wsState.error && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                style={{ position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 30, padding: '10px 20px', background: 'rgba(253,164,175,0.08)', border: '1px solid rgba(253,164,175,0.25)', borderRadius: 100, fontSize: 12, color: 'var(--peach)' }}>
                {wsState.error}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      <style>{`select option { background: #141414; color: rgba(255,255,255,0.8); }`}</style>
    </div>
  );
}
