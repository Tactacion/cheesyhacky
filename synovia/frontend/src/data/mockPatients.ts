// Patient data ported from cheese (samarth2307/cheese) — no DB required
// Matches the cheese PatientData interface exactly

export interface Vitals {
  // Cheese field names
  bloodPressure?: { systolic: number; diastolic: number };
  heartRate: number;
  temperature: number;
  height?: string;
  weight?: string;
  bmi?: number;
  respiratoryRate: number;
  oxygenSaturation?: number;
  // Sim field names (aliases)
  spo2: number;
  bloodPressureSystolic: number;
  bloodPressureDiastolic: number;
  gcs?: number;
}

export interface Allergy {
  substance: string;
  reaction?: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'LIFE_THREATENING';
  notedOn?: string;
}

export interface Medication {
  name: string;
  dose?: string;
  frequency?: string;
  active: boolean;
  refills?: number;
}

export interface SurgicalHistory {
  date?: string;
  bodyPart?: string;
  notes: string;
}

export interface PatientData {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  patientId: string;
  mrn: string;
  dob: string;
  age: number;
  sex: string;
  bloodType?: string;
  phone?: string;
  email?: string;
  address?: {
    line1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  insurance?: {
    primary?: { provider: string; policyNumber: string; groupNumber?: string };
  };
  emergencyContacts?: Array<{ name: string; relationship: string; phone: string }>;
  allergies?: Allergy[];
  medications?: Medication[];
  socialHistory?: { tobacco?: string; alcohol?: string; drugs?: string; occupation?: string };
  pastConditions?: SurgicalHistory[];
  immunizations?: Array<{ vaccine: string; administeredOn: string; notes?: string }>;
  familyHistory?: Array<{ relation: string; condition: string; notes?: string }>;
  vitals: Vitals;
  // Sim-specific fields
  dnr?: boolean;
  chiefComplaint?: string;
  surgicalHistory: SurgicalHistory[];
  recentNotes?: Array<{ date: string; provider: string; content: string }>;
}

export const MOCK_PATIENTS: Record<string, PatientData> = {
  '1': {
    id: 'pat_1',
    name: 'Kevin Ketong Gao',
    firstName: 'Kevin',
    lastName: 'Ketong Gao',
    patientId: '1',
    mrn: '1',
    dob: '1995-03-15',
    age: 29,
    sex: 'Male',
    bloodType: 'O+',
    phone: '+1-555-0123',
    email: 'kevin.gao@example.com',
    address: { line1: '123 Tech Street', city: 'San Francisco', state: 'CA', postalCode: '94105' },
    insurance: { primary: { provider: 'Blue Cross Blue Shield', policyNumber: 'BCBS123456789', groupNumber: 'GRP001' } },
    emergencyContacts: [{ name: 'Sarah Gao', relationship: 'Sister', phone: '+1-555-0124' }],
    allergies: [
      { substance: 'Penicillin', reaction: 'Skin rash, hives', severity: 'MODERATE', notedOn: '2023-06-15' },
      { substance: 'Shellfish', reaction: 'Swelling, difficulty breathing', severity: 'SEVERE', notedOn: '2020-08-10' },
      { substance: 'Peanuts', reaction: 'Mild digestive upset', severity: 'MILD', notedOn: '2019-03-22' },
    ],
    medications: [
      { name: 'Lisinopril', dose: '10mg', frequency: 'Once daily', active: true, refills: 3 },
      { name: 'Vitamin D3', dose: '2000 IU', frequency: 'Once daily', active: true, refills: 6 },
    ],
    socialHistory: {
      tobacco: 'Former smoker, quit 2019',
      alcohol: 'Social drinker, 2-3 drinks per week',
      drugs: 'No illicit drug use',
      occupation: 'Software Engineer',
    },
    pastConditions: [
      { date: '2018-07-20', bodyPart: 'abdomen', notes: 'Appendectomy — successful recovery' },
      { date: '2020-09-15', bodyPart: 'left-wrist', notes: 'Fractured left wrist from skateboarding' },
      { date: '2022-01-10', notes: 'COVID-19 infection, mild symptoms' },
    ],
    immunizations: [
      { vaccine: 'COVID-19 (Pfizer)', administeredOn: '2021-04-15', notes: 'First dose' },
      { vaccine: 'COVID-19 Booster', administeredOn: '2023-11-15', notes: 'Updated booster' },
      { vaccine: 'Influenza', administeredOn: '2024-10-01', notes: 'Annual flu shot' },
    ],
    familyHistory: [
      { relation: 'Father', condition: 'Hypertension', notes: 'Diagnosed at age 45' },
      { relation: 'Mother', condition: 'Type 2 Diabetes', notes: 'Well controlled' },
      { relation: 'Grandfather (paternal)', condition: 'Heart disease', notes: 'Heart attack at age 68' },
    ],
    vitals: {
      bloodPressure: { systolic: 128, diastolic: 82 },
      heartRate: 72, temperature: 98.2, respiratoryRate: 16, oxygenSaturation: 98,
      spo2: 98, bloodPressureSystolic: 128, bloodPressureDiastolic: 82, gcs: 15,
      height: '1.75 m', weight: '70 kg', bmi: 22.9,
    },
    chiefComplaint: 'Annual physical — follow-up for hypertension management',
    dnr: false,
    surgicalHistory: [
      { date: '2018-07-20', bodyPart: 'abdomen', notes: 'Appendectomy — successful recovery' },
      { date: '2020-09-15', bodyPart: 'left-wrist', notes: 'Fractured left wrist from skateboarding' },
    ],
    recentNotes: [
      { date: '2024-01-15', provider: 'Dr. Patel', content: 'Annual physical — no acute complaints, BP well controlled.' },
      { date: '2023-12-20', provider: 'Dr. Patel', content: 'Routine hypertension follow-up. Medication maintained.' },
    ],
  },

  '2': {
    id: 'pat_2',
    name: 'Samarth Bhargava',
    firstName: 'Samarth',
    lastName: 'Bhargava',
    patientId: '2',
    mrn: '2',
    dob: '1996-07-22',
    age: 27,
    sex: 'Male',
    bloodType: 'O+',
    phone: '+1-555-0200',
    email: 'samarth.bhargava@example.com',
    address: { line1: '45 Innovation Ave', city: 'Atlanta', state: 'GA', postalCode: '30309' },
    insurance: { primary: { provider: 'Aetna', policyNumber: 'AET987654', groupNumber: 'GRP002' } },
    emergencyContacts: [{ name: 'Priya Bhargava', relationship: 'Mother', phone: '+1-555-0201' }],
    allergies: [
      { substance: 'Sulfa drugs', reaction: 'Anaphylaxis', severity: 'LIFE_THREATENING', notedOn: '2021-04-10' },
      { substance: 'Latex', reaction: 'Contact dermatitis', severity: 'MODERATE', notedOn: '2019-11-05' },
    ],
    medications: [
      { name: 'Cetirizine', dose: '10mg', frequency: 'Once daily PRN', active: true, refills: 2 },
      { name: 'EpiPen', dose: '0.3mg epinephrine', frequency: 'PRN anaphylaxis', active: true, refills: 1 },
      { name: 'Metformin', dose: '500mg', frequency: 'Twice daily', active: true, refills: 5 },
    ],
    socialHistory: {
      tobacco: 'Never smoker',
      alcohol: 'Occasional, <1 drink/week',
      drugs: 'No illicit drug use',
      occupation: 'Medical Resident',
    },
    pastConditions: [
      { date: '2021-03-18', bodyPart: 'right-lung', notes: 'Pneumonia — hospitalized 5 days, full recovery' },
      { date: '2023-06-01', bodyPart: 'spine', notes: 'L4-L5 disc herniation, managed conservatively' },
    ],
    immunizations: [
      { vaccine: 'COVID-19 (Moderna)', administeredOn: '2021-05-20', notes: 'Full series' },
      { vaccine: 'Hepatitis B', administeredOn: '2022-01-10', notes: 'Booster' },
    ],
    familyHistory: [
      { relation: 'Father', condition: 'Type 2 Diabetes', notes: 'On insulin' },
      { relation: 'Sister', condition: 'Asthma', notes: 'Mild, inhaler PRN' },
    ],
    vitals: {
      bloodPressure: { systolic: 145, diastolic: 92 },
      heartRate: 105, temperature: 100.6, respiratoryRate: 20, oxygenSaturation: 95,
      spo2: 95, bloodPressureSystolic: 145, bloodPressureDiastolic: 92, gcs: 15,
      height: '1.80 m', weight: '82 kg', bmi: 25.3,
    },
    chiefComplaint: 'Elevated BP, tachycardia — possible anaphylaxis exposure, EpiPen administered pre-hospital',
    dnr: false,
    surgicalHistory: [
      { date: '2021-03-18', bodyPart: 'right-lung', notes: 'Pneumonia — hospitalized 5 days, full recovery' },
      { date: '2023-06-01', bodyPart: 'spine', notes: 'L4-L5 disc herniation, managed conservatively' },
    ],
    recentNotes: [
      { date: '2024-02-10', provider: 'Dr. Kim', content: 'Elevated BP + tachycardia — work stress noted. Monitoring.' },
      { date: '2024-01-28', provider: 'Dr. Kim', content: 'Anaphylaxis risk documented. EpiPen prescription renewed.' },
    ],
  },

  '3': {
    id: 'pat_3',
    name: 'Ishan Kharbanda',
    firstName: 'Ishan',
    lastName: 'Kharbanda',
    patientId: '3',
    mrn: '3',
    dob: '1997-11-08',
    age: 26,
    sex: 'Male',
    bloodType: 'A+',
    phone: '+1-555-0300',
    email: 'ishan.kharbanda@example.com',
    address: { line1: '789 Research Blvd', city: 'Boston', state: 'MA', postalCode: '02115' },
    insurance: { primary: { provider: 'United Healthcare', policyNumber: 'UHC456789', groupNumber: 'GRP003' } },
    emergencyContacts: [{ name: 'Raj Kharbanda', relationship: 'Father', phone: '+1-555-0301' }],
    allergies: [
      { substance: 'Penicillin', reaction: 'Hives, throat swelling', severity: 'SEVERE', notedOn: '2018-09-14' },
    ],
    medications: [
      { name: 'Omeprazole', dose: '20mg', frequency: 'Once daily', active: true, refills: 4 },
      { name: 'Sertraline', dose: '50mg', frequency: 'Once daily', active: true, refills: 3 },
    ],
    socialHistory: {
      tobacco: 'Never smoker',
      alcohol: 'Non-drinker',
      drugs: 'No illicit drug use',
      occupation: 'PhD Student (Bioengineering)',
    },
    pastConditions: [
      { date: '2020-12-05', bodyPart: 'left-knee', notes: 'ACL tear — surgical repair, full recovery' },
      { date: '2023-03-22', bodyPart: 'abdomen', notes: 'GERD diagnosis — dietary modifications + PPI' },
    ],
    immunizations: [
      { vaccine: 'COVID-19 (J&J)', administeredOn: '2021-06-12', notes: 'Single dose' },
      { vaccine: 'Tdap', administeredOn: '2023-08-01', notes: 'Booster' },
    ],
    familyHistory: [
      { relation: 'Mother', condition: 'Anxiety disorder', notes: 'Managed with therapy' },
      { relation: 'Grandfather', condition: 'Colon cancer', notes: 'Diagnosed at 70' },
    ],
    vitals: {
      bloodPressure: { systolic: 118, diastolic: 76 },
      heartRate: 68, temperature: 98.2, respiratoryRate: 15, oxygenSaturation: 99,
      spo2: 99, bloodPressureSystolic: 118, bloodPressureDiastolic: 76, gcs: 15,
      height: '1.78 m', weight: '74 kg', bmi: 23.4,
    },
    chiefComplaint: 'Routine follow-up — GERD and mental health management',
    dnr: false,
    surgicalHistory: [
      { date: '2020-12-05', bodyPart: 'left-knee', notes: 'ACL tear — surgical repair, full recovery' },
    ],
    recentNotes: [
      { date: '2024-02-01', provider: 'Dr. Chen', content: 'GERD well controlled on PPI. Mental health stable on sertraline.' },
    ],
  },
};

export function searchPatients(query: string): PatientData[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return Object.values(MOCK_PATIENTS).filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.firstName.toLowerCase().includes(q) ||
      p.lastName.toLowerCase().includes(q) ||
      p.patientId.includes(q) ||
      p.mrn.includes(q),
  );
}

export function getPatientById(id: string): PatientData | null {
  return MOCK_PATIENTS[id] ?? null;
}
