import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchPatients } from '../data/mockPatients';
import type { PatientData } from '../data/mockPatients';

export function PatientLookupPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'scan' | 'id' | 'name'>('scan');
  const [patientIdSearch, setPatientIdSearch] = useState('');
  const [nameSearch, setNameSearch] = useState('');
  const [results, setResults] = useState<PatientData[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (tab === 'id') setResults(patientIdSearch.trim() ? searchPatients(patientIdSearch.trim()) : []);
  }, [patientIdSearch, tab]);

  useEffect(() => {
    if (tab === 'name') setResults(nameSearch.trim() ? searchPatients(nameSearch.trim()) : []);
  }, [nameSearch, tab]);

  useEffect(() => { setResults([]); setScanResult(null); setScanError(null); }, [tab]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      setCameraActive(true);
    } catch { setScanError('Camera access denied. Try ID or Name search.'); }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  const captureAndScan = () => {
    stopCamera();
    setIsScanning(true);
    setTimeout(() => {
      const names = ['Kevin', 'Samarth', 'Ishan'];
      const fakeMatch = names[Math.floor(Math.random() * names.length)]!;
      setScanResult(fakeMatch);
      setResults(searchPatients(fakeMatch));
      setIsScanning(false);
    }, 1800);
  };

  const selectPatient = (patient: PatientData, dest: 'dashboard' | 'sim' | 'assess') => {
    sessionStorage.setItem('selectedPatient', JSON.stringify(patient));
    if (dest === 'dashboard') navigate(`/dashboard?patientId=${patient.patientId}`);
    else if (dest === 'assess') navigate(`/assess?patientId=${patient.patientId}`);
    else navigate(`/sim?patientId=${patient.patientId}`);
  };

  const noResults = results.length === 0 && (patientIdSearch || nameSearch || scanResult) && !isScanning;

  return (
    <div style={{ minHeight: '100vh', background: '#080c14', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {/* Nav */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #22d3ee 0%, #0e7490 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
          </svg>
        </div>
        <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em', color: '#f1f5f9' }}>Synovia EMR</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/NeuroSim')} style={navBtn}>NeuroSim</button>
          <button onClick={() => navigate('/stl-viewer')} style={navBtn}>STL Viewer</button>
          <button onClick={() => navigate('/sim')} style={{ ...navBtn, background: 'rgba(34,211,238,0.12)', color: '#22d3ee', borderColor: 'rgba(34,211,238,0.3)' }}>Surgical Sim</button>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#22d3ee' }}>Patient Registry</span>
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-0.03em', color: '#f1f5f9', margin: '0 0 8px' }}>Patient Lookup</h1>
          <p style={{ color: '#64748b', fontSize: 15, margin: 0 }}>Search by patient ID, name, or scan a government-issued ID card</p>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 4, marginBottom: 20 }}>
          {(['scan', 'id', 'name'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
              background: tab === t ? 'rgba(255,255,255,0.95)' : 'transparent',
              color: tab === t ? '#0f172a' : '#64748b',
              transition: 'all 0.15s',
            }}>
              {t === 'scan' ? '📷 ID Scan' : t === 'id' ? '🔍 Patient ID' : '👤 Name Search'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={card}>
          {tab === 'scan' && (
            <div>
              <div style={cardHeader}>📷 &nbsp;<span style={{ fontWeight: 700 }}>Scan Patient ID</span></div>
              <div style={{ padding: '20px' }}>
                {!cameraActive ? (
                  <div style={{ textAlign: 'center', padding: '32px 0' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 16, background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    </div>
                    <p style={{ color: '#64748b', marginBottom: 16 }}>Point camera at patient's government ID to auto-fill their information</p>
                    <button onClick={startCamera} style={primaryBtn}>Activate Camera</button>
                  </div>
                ) : (
                  <div>
                    <video ref={videoRef} style={{ width: '100%', borderRadius: 10, background: '#000' }} muted playsInline />
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button onClick={captureAndScan} disabled={isScanning} style={{ ...primaryBtn, flex: 1, justifyContent: 'center' }}>
                        {isScanning ? 'Scanning...' : 'Capture & Scan'}
                      </button>
                      <button onClick={stopCamera} style={ghostBtn}>Cancel</button>
                    </div>
                  </div>
                )}
                {isScanning && <div style={{ textAlign: 'center', color: '#22d3ee', padding: '12px 0', fontSize: 13 }}>Processing ID scan...</div>}
                {scanResult && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, marginTop: 12 }}>
                    <span style={{ color: '#10b981' }}>✓</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#6ee7b7' }}>Extracted: {scanResult}</span>
                  </div>
                )}
                {scanError && (
                  <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, marginTop: 12, color: '#fca5a5', fontSize: 13 }}>
                    {scanError}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'id' && (
            <div>
              <div style={cardHeader}>🔍 &nbsp;<span style={{ fontWeight: 700 }}>Search by Patient ID</span></div>
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="Enter Patient ID (e.g., 1, 2, 3)" value={patientIdSearch} onChange={(e) => setPatientIdSearch(e.target.value)} style={searchInput} />
                  <button style={primaryBtn}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button>
                </div>
              </div>
            </div>
          )}

          {tab === 'name' && (
            <div>
              <div style={cardHeader}>👤 &nbsp;<span style={{ fontWeight: 700 }}>Search by Name</span></div>
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="Enter patient name (e.g., Kevin, Samarth, Ishan)" value={nameSearch} onChange={(e) => setNameSearch(e.target.value)} style={searchInput} />
                  <button style={primaryBtn}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#475569', marginBottom: 10 }}>
              {results.length} result{results.length !== 1 ? 's' : ''} found
            </p>
            {results.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👤</div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: '#f1f5f9' }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                      MRN {p.mrn} · {p.dob} · {p.sex}
                      {p.bloodType && <span style={{ marginLeft: 6, padding: '1px 8px', background: 'rgba(34,211,238,0.12)', color: '#22d3ee', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{p.bloodType}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => selectPatient(p, 'assess')} style={ghostBtn}>Assess</button>
                  <button onClick={() => selectPatient(p, 'dashboard')} style={ghostBtn}>Dashboard</button>
                  <button onClick={() => selectPatient(p, 'sim')} style={primaryBtn}>🩺 Simulate</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {noResults && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, marginTop: 20 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <p style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>No patients found</p>
            <p style={{ color: '#64748b', fontSize: 13 }}>Try adjusting your search criteria</p>
          </div>
        )}
      </div>
    </div>
  );
}

const card: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, overflow: 'hidden' };
const cardHeader: React.CSSProperties = { padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center' };
const primaryBtn: React.CSSProperties = { padding: '10px 18px', background: '#22d3ee', color: '#0f172a', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
const ghostBtn: React.CSSProperties = { padding: '8px 14px', background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
const searchInput: React.CSSProperties = { flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: '#f1f5f9', fontSize: 14, outline: 'none' };
const navBtn: React.CSSProperties = { padding: '6px 14px', background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' };
