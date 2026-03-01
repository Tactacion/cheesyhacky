import React from 'react';
import type { PatientData, Vitals } from '../data/mockPatients';
import { computeESI, TriageBadge } from './TriageBadge';

// ─── Vital row ────────────────────────────────────────────────────────────────

interface VitalRowProps {
  label: string;
  value: string;
  unit: string;
  isAbnormal?: boolean;
}

function VitalRow({ label, value, unit, isAbnormal }: VitalRowProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      padding: '9px 10px',
      background: isAbnormal ? 'rgba(255,176,32,0.07)' : 'rgba(255,255,255,0.025)',
      border: `1px solid ${isAbnormal ? 'rgba(255,176,32,0.22)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 8,
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: isAbnormal ? '#ffb020' : 'var(--text-dim)',
        fontWeight: 600,
      }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 18,
          fontWeight: 700,
          color: isAbnormal ? '#ffb020' : 'var(--text)',
          lineHeight: 1,
        }}>
          {value}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-dim)',
          letterSpacing: '0.04em',
        }}>
          {unit}
        </span>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isAbnormalHR(hr: number) { return hr < 50 || hr > 100; }
function isAbnormalBP(sys: number) { return sys < 90 || sys > 160; }
function isAbnormalSpo2(s: number) { return s < 95; }
function isAbnormalTemp(t: number) { return t < 97 || t > 100.4; }
function isAbnormalRR(rr: number)  { return rr < 12 || rr > 20; }

// ─── Empty state ──────────────────────────────────────────────────────────────

function NoPatient() {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 24,
      textAlign: 'center',
    }}>
      <div style={{
        width: 48, height: 48,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
      </div>
      <p style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'rgba(255,255,255,0.25)',
        letterSpacing: '0.06em',
        lineHeight: 1.55,
        margin: 0,
      }}>
        No patient loaded.<br />
        Search from the patient<br />lookup to load context.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface PatientContextPanelProps {
  patient: PatientData | null;
}

export const PatientContextPanel: React.FC<PatientContextPanelProps> = ({ patient }) => {
  if (!patient) return <NoPatient />;

  const v: Vitals = patient.vitals;
  const esi = computeESI(v, patient.allergies);

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      scrollbarWidth: 'none',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-body)',
    }}>
      {/* Patient identity strip */}
      <div style={{
        padding: '14px 16px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(0,0,0,0.20)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{
              fontSize: 16, fontWeight: 700,
              color: 'var(--text)',
              letterSpacing: '-0.01em',
              marginBottom: 3,
            }}>
              {patient.name}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-muted)',
              letterSpacing: '0.04em',
            }}>
              {patient.mrn} · DOB {patient.dob}
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
              <span style={{
                padding: '2px 8px',
                background: 'rgba(126,240,255,0.10)',
                border: '1px solid rgba(126,240,255,0.25)',
                borderRadius: 9999,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: '#7ef0ff',
                fontWeight: 600,
              }}>
                {patient.bloodType}
              </span>
              <span style={{
                padding: '2px 8px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 9999,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
              }}>
                {patient.sex} · {patient.age}y
              </span>
              {patient.dnr && (
                <span style={{
                  padding: '2px 8px',
                  background: 'rgba(255,58,76,0.14)',
                  border: '1px solid rgba(255,58,76,0.35)',
                  borderRadius: 9999,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: '#ff3a4c',
                  fontWeight: 700,
                }}>
                  DNR
                </span>
              )}
            </div>
          </div>
          <TriageBadge level={esi} />
        </div>
      </div>

      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Vitals grid */}
        <section>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.32)',
            fontWeight: 700,
            marginBottom: 8,
          }}>
            Vitals
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <VitalRow label="HR" value={String(v.heartRate)} unit="bpm" isAbnormal={isAbnormalHR(v.heartRate)} />
            <VitalRow label="SpO₂" value={String(v.spo2)} unit="%" isAbnormal={isAbnormalSpo2(v.spo2)} />
            <VitalRow label="BP" value={`${v.bloodPressureSystolic}/${v.bloodPressureDiastolic}`} unit="mmHg" isAbnormal={isAbnormalBP(v.bloodPressureSystolic)} />
            <VitalRow label="Temp" value={String(v.temperature)} unit="°F" isAbnormal={isAbnormalTemp(v.temperature)} />
            <VitalRow label="RR" value={String(v.respiratoryRate)} unit="/min" isAbnormal={isAbnormalRR(v.respiratoryRate)} />
            {v.gcs !== undefined && (
              <VitalRow label="GCS" value={String(v.gcs)} unit="/15" isAbnormal={v.gcs < 14} />
            )}
          </div>
        </section>

        {/* Allergies */}
        {(patient.allergies ?? []).length > 0 && (
          <section>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(255,58,76,0.60)',
              fontWeight: 700,
              marginBottom: 8,
            }}>
              Allergies
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {(patient.allergies ?? []).map((a, i) => (
                <span key={i} style={{
                  padding: '4px 10px',
                  background: 'rgba(255,58,76,0.10)',
                  border: '1px solid rgba(255,58,76,0.28)',
                  borderRadius: 9999,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: '#ff3a4c',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}>
                  <span style={{ fontSize: 8 }}>⬤</span>
                  {a.substance}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Active Medications */}
        {(patient.medications ?? []).length > 0 && (
          <section>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.32)',
              fontWeight: 700,
              marginBottom: 8,
            }}>
              Active Meds ({(patient.medications ?? []).filter(m => m.active).length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(patient.medications ?? []).filter(m => m.active).map((m, i) => (
                <div key={i} style={{
                  padding: '6px 10px',
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                }}>
                  {m.name}{m.dose ? ` · ${m.dose}` : ''}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Chief complaint */}
        {patient.chiefComplaint && (
          <section>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.32)',
              fontWeight: 700,
              marginBottom: 8,
            }}>
              Chief Complaint
            </div>
            <p style={{
              margin: 0,
              padding: '8px 12px',
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8,
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1.55,
            }}>
              {patient.chiefComplaint}
            </p>
          </section>
        )}

        {/* Surgical history */}
        {(patient.surgicalHistory ?? []).length > 0 && (
          <section>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(184,164,255,0.55)',
              fontWeight: 700,
              marginBottom: 8,
            }}>
              Surgical History
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(patient.surgicalHistory ?? []).map((sh, i) => (
                <div key={i} style={{
                  padding: '8px 12px',
                  background: 'rgba(184,164,255,0.06)',
                  border: '1px solid rgba(184,164,255,0.18)',
                  borderRadius: 8,
                }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600,
                    color: '#b8a4ff',
                    marginBottom: 3,
                  }}>
                    {sh.notes}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--text-dim)',
                  }}>
                    {sh.date}{sh.bodyPart ? ` · ${sh.bodyPart}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
};
