import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import { DatasetProvider } from './context/DatasetContext';
import { ToastProvider } from './components/ToastHost';

// 路由级懒加载（§8.1：加载期必须有可见态，不得白屏）：
// 三个页面各自独立 chunk，首屏只加载当前路由 + 共享壳层。
const ReplayPage = lazy(() => import('./pages/ReplayPage'));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'));

function RouteFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <span className="oc-spinner oc-spinner--md" aria-label="页面加载中…" />
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
                {/* 高手并入复盘工作台、学习转为场景内提示（docs/PRODUCT.md §九） */}
                <Route path="/masters" element={<Navigate to="/replay" replace />} />
                {/* 训练模式已移除（0 产出的下单模拟引擎）；藏未来回放已并入复盘工具条 */}
                <Route path="/train" element={<Navigate to="/replay" replace />} />
                <Route path="/learn" element={<Navigate to="/replay" replace />} />
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
