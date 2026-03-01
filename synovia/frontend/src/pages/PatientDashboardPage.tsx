import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getPatientById } from '../data/mockPatients';
import type { PatientData } from '../data/mockPatients';

function computeESI(vitals?: PatientData['vitals'], allergies?: PatientData['allergies']): 1|2|3|4|5 {
  if (allergies?.some((a) => a.severity === 'LIFE_THREATENING')) return 1;
  const hr = vitals?.heartRate ?? 0;
  const spo2 = vitals?.oxygenSaturation ?? 100;
  const rr = vitals?.respiratoryRate ?? 16;
  if (hr > 150 || (hr > 0 && hr < 40)) return 1;
  if (spo2 > 0 && spo2 < 90) return 1;
  if (rr > 35 || (rr > 0 && rr < 8)) return 1;
  let score: 1|2|3|4|5 = 5;
  const bp = vitals?.bloodPressure?.systolic ?? 120;
  const temp = vitals?.temperature ?? 37;
  if (allergies?.some((a) => a.severity === 'SEVERE')) score = Math.min(score, 2) as 1|2|3|4|5;
  if (hr > 120 || (hr > 0 && hr < 50)) score = Math.min(score, 2) as 1|2|3|4|5;
  if (spo2 > 0 && spo2 < 94) score = Math.min(score, 2) as 1|2|3|4|5;
  if (bp > 180 || (bp > 0 && bp < 80)) score = Math.min(score, 2) as 1|2|3|4|5;
  if (temp > 40 || (temp > 0 && temp < 35)) score = Math.min(score, 2) as 1|2|3|4|5;
  if (hr > 100 || (hr > 0 && hr < 60)) score = Math.min(score, 3) as 1|2|3|4|5;
  if (spo2 > 0 && spo2 < 96) score = Math.min(score, 3) as 1|2|3|4|5;
  if (bp > 160 || (bp > 0 && bp < 90)) score = Math.min(score, 3) as 1|2|3|4|5;
  if (temp > 38.5 || (temp > 0 && temp < 36)) score = Math.min(score, 3) as 1|2|3|4|5;
  return score;
}

const ESI_COLORS: Record<number, string> = { 1: '#dc2626', 2: '#f97316', 3: '#eab308', 4: '#16a34a', 5: '#2563eb' };
const ESI_LABELS: Record<number, string> = { 1: 'CRITICAL', 2: 'EMERGENT', 3: 'URGENT', 4: 'LESS URGENT', 5: 'NON-URGENT' };
const SEVERITY_COLORS: Record<string, string> = {
  LIFE_THREATENING: '#dc2626', SEVERE: '#f97316', MODERATE: '#eab308', MILD: '#22d3ee'
};

export function PatientDashboardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [patient, setPatient] = useState<PatientData | null>(null);

  useEffect(() => {
    const idFromUrl = searchParams.get('patientId');
    if (idFromUrl) {
      const found = getPatientById(idFromUrl);
      if (found) { setPatient(found); return; }
    }
    const stored = sessionStorage.getItem('selectedPatient');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { patientId?: string };
        const found = getPatientById(parsed.patientId ?? '');
        if (found) setPatient(found);
      } catch { /* ignore */ }
    }
  }, [searchParams]);

  if (!patient) {
    return (
      <div style={{ minHeight: '100vh', background: '#080c14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏥</div>
          <p style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>No patient selected</p>
          <button onClick={() => navigate('/lookup')} style={primaryBtn}>← Go to Patient Lookup</button>
        </div>
      </div>
    );
  }

  const esi = computeESI(patient.vitals, patient.allergies);
  const esiColor = ESI_COLORS[esi]!;
  const activeMeds = patient.medications?.filter((m) => m.active) ?? [];
  const critAllergies = patient.allergies?.filter((a) => a.severity === 'LIFE_THREATENING' || a.severity === 'SEVERE') ?? [];

  const launchSim = () => {
    sessionStorage.setItem('selectedPatient', JSON.stringify(patient));
    navigate(`/sim?patientId=${patient.patientId}`);
  };

  const goAssess = () => {
    sessionStorage.setItem('selectedPatient', JSON.stringify(patient));
    navigate(`/assess?patientId=${patient.patientId}`);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#080c14', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {/* Top bar */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.02)' }}>
        <button onClick={() => navigate('/lookup')} style={{ ...ghostBtn, padding: '6px 12px' }}>← Back</button>
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />
        <div style={{ fontWeight: 800, fontSize: 15, color: '#f1f5f9' }}>{patient.name}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>MRN {patient.mrn} · {patient.sex} · {patient.age}y</div>
        <span style={{ padding: '3px 12px', borderRadius: 20, background: esiColor, color: '#fff', fontSize: 11, fontWeight: 700 }}>
          ESI {esi} · {ESI_LABELS[esi]}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={goAssess} style={ghostBtn}>3D Assessment</button>
          <button onClick={launchSim} style={primaryBtn}>🩺 Launch Simulation</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Demographics */}
          <div style={card}>
            <div style={sectionLabel}>Demographics</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: '16px' }}>
              {[
                ['Date of Birth', patient.dob],
                ['Sex', patient.sex],
                ['Blood Type', patient.bloodType ?? '—'],
                ['Phone', patient.phone ?? '—'],
                ['Email', patient.email ?? '—'],
                ['Occupation', patient.socialHistory?.occupation ?? '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 14, color: '#f1f5f9', fontWeight: 600 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Vitals */}
          <div style={card}>
            <div style={sectionLabel}>Vitals</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '16px' }}>
              {patient.vitals && [
                { label: 'Heart Rate', value: patient.vitals.heartRate ? `${patient.vitals.heartRate} bpm` : '—', warn: patient.vitals.heartRate ? patient.vitals.heartRate > 100 || patient.vitals.heartRate < 60 : false },
                { label: 'Blood Pressure', value: patient.vitals.bloodPressure ? `${patient.vitals.bloodPressure.systolic}/${patient.vitals.bloodPressure.diastolic}` : '—', warn: patient.vitals.bloodPressure ? patient.vitals.bloodPressure.systolic > 140 : false },
                { label: 'SpO₂', value: patient.vitals.oxygenSaturation ? `${patient.vitals.oxygenSaturation}%` : '—', warn: patient.vitals.oxygenSaturation ? patient.vitals.oxygenSaturation < 96 : false },
                { label: 'Temperature', value: patient.vitals.temperature ? `${patient.vitals.temperature}°C` : '—', warn: patient.vitals.temperature ? patient.vitals.temperature > 38.5 : false },
                { label: 'Resp. Rate', value: patient.vitals.respiratoryRate ? `${patient.vitals.respiratoryRate}/min` : '—', warn: patient.vitals.respiratoryRate ? patient.vitals.respiratoryRate > 20 : false },
                { label: 'BMI', value: patient.vitals.bmi ? `${patient.vitals.bmi}` : '—', warn: false },
                { label: 'Height', value: patient.vitals.height ?? '—', warn: false },
                { label: 'Weight', value: patient.vitals.weight ?? '—', warn: false },
              ].map(({ label, value, warn }) => (
                <div key={label} style={{ padding: '12px', background: warn ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${warn ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: warn ? '#f87171' : '#475569', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: warn ? '#fca5a5' : '#f1f5f9' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Notes */}
          {patient.recentNotes && patient.recentNotes.length > 0 && (
            <div style={card}>
              <div style={sectionLabel}>Recent Notes</div>
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {patient.recentNotes.map((note, i) => (
                  <div key={i} style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, borderLeft: '3px solid rgba(34,211,238,0.4)' }}>
                    <div style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>{note.date} · {note.provider}</div>
                    <div style={{ fontSize: 13, color: '#cbd5e1' }}>{note.content}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ESI + Critical Summary */}
          <div style={{ ...card, padding: '20px', background: `linear-gradient(135deg, ${esiColor}18 0%, rgba(255,255,255,0.03) 100%)`, border: `1px solid ${esiColor}30` }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#64748b', marginBottom: 4 }}>AI Triage Score</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, color: esiColor }}>{esi}</span>
                  <span style={{ fontSize: 14, color: '#475569' }}>/ 5</span>
                </div>
                <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: '0.05em', color: esiColor }}>{ESI_LABELS[esi]}</div>
              </div>
              <div style={{ fontSize: 80, fontWeight: 900, lineHeight: 1, color: esiColor, opacity: 0.1 }}>{esi}</div>
            </div>
            {critAllergies.length > 0 && (
              <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 12, color: '#fca5a5', fontWeight: 600 }}>
                ⚠ {critAllergies.map((a) => a.substance).join(', ')} — {critAllergies[0]!.severity.replace('_', ' ')}
              </div>
            )}
          </div>

          {/* Allergies */}
          <div style={card}>
            <div style={sectionLabel}>Allergies ({patient.allergies?.length ?? 0})</div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {patient.allergies?.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{a.substance}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{a.reaction}</div>
                  </div>
                  <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: `${SEVERITY_COLORS[a.severity] ?? '#64748b'}22`, color: SEVERITY_COLORS[a.severity] ?? '#64748b' }}>
                    {a.severity.replace('_', ' ')}
                  </span>
                </div>
              )) ?? <div style={{ color: '#475569', fontSize: 13 }}>No allergies recorded</div>}
            </div>
          </div>

          {/* Active Medications */}
          <div style={card}>
            <div style={sectionLabel}>Active Medications ({activeMeds.length})</div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {activeMeds.map((m, i) => (
                <div key={i} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{m.dose} · {m.frequency}</div>
                </div>
              ))}
              {activeMeds.length === 0 && <div style={{ color: '#475569', fontSize: 13 }}>No active medications</div>}
            </div>
          </div>

          {/* Emergency Contact */}
          {patient.emergencyContacts?.[0] && (
            <div style={card}>
              <div style={sectionLabel}>Emergency Contact</div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>{patient.emergencyContacts[0].name}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{patient.emergencyContacts[0].relationship} · {patient.emergencyContacts[0].phone}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden' };
const sectionLabel: React.CSSProperties = { padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#475569' };
const primaryBtn: React.CSSProperties = { padding: '9px 18px', background: '#22d3ee', color: '#0f172a', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { padding: '8px 14px', background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
