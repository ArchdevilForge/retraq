import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Database, Upload } from 'lucide-react';
import { useDataset } from '../context/DatasetContext';
import { importTrades } from '../services/api';
import { useToast } from './ToastHost';

function truncateMiddle(name: string, max = 36): string {
  if (name.length <= max) return name;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(-tail)}`;
}

export default function DatasetPicker() {
  const { toast } = useToast();
  const { datasets, activeDatasetId, setActiveDatasetId, loading, refreshDatasets, notifyTradesChanged } =
    useDataset();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 320 });

  const active = datasets.find((p) => p.id === activeDatasetId);

  const updatePanelPos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    let left = r.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPanelPos({ top: r.bottom + 6, left, width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPos();
    const onResize = () => updatePanelPos();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setImportBusy(true);
    try {
      const r = await importTrades(file, 'auto', { replace: true });
      await refreshDatasets();
      if (r.dataset_id != null) setActiveDatasetId(r.dataset_id);
      notifyTradesChanged();
      toast(`导入完成：${r.success} 笔成功，${r.failed} 笔跳过`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : '导入失败', 'error');
    } finally {
      setImportBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const listPanel =
    open &&
    datasets.length > 0 &&
    createPortal(
      <div
        ref={panelRef}
        className="oc-dropdown fixed z-[200] max-h-64 overflow-y-auto py-1"
        style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
      >
        <ul role="listbox">
          {datasets.map((p) => {
            const selected = p.id === activeDatasetId;
            return (
              <li key={p.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className={`oc-dropdown__item${selected ? ' oc-dropdown__item--selected' : ''}`}
                  title={p.name}
                  onClick={() => {
                    setActiveDatasetId(p.id);
                    setOpen(false);
                  }}
                >
                  <span
                    className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${selected ? 'bg-[var(--text-interactive-base)]' : 'bg-[var(--text-weaker)]'}`}
                  />
                  <span className="min-w-0 break-all leading-snug">{p.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>,
      document.body,
    );

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        disabled={importBusy}
        aria-label="导入表格文件"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className="oc-icon-btn oc-icon-btn--md oc-icon-btn--secondary"
        title="导入表格（自动识别交割单 / 币安）"
        aria-label="导入表格"
        disabled={importBusy}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-4 w-4 oc-text-brand" aria-hidden />
      </button>

      <button
        ref={triggerRef}
        type="button"
        disabled={loading || datasets.length === 0}
        className="oc-btn oc-btn--md oc-btn--secondary min-w-[8rem] max-w-[min(18rem,32vw)] shrink justify-between font-normal normal-case"
        title={active?.name ?? '切换表格'}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (loading || datasets.length === 0) return;
          setOpen((v) => !v);
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Database className="h-4 w-4 shrink-0 oc-text-brand" aria-hidden />
          <span className="truncate">{active ? truncateMiddle(active.name, 42) : '无表格'}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 opacity-60 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {listPanel}
    </div>
  );
}
