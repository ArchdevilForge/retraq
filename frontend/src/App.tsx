import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import { DatasetProvider } from './context/DatasetContext';
import { ToastProvider } from './components/ToastHost';
import ReplayPage from './pages/ReplayPage';
import AnalysisPage from './pages/AnalysisPage';
import TrainPage from './pages/TrainPage';

function App() {
  return (
    <ToastProvider>
      <DatasetProvider>
        <div className="app-shell flex h-full min-h-0 flex-col overflow-hidden">
          <Navbar />
          <main id="main-content" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Routes>
              <Route path="/" element={<Navigate to="/replay" replace />} />
              <Route path="/replay" element={<ReplayPage />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/train" element={<TrainPage />} />
              {/* 高手并入复盘工作台、学习转为场景内提示（docs/PRODUCT.md §九） */}
              <Route path="/masters" element={<Navigate to="/replay" replace />} />
              <Route path="/learn" element={<Navigate to="/replay" replace />} />
              <Route path="*" element={<Navigate to="/replay" replace />} />
            </Routes>
          </main>
        </div>
      </DatasetProvider>
    </ToastProvider>
  );
}

export default App;
