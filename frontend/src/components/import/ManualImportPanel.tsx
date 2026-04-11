import type { ManualImportRowInput } from '../../services/api';

interface ManualImportPanelProps {
  rows: ManualImportRowInput[];
  isSubmitting: boolean;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  onRowChange: <Field extends keyof ManualImportRowInput>(
    index: number,
    field: Field,
    value: ManualImportRowInput[Field],
  ) => void;
  onSubmit: () => void;
}

export default function ManualImportPanel({
  rows,
  isSubmitting,
  onAddRow,
  onRemoveRow,
  onRowChange,
  onSubmit,
}: ManualImportPanelProps) {
  const hasFilledRow = rows.some(
    (row) => row.symbol.trim() || row.entry_price.trim() || row.entry_time.trim(),
  );

  return (
    <section className="rounded-2xl border border-base-300 bg-base-200/70 p-5 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.24em] text-base-content/50">手动录入</p>
          <h2 className="text-lg font-semibold">补一笔也不用回 Excel</h2>
          <p className="max-w-3xl text-sm leading-6 text-base-content/70">
            先提供最小可用字段：交易对、方向、开仓价格和开仓时间。提交后仍然返回同一份行级报告。
          </p>
        </div>

        <button className="btn btn-outline btn-sm" onClick={onAddRow} type="button">
          添加一行
        </button>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => {
          const rowId = `manual-row-${index}`;
          return (
            <div key={rowId} className="rounded-xl bg-base-100/70 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">第 {index + 1} 行</p>
                {rows.length > 1 ? (
                  <button className="btn btn-ghost btn-xs" onClick={() => onRemoveRow(index)} type="button">
                    删除第 {index + 1} 行
                  </button>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="form-control w-full gap-2" htmlFor={`${rowId}-symbol`}>
                  <span className="label-text text-sm font-medium">交易对</span>
                  <input
                    id={`${rowId}-symbol`}
                    className="input input-bordered w-full"
                    value={row.symbol}
                    onChange={(event) => onRowChange(index, 'symbol', event.target.value)}
                  />
                </label>

                <label className="form-control w-full gap-2" htmlFor={`${rowId}-direction`}>
                  <span className="label-text text-sm font-medium">方向</span>
                  <select
                    id={`${rowId}-direction`}
                    className="select select-bordered w-full"
                    value={row.direction}
                    onChange={(event) => onRowChange(index, 'direction', event.target.value as ManualImportRowInput['direction'])}
                  >
                    <option value="long">做多</option>
                    <option value="short">做空</option>
                  </select>
                </label>

                <label className="form-control w-full gap-2" htmlFor={`${rowId}-entry-price`}>
                  <span className="label-text text-sm font-medium">开仓价格</span>
                  <input
                    id={`${rowId}-entry-price`}
                    className="input input-bordered w-full"
                    inputMode="decimal"
                    value={row.entry_price}
                    onChange={(event) => onRowChange(index, 'entry_price', event.target.value)}
                  />
                </label>

                <label className="form-control w-full gap-2" htmlFor={`${rowId}-entry-time`}>
                  <span className="label-text text-sm font-medium">开仓时间</span>
                  <input
                    id={`${rowId}-entry-time`}
                    className="input input-bordered w-full"
                    placeholder="2024-01-02 09:15:00"
                    value={row.entry_time}
                    onChange={(event) => onRowChange(index, 'entry_time', event.target.value)}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-base-content/60">
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-ghost">最小四字段</span>
          <span className="badge badge-ghost">支持追加多行</span>
          <span className="badge badge-ghost">复用同一份导入报告</span>
        </div>

        <button className="btn btn-primary" disabled={!hasFilledRow || isSubmitting} onClick={onSubmit} type="button">
          {isSubmitting ? '提交中…' : '提交手动记录'}
        </button>
      </div>
    </section>
  );
}
