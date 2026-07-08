import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import { DatasetProvider } from './context/DatasetContext';
import { ToastProvider } from './components/ToastHost';
import ReplayPage from './pages/ReplayPage';

const AnalysisPage = lazy(() => import('./pages/AnalysisPage'));
const LearnPage = lazy(() => import('./pages/LearnPage'));

function RouteFallback() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <span className="oc-spinner oc-spinner--md" aria-label="加载中…" />
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
    <DatasetProvider>
    <div className="app-shell flex h-full min-h-0 flex-col overflow-hidden">
      <Navbar />
      <main id="main-content" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/replay" replace />} />
            <Route path="/replay" element={<ReplayPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/learn" element={<LearnPage />} />
            <Route path="*" element={<Navigate to="/replay" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
    </DatasetProvider>
    </ToastProvider>
  );
}

export default App;
