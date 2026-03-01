// Port of cheese's analyze-injury route — pure TS, no HTTP
// Returns clinical flags and risk assessment from patient data

import type { PatientData, Vitals } from '../data/mockPatients';

export interface InjuryFlag {
  id: string;
  label: string;
  detail: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface InjuryAnalysis {
  flags: InjuryFlag[];
  riskScore: number;   // 0–100
  summary: string;
  recommendedOrgan?: string;
}

function isAbnormalHR(hr: number): boolean { return hr < 50 || hr > 110; }
function isAbnormalBP(sys: number, dia: number): boolean { return sys < 90 || sys > 170 || dia < 60 || dia > 110; }
function isAbnormalSpo2(spo2: number): boolean { return spo2 < 94; }
function isAbnormalTemp(temp: number): boolean { return temp < 96 || temp > 101; }
function isAbnormalRR(rr: number): boolean { return rr < 10 || rr > 22; }

function vitalFlags(vitals: Vitals): InjuryFlag[] {
  const flags: InjuryFlag[] = [];

  if (isAbnormalHR(vitals.heartRate)) {
    const sev = vitals.heartRate > 130 || vitals.heartRate < 40 ? 'critical' : 'warning';
    flags.push({
      id: 'hr',
      label: vitals.heartRate > 110 ? 'Tachycardia' : 'Bradycardia',
      detail: `HR ${vitals.heartRate} bpm — ${vitals.heartRate > 110 ? 'possible hemorrhage / sepsis' : 'possible cardiac event'}`,
      severity: sev,
    });
  }

  if (isAbnormalBP(vitals.bloodPressureSystolic, vitals.bloodPressureDiastolic)) {
    const hypo = vitals.bloodPressureSystolic < 90;
    flags.push({
      id: 'bp',
      label: hypo ? 'Hypotension' : 'Hypertension',
      detail: `BP ${vitals.bloodPressureSystolic}/${vitals.bloodPressureDiastolic} mmHg${hypo ? ' — shock protocol indicated' : ''}`,
      severity: hypo ? 'critical' : 'warning',
    });
  }

  if (isAbnormalSpo2(vitals.spo2)) {
    flags.push({
      id: 'spo2',
      label: 'Hypoxia',
      detail: `SpO₂ ${vitals.spo2}% — supplemental O₂ / airway management required`,
      severity: vitals.spo2 < 90 ? 'critical' : 'warning',
    });
  }

  if (isAbnormalTemp(vitals.temperature)) {
    const fever = vitals.temperature > 101;
    flags.push({
      id: 'temp',
      label: fever ? 'Fever' : 'Hypothermia',
      detail: `Temp ${vitals.temperature}°F — ${fever ? 'sepsis workup warranted' : 'warming protocol indicated'}`,
      severity: fever ? 'warning' : 'critical',
    });
  }

  if (isAbnormalRR(vitals.respiratoryRate)) {
    flags.push({
      id: 'rr',
      label: vitals.respiratoryRate > 22 ? 'Tachypnea' : 'Bradypnea',
      detail: `RR ${vitals.respiratoryRate}/min`,
      severity: 'warning',
    });
  }

  if (vitals.gcs !== undefined && vitals.gcs < 13) {
    flags.push({
      id: 'gcs',
      label: 'Altered Consciousness',
      detail: `GCS ${vitals.gcs}/15 — ${vitals.gcs <= 8 ? 'intubation threshold' : 'close neuro monitoring'}`,
      severity: vitals.gcs <= 8 ? 'critical' : 'warning',
    });
  }

  return flags;
}

export function analyzeInjury(patient: PatientData): InjuryAnalysis {
  const flags: InjuryFlag[] = [];

  // Blood type flag (always shown)
  flags.push({
    id: 'blood',
    label: `Blood Type: ${patient.bloodType}`,
    detail: patient.bloodType.includes('-') ? 'Rare type — crossmatch may delay transfusion' : 'Type and screen ready',
    severity: 'info',
  });

  // Life-threatening allergies
  const dangerousAllergies = patient.allergies.filter(a =>
    ['penicillin', 'latex', 'contrast', 'sulfa', 'morphine', 'aspirin'].includes(a.toLowerCase())
  );
  if (dangerousAllergies.length > 0) {
    flags.push({
      id: 'allergy',
      label: `Critical Allergy: ${dangerousAllergies.join(', ')}`,
      detail: 'Avoid administration — anaphylaxis risk. Use alternative agents.',
      severity: 'critical',
    });
  }

  // Vital sign flags
  flags.push(...vitalFlags(patient.vitals));

  // Medication count flag
  if (patient.medications.length >= 3) {
    flags.push({
      id: 'polypharmacy',
      label: 'Polypharmacy',
      detail: `${patient.medications.length} active medications — check interactions before anesthesia`,
      severity: 'warning',
    });
  }

  // Surgical history flags
  if (patient.surgicalHistory.length > 0) {
    const latest = patient.surgicalHistory[0];
    flags.push({
      id: 'surgical-hx',
      label: 'Prior Surgery',
      detail: `${latest.note} (${latest.date})${latest.deficits ? ` — Pre-existing: ${latest.deficits}` : ''}`,
      severity: 'info',
    });
  }

  // DNR
  if (patient.dnr) {
    flags.push({
      id: 'dnr',
      label: 'DNR ORDER ACTIVE',
      detail: 'Do Not Resuscitate — confirm before any invasive intervention',
      severity: 'critical',
    });
  }

  // Risk score
  const critCount = flags.filter(f => f.severity === 'critical').length;
  const warnCount = flags.filter(f => f.severity === 'warning').length;
  const riskScore = Math.min(100, critCount * 25 + warnCount * 12);

  // Summary
  let summary = '';
  if (riskScore >= 75) {
    summary = 'HIGH RISK — Immediate surgical intervention required. Critical vitals + significant allergy profile.';
  } else if (riskScore >= 40) {
    summary = 'MODERATE RISK — Surgical planning warranted. Monitor vitals closely and verify allergy status.';
  } else {
    summary = 'LOWER RISK — Stable for elective surgical planning. Standard precautions apply.';
  }

  // Suggest organ based on chief complaint / vitals pattern
  let recommendedOrgan: string | undefined;
  const complaint = (patient.chiefComplaint ?? '').toLowerCase();
  if (complaint.includes('abdominal') || complaint.includes('liver') || complaint.includes('ruq')) {
    recommendedOrgan = 'liver';
  } else if (complaint.includes('spleen') || complaint.includes('luq')) {
    recommendedOrgan = 'spleen';
  } else if (complaint.includes('head') || complaint.includes('brain') || complaint.includes('neuro')) {
    recommendedOrgan = 'brain';
  } else if (complaint.includes('chest') || complaint.includes('lung') || complaint.includes('thorac')) {
    recommendedOrgan = 'lung';
  } else if (complaint.includes('kidney') || complaint.includes('renal')) {
    recommendedOrgan = 'kidney';
  } else if (complaint.includes('bone') || complaint.includes('fracture') || complaint.includes('ortho')) {
    recommendedOrgan = 'bone';
  }

  return { flags: flags.slice(0, 8), riskScore, summary, recommendedOrgan };
}
