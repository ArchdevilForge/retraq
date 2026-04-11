import type { ImportSummary as ImportSummaryType } from '../../services/importTypes';

interface ImportSummaryProps {
  summary: ImportSummaryType;
}

const items = [
  { key: 'success', label: '成功', tone: 'text-success' },
  { key: 'failed', label: '失败', tone: 'text-error' },
  { key: 'duplicate', label: '重复', tone: 'text-warning' },
  { key: 'conflict', label: '冲突', tone: 'text-info' },
  { key: 'timestamp_normalization', label: '时间归一', tone: 'text-primary' },
] as const;

export default function ImportSummary({ summary }: ImportSummaryProps) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div key={item.key} className="rounded-2xl border border-base-300 bg-base-200/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-base-content/50">{item.label}</p>
          <p className={`mt-2 text-3xl font-semibold ${item.tone}`}>
            {item.label} {summary[item.key]}
          </p>
        </div>
      ))}
    </section>
  );
}
