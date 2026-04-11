import { useCallback, useState } from 'react';
import { restoreSQLiteBackup } from '../../services/api';
import type { ImportReport } from '../../services/importTypes';

interface LocalSafekeepingPanelProps {
  importReport: ImportReport | null;
}

export default function LocalSafekeepingPanel({ importReport }: LocalSafekeepingPanelProps) {
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRestore = useCallback(async () => {
    if (!backupFile) {
      return;
    }

    setIsRestoring(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await restoreSQLiteBackup(backupFile);
      setBackupFile(null);
      setStatusMessage('SQLite 备份已恢复。');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '恢复失败，请稍后重试。');
    } finally {
      setIsRestoring(false);
    }
  }, [backupFile]);

  return (
    <section className="rounded-2xl border border-base-300 bg-base-200/70 p-5 space-y-4">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.24em] text-base-content/50">本地保全</p>
        <h2 className="text-lg font-semibold">本地保全</h2>
        <p className="max-w-3xl text-sm leading-6 text-base-content/70">
          这里保留导入明细、SQLite 备份和恢复入口，全部只面向本地文件。
        </p>
      </div>

      {statusMessage ? (
        <div className="alert alert-success">
          <span>{statusMessage}</span>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="alert alert-error">
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-xl bg-base-100/70 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-medium">导入明细 CSV</p>
          <p className="text-sm text-base-content/60">
            {importReport?.download_ref?.filename ?? '完成一次导入后，这里会出现 CSV 明细下载。'}
          </p>
        </div>

        {importReport?.download_ref ? (
          <a className="btn btn-outline btn-sm" href={importReport.download_ref.url}>
            下载明细 CSV
          </a>
        ) : (
          <span className="text-sm text-base-content/55">等待导入结果生成。</span>
        )}
      </div>

      <div className="space-y-3 rounded-xl bg-base-100/70 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium">SQLite 备份</p>
            <p className="text-sm text-base-content/60">导出当前本地数据库副本，恢复时也只接受同格式文件。</p>
          </div>

          <a className="btn btn-outline btn-sm" href="/api/backups/download">
            下载 SQLite 备份
          </a>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium" htmlFor="sqlite-backup-file">
              选择 SQLite 备份文件
            </label>
            <input
              id="sqlite-backup-file"
              aria-label="选择 SQLite 备份文件"
              className="file-input file-input-bordered w-full"
              type="file"
              accept=".sqlite3,.db,application/octet-stream"
              onChange={(event) => setBackupFile(event.target.files?.item(0) ?? null)}
            />
            <p className="text-xs text-base-content/55">仅支持本地 SQLite 备份文件。</p>
          </div>

          <button
            className="btn btn-primary"
            disabled={!backupFile || isRestoring}
            onClick={handleRestore}
            type="button"
          >
            {isRestoring ? '恢复中…' : '恢复 SQLite 备份'}
          </button>
        </div>
      </div>
    </section>
  );
}
