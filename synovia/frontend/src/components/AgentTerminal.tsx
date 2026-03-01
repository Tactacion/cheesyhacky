import React, { useState, useEffect, useRef, useCallback } from 'react';

type OrganId = 'brain' | 'liver' | 'spleen' | 'kidney' | 'lung' | 'bone';
type WSStatus = 'idle' | 'connecting' | 'solver_running' | 'streaming' | 'complete' | 'error';

export interface PatientContext {
  name: string;
  bloodType?: string;
  allergies: string[];
}

interface AgentTerminalProps {
  organId: OrganId | null;
  phase: 'body' | 'organ';
  wsStatus: WSStatus;
  maxStressKpa: number | null;
  selectedStructureName?: string;
  onRunSim: () => void;
  patientContext?: PatientContext;
}

const TERMINAL_SCRIPTS: Record<OrganId, string[]> = {
  brain: [
    'Loading patient MRI + cortical atlas overlay...',
    'Flagging eloquent cortex — speech & motor zones within 8mm of target...',
    'FEA running: computing tissue deformation under surgical retraction...',
    'AI outcome model: predicting post-op motor deficit probability → 14%',
    'Safe resection margin confirmed at 4.2mm. Proceed with caution left-lateral.',
  ],
  spleen: [
    'Analyzing injury pattern — Grade III laceration, upper pole...',
    'FEA running: modeling splenic tissue stress under hemorrhagic pressure...',
    'Bleeding rate estimated: 85 mL/min — transfusion threshold in ~6 min...',
    'Partial splenectomy sim: 40% removal preserves immune function (>200g remnant)...',
    'Recommendation: laparoscopic splenorrhaphy viable. Angioembolization as fallback.',
  ],
  lung: [
    'Detecting tension pneumothorax — mediastinal shift 11mm rightward...',
    'FEA running: modeling pleural pressure gradient at -22 cmH₂O...',
    'Chest tube insertion sim: optimal entry 5th ICS mid-axillary line...',
    'Re-expansion timeline: 70% lung volume restored within 4 min post-drain...',
    'O₂ sat projection: 94% → 98% within 8 min. No ventilator needed.',
  ],
  bone: [
    'Classifying fracture pattern: comminuted mid-shaft, 3 fragments...',
    'FEA running: mapping load-bearing stress — peak 420 MPa at fracture site...',
    'Titanium IM rod simulation: 9mm diameter, full-length fixation...',
    'Post-fixation stress map: load redistributed, peak reduced to 68 MPa...',
    'Patient can bear weight at 6 weeks. ROM recovery expected 3–4 months.',
  ],
  liver: [
    'Mapping hepatic vasculature — right portal vein 3mm from resection target...',
    'FEA running: modeling hepatic parenchyma under resection force vectors...',
    'Couinaud segment IV-B resection: 22% liver volume removal...',
    'Remnant function estimate: 78% baseline — above 60% safety threshold...',
    'Margin confirmed safe at 8mm. Intraoperative ultrasound recommended.',
  ],
  kidney: [
    'Assessing tumor proximity to collecting system — 4mm clearance...',
    'FEA running: modeling parenchymal stress during warm ischemia clamping...',
    'Partial nephrectomy sim: 18% nephron loss, GFR drop ~12 mL/min...',
    'GFR post-op projection: 71 → 59 mL/min — Stage 2 CKD, dialysis unlikely...',
    'Ischemia window: 22 min recommended. Robot-assisted approach optimal.',
  ],
};

const KANBAN_PLANS: Record<OrganId, { todo: string[]; inProgress: string[]; done: string[] }> = {
  spleen: {
    todo:       ['2 units pRBC on hold', 'Consent for OR', 'Alert interventional IR'],
    inProgress: ['FEA: bleed rate model', 'Partial splenectomy sim'],
    done:       ['Vitals stable', 'Grade III confirmed', 'IV access x2'],
  },
  lung: {
    todo:       ['Chest tube insertion', 'Supplemental O\u2082 15L', 'Repeat CXR post-drain'],
    inProgress: ['FEA: pleural pressure', 'Re-expansion timeline'],
    done:       ['Tension PTX confirmed', 'Patient intubated', 'IV access'],
  },
  bone: {
    todo:       ['Book OR — ortho', 'DVT prophylaxis', 'PT consult post-op'],
    inProgress: ['FEA: stress mapping', 'IM rod fixation sim'],
    done:       ['X-ray: 3 fragments', 'Neurovascular intact', 'Pain managed'],
  },
  brain: {
    todo:       ['Awake craniotomy prep', 'Neuromonitoring setup', 'fMRI co-registration'],
    inProgress: ['FEA: tissue deformation', 'Cortex safety margin'],
    done:       ['MRI loaded', 'Eloquent zones flagged', 'Consent signed'],
  },
  liver: {
    todo:       ['Portal vein embolization', 'Confirm margins intraop', 'ICU bed booked'],
    inProgress: ['FEA: parenchyma model', 'Vascular proximity map'],
    done:       ['Segment IV-B targeted', 'LFTs within range', 'Imaging reviewed'],
  },
  kidney: {
    todo:       ['Warm ischemia protocol', 'Urology on standby', 'Post-op nephrology'],
    inProgress: ['FEA: ischemia window', 'GFR drop projection'],
    done:       ['4mm margin confirmed', 'Baseline GFR 71', 'Robot arm positioned'],
  },
};

const ORGAN_COLOR: Record<OrganId, string> = {
  brain:  '#7ef0ff',
  liver:  '#ff8c42',
  spleen: '#c084fc',
  kidney: '#fb7185',
  lung:   '#86efac',
  bone:   '#fcd34d',
};

const ORGAN_LABEL: Record<OrganId, string> = {
  brain:  'Brain / Cortical',
  liver:  'Liver',
  spleen: 'Spleen',
  kidney: 'Kidney',
  lung:   'Lung',
  bone:   'Bone / MSK',
};

interface LogLine {
  id: number;
  text: string;
  displayText: string;
  done: boolean;
  doneMs?: number;
  isProgress?: boolean;
  progressPct?: number;
}

let lineIdCounter = 0;

function ProgressBar({ pct }: { pct: number }) {
  const filled = Math.round((pct / 100) * 8);
  const empty = 8 - filled;
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#00ff88', letterSpacing: 1 }}>
      {'█'.repeat(filled)}{'░'.repeat(empty)} {pct.toFixed(0)}%
    </span>
  );
}

// ── Kanban task chip ──────────────────────────────────────────────────────
function KanbanChip({ label, color, pulse }: { label: string; color: string; pulse?: boolean }) {
  return (
    <div style={{
      padding: '6px 10px',
      background: `${color}12`,
      border: `1px solid ${color}35`,
      borderRadius: 6,
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color,
      whiteSpace: 'nowrap',
      letterSpacing: '0.03em',
      lineHeight: 1.4,
      boxShadow: pulse ? `0 0 10px ${color}35, inset 0 0 4px ${color}10` : 'none',
      animation: pulse ? 'chipPulse 1.8s ease-in-out infinite' : 'none',
    }}>
      {label}
    </div>
  );
}

// ── Status dot ────────────────────────────────────────────────────────────
function StatusDot({ active }: { active: boolean }) {
  return (
    <div style={{
      width: 8, height: 8,
      borderRadius: '50%',
      background: active ? '#00ff88' : 'rgba(0,255,136,0.35)',
      boxShadow: active ? '0 0 12px #00ff88, 0 0 24px #00ff8844' : 'none',
      animation: active ? 'chipPulse 1.4s ease-in-out infinite' : 'none',
      flexShrink: 0,
    }} />
  );
}

// ── Main component ────────────────────────────────────────────────────────
export const AgentTerminal: React.FC<AgentTerminalProps> = ({
  organId, phase, wsStatus, maxStressKpa, onRunSim, patientContext,
}) => {
  const [lines, setLines] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const typeTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    typeTimers.current.forEach(clearTimeout);
    typeTimers.current = [];
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = null;
  }, []);

  const typewriteLine = useCallback((text: string, lineId: number, onDone?: () => void) => {
    let charIdx = 0;
    const interval = 32;

    const tick = () => {
      charIdx++;
      setLines(prev => prev.map(l =>
        l.id === lineId ? { ...l, displayText: text.slice(0, charIdx) } : l
      ));
      if (charIdx < text.length) {
        const t = setTimeout(tick, interval);
        typeTimers.current.push(t);
      } else {
        const doneMs = Math.floor(Math.random() * 36) + 4;
        setLines(prev => prev.map(l =>
          l.id === lineId ? { ...l, done: true, doneMs } : l
        ));
        onDone?.();
      }
    };
    const t = setTimeout(tick, interval);
    typeTimers.current.push(t);
  }, []);

  const startScript = useCallback((organ: OrganId) => {
    clearTimers();
    setLines([]);

    const script = TERMINAL_SCRIPTS[organ];
    let delay = 0;

    script.forEach((text) => {
      const id = ++lineIdCounter;
      const startDelay = delay;
      delay += text.length * 32 + 500;

      const t = setTimeout(() => {
        setLines(prev => [...prev, { id, text, displayText: '', done: false }]);
        typewriteLine(text, id);
      }, startDelay);
      typeTimers.current.push(t);
    });
  }, [clearTimers, typewriteLine]);

  useEffect(() => {
    if (phase === 'body') {
      clearTimers();
      const idleLine2 = patientContext
        ? `Patient: ${patientContext.name} · Select organ to begin`
        : 'Select an organ to run a patient-specific simulation.';
      setLines([
        {
          id: ++lineIdCounter,
          text: 'Synovia uses FEA + AI to simulate surgical outcomes before you cut.',
          displayText: 'Synovia uses FEA + AI to simulate surgical outcomes before you cut.',
          done: true,
          doneMs: undefined,
        },
        {
          id: ++lineIdCounter,
          text: idleLine2,
          displayText: idleLine2,
          done: false,
        },
      ]);
    }
  }, [phase, clearTimers, patientContext]);

  useEffect(() => {
    if (organId && phase === 'organ') {
      startScript(organId);
    }
  }, [organId, phase, startScript]);

  useEffect(() => {
    if (wsStatus === 'solver_running') {
      const id = ++lineIdCounter;
      setLines(prev => [...prev, {
        id, text: 'FEA solver running...', displayText: 'FEA solver running...',
        done: false, isProgress: true, progressPct: 0,
      }]);
      progressTimer.current = setInterval(() => {
        setLines(ls => ls.map(l =>
          l.isProgress && !l.done
            ? { ...l, progressPct: Math.min((l.progressPct ?? 0) + Math.random() * 8, 92) }
            : l
        ));
      }, 400);
    }

    if (wsStatus === 'complete' && maxStressKpa !== null) {
      if (progressTimer.current) { clearInterval(progressTimer.current); progressTimer.current = null; }
      setLines(prev => prev.map(l =>
        l.isProgress && !l.done ? { ...l, done: true, progressPct: 100, doneMs: 12 } : l
      ));
      const id = ++lineIdCounter;
      const resultText = `Peak von Mises: ${maxStressKpa.toFixed(1)} kPa  [\u2713 Complete]`;
      setTimeout(() => {
        setLines(prev => [...prev, { id, text: resultText, displayText: resultText, done: true, doneMs: 12 }]);
      }, 300);
    }
  }, [wsStatus, maxStressKpa]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  const kanban = organId ? KANBAN_PLANS[organId] : null;
  const organColor = organId ? ORGAN_COLOR[organId] : '#00ff88';
  const organLabel = organId ? ORGAN_LABEL[organId] : null;
  const showRunCTA = phase === 'organ' && organId !== null;
  const isActive = phase === 'organ' && organId !== null;

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(4, 7, 16, 0.97)',
      fontFamily: 'var(--font-mono)',
      overflow: 'hidden',
    }}>

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <div style={{
        padding: '14px 16px 12px',
        borderBottom: '1px solid rgba(0,255,136,0.10)',
        background: 'rgba(0,255,136,0.025)',
        flexShrink: 0,
      }}>
        {/* Top row: title + live badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <StatusDot active={isActive} />
            <span style={{
              fontSize: 13,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#00ff88',
              fontWeight: 600,
            }}>
              Synovia Agent
            </span>
            <span style={{
              fontSize: 11,
              color: 'rgba(0,255,136,0.45)',
              letterSpacing: '0.05em',
            }}>v2.4</span>
          </div>
          <span style={{
            fontSize: 10,
            letterSpacing: '0.10em',
            color: 'rgba(0,255,136,0.6)',
            padding: '3px 8px',
            border: '1px solid rgba(0,255,136,0.22)',
            borderRadius: 4,
          }}>
            LIVE
          </span>
        </div>

        {/* Organ badge + patient context row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {organLabel && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: `${organColor}12`,
              border: `1px solid ${organColor}30`,
              borderRadius: 6,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: organColor,
                boxShadow: `0 0 8px ${organColor}`,
              }} />
              <span style={{ fontSize: 12, color: organColor, letterSpacing: '0.06em', fontWeight: 600 }}>
                {organLabel.toUpperCase()}
              </span>
            </div>
          )}

          {/* Patient context pill */}
          {patientContext && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 9px',
              background: 'rgba(126,240,255,0.07)',
              border: '1px solid rgba(126,240,255,0.18)',
              borderRadius: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: '#7ef0ff',
              letterSpacing: '0.03em',
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="8" r="4"/>
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
              </svg>
              <span>{patientContext.name}</span>
              {patientContext.bloodType && (
                <>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span style={{ color: '#7ef0ff', opacity: 0.8 }}>{patientContext.bloodType}</span>
                </>
              )}
              {patientContext.allergies.length > 0 && (
                <>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span style={{ color: '#ff3a4c', fontSize: 10 }}>⚠ {patientContext.allergies.length} allergy</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── LOG PANE ────────────────────────────────────────────────── */}
      <div
        ref={logRef}
        style={{
          height: 200,
          flexShrink: 0,
          overflowY: 'auto',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          scrollbarWidth: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {lines.map(line => (
          <div key={line.id} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            lineHeight: 1.55,
          }}>
            <span style={{ color: '#00ff88', flexShrink: 0, fontSize: 14, marginTop: 1 }}>&gt;</span>
            <span style={{ color: 'rgba(220,240,220,0.92)', flex: 1, wordBreak: 'break-word', fontSize: 13 }}>
              {line.displayText}
              {!line.done && !line.isProgress && (
                <span style={{
                  display: 'inline-block',
                  width: 7, height: 14,
                  background: '#00ff88',
                  marginLeft: 2,
                  verticalAlign: 'middle',
                  animation: 'chipPulse 0.8s ease-in-out infinite',
                }} />
              )}
            </span>
            {line.isProgress && !line.done && (
              <ProgressBar pct={line.progressPct ?? 0} />
            )}
            {line.done && (
              <span style={{
                color: 'rgba(0,255,136,0.45)',
                fontSize: 11,
                flexShrink: 0,
                letterSpacing: '0.03em',
                marginTop: 2,
              }}>
                {line.isProgress ? '[\u2713]' : `[\u2713 ${line.doneMs}ms]`}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* ── SURGICAL PLAN DIVIDER ────────────────────────────────────── */}
      <div style={{
        padding: '10px 14px 8px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
        <span style={{
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.28)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>
          SURGICAL PLAN
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
      </div>

      {/* ── KANBAN BOARD ────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 12px 12px',
        scrollbarWidth: 'none',
        minHeight: 0,
      }}>
        {kanban ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>

            {/* TODO column */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.30)', marginBottom: 7, fontWeight: 700,
              }}>TODO</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {kanban.todo.map(item => (
                  <KanbanChip key={item} label={item} color={organColor} />
                ))}
              </div>
            </div>

            {/* IN PROGRESS column */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'rgba(255,176,32,0.65)', marginBottom: 7, fontWeight: 700,
              }}>ACTIVE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {kanban.inProgress.map(item => (
                  <KanbanChip key={item} label={item} color={organColor} pulse />
                ))}
              </div>
            </div>

            {/* DONE column */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'rgba(0,255,136,0.45)', marginBottom: 7, fontWeight: 700,
              }}>DONE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {kanban.done.map(item => (
                  <KanbanChip key={item} label={item} color='rgba(0,255,136,0.65)' />
                ))}
              </div>
            </div>

          </div>
        ) : (
          <div style={{
            height: 80,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.18)',
            fontSize: 13,
            letterSpacing: '0.05em',
            textAlign: 'center',
          }}>
            Select an organ<br />to load surgical plan
          </div>
        )}
      </div>

      {/* ── RUN CTA ─────────────────────────────────────────────────── */}
      {showRunCTA && (
        <div style={{
          padding: '12px 14px 14px',
          borderTop: '1px solid rgba(0,255,136,0.08)',
          flexShrink: 0,
        }}>
          <button
            onClick={onRunSim}
            style={{
              width: '100%',
              padding: '14px 0',
              background: 'linear-gradient(135deg, rgba(0,255,136,0.18) 0%, rgba(0,200,100,0.10) 100%)',
              border: '1px solid rgba(0,255,136,0.40)',
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: '#00ff88',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              transition: 'all 0.18s ease',
              boxShadow: '0 2px 16px rgba(0,255,136,0.08)',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'linear-gradient(135deg, rgba(0,255,136,0.28) 0%, rgba(0,200,100,0.18) 100%)';
              el.style.boxShadow = '0 0 24px rgba(0,255,136,0.22), 0 4px 20px rgba(0,255,136,0.12)';
              el.style.borderColor = 'rgba(0,255,136,0.60)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'linear-gradient(135deg, rgba(0,255,136,0.18) 0%, rgba(0,200,100,0.10) 100%)';
              el.style.boxShadow = '0 2px 16px rgba(0,255,136,0.08)';
              el.style.borderColor = 'rgba(0,255,136,0.40)';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Run Patient-Specific Simulation
          </button>
          <div style={{
            marginTop: 7,
            textAlign: 'center',
            fontSize: 10,
            color: 'rgba(255,255,255,0.30)',
            letterSpacing: '0.04em',
            lineHeight: 1.5,
          }}>
            Finite Element Analysis → Physics-Informed Neural Network → Gemini AI clinical reasoning
          </div>
        </div>
      )}
    </div>
  );
};
