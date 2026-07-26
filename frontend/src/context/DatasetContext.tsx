import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ACTIVE_DATASET_STORAGE_KEY, fetchDatasets, type Dataset } from '../services/api';

type DatasetContextValue = {
  datasets: Dataset[];
  activeDatasetId: number | null;
  setActiveDatasetId: (id: number) => void;
  refreshDatasets: () => Promise<void>;
  tradesRevision: number;
  notifyTradesChanged: () => void;
  loading: boolean;
  /** Non-null when the dataset list could not be loaded (distinct from "no datasets yet"). */
  error: string | null;
};

const DatasetContext = createContext<DatasetContextValue | null>(null);

export function DatasetProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeDatasetId, setActiveDatasetIdState] = useState<number | null>(() => {
    const raw = localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY);
    return raw ? Number(raw) : null;
  });
  const [tradesRevision, setTradesRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const notifyTradesChanged = useCallback(() => {
    setTradesRevision((n) => n + 1);
  }, []);

  const refreshDatasets = useCallback(async () => {
    let data: Dataset[];
    try {
      ({ data } = await fetchDatasets());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
    setError(null);
    setDatasets(data);
    if (data.length === 0) {
      setActiveDatasetIdState(null);
      localStorage.removeItem(ACTIVE_DATASET_STORAGE_KEY);
      return;
    }
    const stored = localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY);
    const storedId = stored ? Number(stored) : null;
    const valid = storedId != null && data.some((d) => d.id === storedId);
    const nextId = valid ? storedId! : data[0].id;
    setActiveDatasetIdState(nextId);
    localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, String(nextId));
  }, []);

  useEffect(() => {
    refreshDatasets()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshDatasets]);

  const setActiveDatasetId = useCallback((id: number) => {
    setActiveDatasetIdState(id);
    localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, String(id));
  }, []);

  const value = useMemo(
    () => ({
      datasets,
      activeDatasetId,
      setActiveDatasetId,
      refreshDatasets,
      tradesRevision,
      notifyTradesChanged,
      loading,
      error,
    }),
    [
      datasets,
      activeDatasetId,
      setActiveDatasetId,
      refreshDatasets,
      tradesRevision,
      notifyTradesChanged,
      loading,
      error,
    ],
  );

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset() {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error('useDataset must be used within DatasetProvider');
  return ctx;
}