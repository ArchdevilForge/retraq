import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import { DatasetProvider } from './context/DatasetContext';
import { ToastProvider } from './components/ToastHost';
import AnalysisPage from './pages/AnalysisPage';
import ReplayPage from './pages/ReplayPage';
import LearnPage from './pages/LearnPage';

function App() {
  return (
    <ToastProvider>
    <DatasetProvider>
    <div className="app-shell flex h-full min-h-0 flex-col overflow-hidden text-base-content font-sans">
      <Navbar />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/replay" replace />} />
          <Route path="/replay" element={<ReplayPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/learn" element={<LearnPage />} />
          <Route path="*" element={<Navigate to="/replay" replace />} />
        </Routes>
      </div>
    </div>
    </DatasetProvider>
    </ToastProvider>
  );
}

export default App;
