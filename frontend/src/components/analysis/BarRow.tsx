/** 横条图行（docs/PRODUCT.md §七 图表化拉满）：标签 + 比例条 + 数值；onClick 提供时整行可点（下钻复盘）。 */
export function BarRow({
  label,
  value,
  maxAbs,
  secondary,
  positive,
  title,
  onClick,
}: {
  label: string;
  value: number;
  maxAbs: number;
  secondary: string;
  positive: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const width = maxAbs > 0 ? Math.max(2, (Math.abs(value) / maxAbs) * 100) : 0;
  const bar = (
    <span className="h-4 min-w-0 flex-1 bg-[var(--surface-base)]">
      <span
        className={`block h-full ${positive ? 'bg-[var(--oc-profit)]/70' : 'bg-[var(--oc-loss)]/60'}`}
        style={{ width: `${width}%` }}
      />
    </span>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 text-left text-[12px] transition-colors hover:bg-[var(--surface-base-hover)]"
        title={title ?? `复盘 ${label}`}
        onClick={onClick}
      >
        <span className="w-24 shrink-0 truncate font-mono" title={label}>
          {label}
        </span>
        {bar}
        <span className={`w-24 shrink-0 text-right font-mono tabular-nums ${positive ? 'oc-text-profit' : 'oc-text-loss'}`}>
          {secondary}
        </span>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[12px]" title={title}>
      <span className="w-24 shrink-0 truncate font-mono" title={label}>
        {label}
      </span>
      {bar}
      <span className={`w-24 shrink-0 text-right font-mono tabular-nums ${positive ? 'oc-text-profit' : 'oc-text-loss'}`}>
        {secondary}
      </span>
    </div>
  );
}
