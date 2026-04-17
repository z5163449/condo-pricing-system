import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ProjectSetup from './pages/ProjectSetup.jsx';
import PricingEngine from './pages/PricingEngine.jsx';
import Export from './pages/Export.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="projects" element={<ProjectSetup />} />
          <Route path="projects/:projectId" element={<ProjectSetup />} />
          <Route path="pricing" element={<PricingEngine />} />
          <Route path="pricing/:projectId" element={<PricingEngine />} />
          <Route path="export" element={<Export />} />
          <Route path="export/:projectId" element={<Export />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
