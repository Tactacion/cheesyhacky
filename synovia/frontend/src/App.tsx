import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { NeuroSimPage } from './pages/NeuroSimPage';
import { STLViewerPage } from './pages/STLViewerPage';
import { SynoviaSimPage } from './pages/SynoviaSimPage';
import { PatientLookupPage } from './pages/PatientLookupPage';
import { PatientDashboardPage } from './pages/PatientDashboardPage';
import { PatientAssessmentPage } from './pages/PatientAssessmentPage';

function App() {
  return (
    <Router>
      <Routes>
        {/* Original routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/NeuroSim" element={<NeuroSimPage />} />
        <Route path="/stl-viewer" element={<STLViewerPage />} />
        {/* Synovia surgical sim (with patient context) */}
        <Route path="/sim" element={<SynoviaSimPage />} />
        {/* Cheese EMR routes */}
        <Route path="/lookup" element={<PatientLookupPage />} />
        <Route path="/dashboard" element={<PatientDashboardPage />} />
        <Route path="/assess" element={<PatientAssessmentPage />} />
      </Routes>
    </Router>
  );
}

export default App;
