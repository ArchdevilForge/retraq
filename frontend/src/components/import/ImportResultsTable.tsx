import type { ReactNode } from 'react';
import type { FileValidationError, ImportReport, ImportRowOutcome, NormalizationEvent } from '../../services/importTypes';

interface ImportResultsTableProps {
  report: ImportReport;
  statusFilter: 'all' | ImportRowOutcome['status'];
  onStatusFilterChange: (status: 'all' | ImportRowOutcome['status']) => void;
}

const statusLabels: Record<ImportRowOutcome['status'], string> = {
  success: '成功',
  failed: '失败',
  duplicate: '重复',
  conflict: '冲突',
};

const statusBadgeClasses: Record<ImportRowOutcome['status'], string> = {
  success: 'badge-success',
  failed: 'badge-error',
  duplicate: 'badge-warning',
  conflict: 'badge-info',
};

function valueLabel(value: string[] | undefined) {
  return value && value.length > 0 ? value.join('、') : '—';
}

function formatScalar(value: ImportRowOutcome['raw_value']) {
  return value === null ? '—' : String(value);
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function renderFileValidationErrors(errors: FileValidationError[]) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-error/30 bg-error/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-error">文件被拒绝</h3>
        <span className="badge badge-error badge-outline">{errors.length} 个错误</span>
      </div>
      <ul className="mt-3 space-y-2 text-sm text-base-content/80">
        {errors.map((error) => (
          <li key={`${error.code}-${error.message}`} className="rounded-xl bg-base-100/80 p-3">
            <p className="font-medium">{error.message}</p>
            {error.missing_columns ? (
              <p className="mt-1 text-base-content/60">缺失列：{valueLabel(error.missing_columns)}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function renderNormalizationEvents(events: NormalizationEvent[]) {
  if (events.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-info/20 bg-info/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-info">归一化证据</h3>
        <span className="badge badge-info badge-outline">{events.length} 条</span>
      </div>
      <div className="mt-3 space-y-2">
        {events.map((event) => (
          <div key={`${event.row_number}-${event.field}-${event.reason}`} className="rounded-xl bg-base-100/80 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-base-content/70">
              <span className="badge badge-ghost">第 {event.row_number} 行</span>
              <span className="font-medium text-base-content">{event.field}</span>
            </div>
            <p className="mt-1">{event.reason}</p>
            <p className="mt-1 text-base-content/60">{formatScalar(event.raw_value)} → {formatScalar(event.normalized_value)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ImportResultsTable({ report, statusFilter, onStatusFilterChange }: ImportResultsTableProps) {
  const filteredRows =
    statusFilter === 'all' ? report.row_outcomes : report.row_outcomes.filter((row) => row.status === statusFilter);

  return (
    <section className="space-y-4">
      {renderFileValidationErrors(report.file_validation_errors)}
      {renderNormalizationEvents(report.normalization_events)}

      {report.row_outcomes.length > 0 ? (
        <section className="rounded-2xl border border-base-300 bg-base-200/70 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-base font-semibold">处理结果</h3>
              <p className="text-sm text-base-content/60">按行查看成功、失败、重复和冲突，方便快速确认系统如何理解这次导入。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterButton active={statusFilter === 'all'} onClick={() => onStatusFilterChange('all')}>
                全部
              </FilterButton>
              {(['failed', 'duplicate', 'conflict'] as const).map((status) => (
                <FilterButton key={status} active={statusFilter === status} onClick={() => onStatusFilterChange(status)}>
                  {statusLabels[status]}
                </FilterButton>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>行号</th>
                  <th>状态</th>
                  <th>字段</th>
                  <th>原值</th>
                  <th>归一化值</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={`${row.row_number}-${row.field}-${row.reason}`}>
                    <td>{row.row_number}</td>
                    <td>
                      <span className={`badge ${statusBadgeClasses[row.status]}`}>
                        {statusLabels[row.status]}
                      </span>
                    </td>
                    <td className="font-medium">{row.field}</td>
                    <td className="max-w-44 truncate">{formatScalar(row.raw_value)}</td>
                    <td className="max-w-44 truncate">{row.normalized_value == null ? '—' : String(row.normalized_value)}</td>
                    <td className="max-w-lg text-sm text-base-content/70">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}
