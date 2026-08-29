import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Database, RefreshCw, Upload } from 'lucide-react';
import { useDataset } from '../context/DatasetContext';
import { importTrades, runBinanceSync } from '../services/api';
import { useToast } from './ToastHost';

function truncateMiddle(name: string, max = 36): string {
  if (name.length <= max) return name;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(-tail)}`;
}

export default function DatasetPicker() {
  const { toast } = useToast();
  const { datasets, activeDatasetId, setActiveDatasetId, loading, error, refreshDatasets, notifyTradesChanged } =
    useDataset();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 320 });

  const active = datasets.find((p) => p.id === activeDatasetId);
  const emptyLabel = error ? '表格加载失败' : '无表格';

  // owner 分组：self=我的 | master:*=高手 | sim=训练（docs/PRODUCT.md §三）
  const ownerGroups = [
    {
      key: 'self' as const,
      label: '我的',
      items: datasets.filter((d) => !d.owner.startsWith('master:') && d.owner !== 'sim'),
    },
    {
      key: 'masters' as const,
      label: '高手',
      items: datasets.filter((d) => d.owner.startsWith('master:')),
    },
    { key: 'sim' as const, label: '训练', items: datasets.filter((d) => d.owner === 'sim') },
  ];

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
      toast(`导入完成：${r.success} 笔成功，${r.failed} 笔跳过`, 'success');
      if (r.dataset_id != null) setActiveDatasetId(r.dataset_id);
      notifyTradesChanged();
      // Refresh outside the import's own error path: a failing list refetch must not
      // be reported as a failed import.
      try {
        await refreshDatasets();
      } catch {
        toast('表格列表刷新失败，请手动刷新页面', 'error');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '导入失败', 'error');
    } finally {
      setImportBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onBinanceSync = async () => {
    setSyncing(true);
    try {
      const r = await runBinanceSync();
      toast(`币安同步完成：新增 ${r.new_fills} 笔成交，共 ${r.trade_count} 笔持仓`, 'success');
      notifyTradesChanged();
      try {
        await refreshDatasets();
      } catch {
        /* list refresh failure is not a sync failure */
      }
      setOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : '币安同步失败', 'error');
    } finally {
      setSyncing(false);
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
          {ownerGroups.map(({ key, label, items }) => {
            if (items.length === 0) return null;
            return (
              <li key={key} aria-hidden={false}>
                <div className="px-3 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-weak)]">
                  {label}
                </div>
                <ul role="group" aria-label={label}>
                  {items.map((p) => {
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
              </li>
            );
          })}
        </ul>
        <div className="mt-1 border-t-2 border-[var(--border-weaker-base)] pt-1.5">
          <button
            type="button"
            className="oc-dropdown__item w-full"
            title="增量拉取币安合约成交（需在 backend/.env 配置只读 API Key）"
            onClick={() => void onBinanceSync()}
            disabled={syncing}
          >
            <RefreshCw className={`h-3.5 w-3.5 shrink-0 oc-text-brand ${syncing ? 'animate-spin' : ''}`} aria-hidden />
            <span className="min-w-0 leading-snug">{syncing ? '同步中…' : '同步币安合约'}</span>
          </button>
        </div>
      </div>,
      document.body,
    );

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.csv"
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
          <span className="truncate">{active ? truncateMiddle(active.name, 42) : emptyLabel}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 opacity-60 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {error ? (
        <span className="max-w-[16rem] truncate text-[12px] oc-text-loss" role="alert" title={error}>
          表格加载失败：{error}
        </span>
      ) : null}
      {listPanel}
    </div>
  );
}
