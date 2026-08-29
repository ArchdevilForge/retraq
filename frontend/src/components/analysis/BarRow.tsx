/** 横条图行（docs/PRODUCT.md §七 图表化拉满）：标签 + 比例条 + 数值。 */
export function BarRow({
  label,
  value,
  maxAbs,
  secondary,
  positive,
  title,
}: {
  label: string;
  value: number;
  maxAbs: number;
  secondary: string;
  positive: boolean;
  title?: string;
}) {
  const width = maxAbs > 0 ? Math.max(2, (Math.abs(value) / maxAbs) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[12px]" title={title}>
      <span className="w-24 shrink-0 truncate font-mono" title={label}>
        {label}
      </span>
      <div className="h-4 min-w-0 flex-1 bg-[var(--surface-base)]">
        <div
          className={`h-full ${positive ? 'bg-[var(--oc-profit)]/70' : 'bg-[var(--oc-loss)]/60'}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`w-24 shrink-0 text-right font-mono tabular-nums ${positive ? 'oc-text-profit' : 'oc-text-loss'}`}>
        {secondary}
      </span>
    </div>
  );
}
