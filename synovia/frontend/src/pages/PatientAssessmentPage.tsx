import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getPatientById } from '../data/mockPatients';
import type { PatientData } from '../data/mockPatients';
import { HybridBodyModel } from '../components/HybridBodyModel';

const SEVERITY_COLORS: Record<string, string> = {
  LIFE_THREATENING: '#dc2626', SEVERE: '#f97316', MODERATE: '#eab308', MILD: '#22d3ee'
};

export function PatientAssessmentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [patient, setPatient] = useState<PatientData | null>(null);
  const [selectedBodyPart, setSelectedBodyPart] = useState<string | null>(null);
  const [patientNotes, setPatientNotes] = useState<Record<string, string>>({});
  const [currentNote, setCurrentNote] = useState('');
  const [analysisText, setAnalysisText] = useState('');

  useEffect(() => {
    const idFromUrl = searchParams.get('patientId');
    if (idFromUrl) {
      const found = getPatientById(idFromUrl);
      if (found) {
        setPatient(found);
        // Pre-populate body parts from patient history
        const notes: Record<string, string> = {};
        found.pastConditions?.forEach((c) => {
          if (c.bodyPart) notes[c.bodyPart] = c.notes;
        });
        found.allergies?.forEach((a) => {
          if (a.severity === 'LIFE_THREATENING' || a.severity === 'SEVERE') {
            notes['chest'] = (notes['chest'] ? notes['chest'] + '; ' : '') + `${a.severity} allergy: ${a.substance}`;
          }
        });
        setPatientNotes(notes);
        return;
      }
    }
    const stored = sessionStorage.getItem('selectedPatient');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { patientId?: string };
        const found = getPatientById(parsed.patientId ?? '');
        if (found) { setPatient(found); }
      } catch { /* ignore */ }
    }
  }, [searchParams]);

  const handleBodyPartSelect = (part: string) => {
    setSelectedBodyPart(part || null);
    if (part) {
      setCurrentNote(patientNotes[part] ?? '');
    }
  };

  const saveNote = () => {
    if (!selectedBodyPart) return;
    setPatientNotes((prev) => ({ ...prev, [selectedBodyPart]: currentNote }));
  };

  const launchSim = () => {
    if (!patient) return;
    sessionStorage.setItem('selectedPatient', JSON.stringify(patient));
    navigate(`/sim?patientId=${patient.patientId}`);
  };

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

  const selectedPartData = selectedBodyPart ? {
    note: patientNotes[selectedBodyPart] ?? '',
    pastConditions: patient.pastConditions?.filter((c) => c.bodyPart === selectedBodyPart) ?? [],
  } : null;

  return (
    <div style={{ minHeight: '100vh', background: '#080c14', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
        <button onClick={() => navigate(`/dashboard?patientId=${patient.patientId}`)} style={ghostBtn}>← Dashboard</button>
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />
        <div style={{ fontWeight: 800, fontSize: 15, color: '#f1f5f9' }}>{patient.name}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>3D Patient Assessment</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {Object.keys(patientNotes).length} region{Object.keys(patientNotes).length !== 1 ? 's' : ''} annotated
          </div>
          <button onClick={launchSim} style={primaryBtn}>🩺 Launch FEA Simulation</button>
        </div>
      </div>

      {/* Main layout */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 360px', overflow: 'hidden' }}>
        {/* 3D viewer */}
        <div style={{ height: 'calc(100vh - 57px)', position: 'relative' }}>
          <HybridBodyModel
            selectedBodyPart={selectedBodyPart}
            onBodyPartSelect={handleBodyPartSelect}
            patientData={patientNotes}
            analysisText={analysisText}
          />
        </div>

        {/* Right panel */}
        <div style={{ borderLeft: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Patient header */}
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#f1f5f9', marginBottom: 4 }}>{patient.name}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={chip}>{patient.age}y · {patient.sex}</span>
              {patient.bloodType && <span style={{ ...chip, background: 'rgba(34,211,238,0.12)', color: '#22d3ee' }}>{patient.bloodType}</span>}
              {patient.allergies?.filter((a) => a.severity === 'LIFE_THREATENING').map((a) => (
                <span key={a.substance} style={{ ...chip, background: 'rgba(220,38,38,0.15)', color: '#f87171' }}>⚠ {a.substance}</span>
              ))}
            </div>
          </div>

          {/* AI Analysis search */}
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#475569', marginBottom: 8 }}>AI Region Analysis</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                placeholder="e.g. spine injury, liver laceration"
                value={analysisText}
                onChange={(e) => setAnalysisText(e.target.value)}
                style={{ flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none' }}
              />
            </div>
            {analysisText && <div style={{ fontSize: 11, color: '#22d3ee', marginTop: 6 }}>↑ Body regions highlighted in real-time</div>}
          </div>

          {/* Selected body part detail */}
          {selectedBodyPart ? (
            <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#22d3ee', marginBottom: 10 }}>
                ▶ {selectedBodyPart.replace(/-/g, ' ')}
              </div>
              {selectedPartData?.pastConditions && selectedPartData.pastConditions.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginBottom: 6 }}>PRIOR CONDITIONS</div>
                  {selectedPartData.pastConditions.map((c, i) => (
                    <div key={i} style={{ padding: '8px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, marginBottom: 6, fontSize: 12, color: '#fca5a5' }}>
                      {c.date && <span style={{ color: '#64748b' }}>{c.date} · </span>}{c.notes}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginBottom: 6 }}>CLINICAL NOTES</div>
              <textarea
                value={currentNote}
                onChange={(e) => setCurrentNote(e.target.value)}
                placeholder={`Add notes for ${selectedBodyPart.replace(/-/g, ' ')}...`}
                rows={4}
                style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
              />
              <button onClick={saveNote} style={{ ...primaryBtn, marginTop: 8, width: '100%', justifyContent: 'center' }}>Save Note</button>
            </div>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: '#475569', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🫀</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Click a body region to add clinical notes</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Highlighted regions have prior conditions</div>
            </div>
          )}

          {/* Allergies quick view */}
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#475569', marginBottom: 8 }}>Allergies</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {patient.allergies?.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 7 }}>
                  <span style={{ fontSize: 13, color: '#e2e8f0' }}>{a.substance}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${SEVERITY_COLORS[a.severity] ?? '#64748b'}20`, color: SEVERITY_COLORS[a.severity] ?? '#64748b' }}>
                    {a.severity.replace('_', ' ')}
                  </span>
                </div>
              )) ?? <div style={{ color: '#475569', fontSize: 13 }}>None recorded</div>}
            </div>
          </div>

          {/* Active meds */}
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#475569', marginBottom: 8 }}>Active Medications</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {patient.medications?.filter((m) => m.active).map((m, i) => (
                <div key={i} style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 7, fontSize: 12 }}>
                  <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{m.name}</div>
                  <div style={{ color: '#64748b' }}>{m.dose} · {m.frequency}</div>
                </div>
              )) ?? <div style={{ color: '#475569', fontSize: 13 }}>None recorded</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = { padding: '9px 18px', background: '#22d3ee', color: '#0f172a', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { padding: '8px 14px', background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
const chip: React.CSSProperties = { padding: '2px 9px', background: 'rgba(255,255,255,0.07)', color: '#94a3b8', borderRadius: 20, fontSize: 11, fontWeight: 600 };
