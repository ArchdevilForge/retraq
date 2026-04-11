import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import AnalysisPage from './pages/AnalysisPage';
import ImportPage from './pages/ImportPage';
import LearnPage from './pages/LearnPage';
import ReplayPage from './pages/ReplayPage';

function App() {
  return (
    <div className="flex flex-col h-screen bg-base-100 text-base-content font-sans">
      <Navbar />
      <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/replay" replace />} />
          <Route path="/replay" element={<ReplayPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/learn" element={<LearnPage />} />
          <Route path="*" element={<Navigate to="/replay" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
