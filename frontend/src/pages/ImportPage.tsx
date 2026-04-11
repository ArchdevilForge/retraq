import { useCallback, useState } from 'react';
import ImportContractNote from '../components/import/ImportContractNote';
import ImportDropzone from '../components/import/ImportDropzone';
import LocalSafekeepingPanel from '../components/import/LocalSafekeepingPanel';
import ManualImportPanel from '../components/import/ManualImportPanel';
import ImportResultsTable from '../components/import/ImportResultsTable';
import ImportSummary from '../components/import/ImportSummary';
import { importTradeRows, importTrades, type ManualImportRowInput } from '../services/api';
import type { ImportReport, ImportRowOutcome } from '../services/importTypes';

const createEmptyManualRow = (): ManualImportRowInput => ({
  symbol: '',
  direction: 'long',
  entry_price: '',
  entry_time: '',
});

export default function ImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [manualRows, setManualRows] = useState<ManualImportRowInput[]>([createEmptyManualRow()]);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | ImportRowOutcome['status']>('all');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasFileRejection = report?.status === 'file_rejected';

  const handleImportSuccess = useCallback((nextReport: ImportReport) => {
    setReport(nextReport);
    setStatusFilter('all');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedFile) {
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);

    try {
      handleImportSuccess(await importTrades(selectedFile));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导入失败，请稍后重试。');
    } finally {
      setIsUploading(false);
    }
  }, [handleImportSuccess, selectedFile]);

  const handleManualRowChange = useCallback(
    <Field extends keyof ManualImportRowInput>(
      index: number,
      field: Field,
      value: ManualImportRowInput[Field],
    ) => {
      setManualRows((currentRows) =>
        currentRows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
      );
    },
    [],
  );

  const handleAddManualRow = useCallback(() => {
    setManualRows((currentRows) => [...currentRows, createEmptyManualRow()]);
  }, []);

  const handleRemoveManualRow = useCallback((index: number) => {
    setManualRows((currentRows) => {
      if (currentRows.length === 1) {
        return currentRows;
      }

      return currentRows.filter((_, rowIndex) => rowIndex !== index);
    });
  }, []);

  const handleManualSubmit = useCallback(async () => {
    const rows = manualRows
      .filter((row) => row.symbol.trim() || row.entry_price.trim() || row.entry_time.trim())
      .map((row) => ({
        symbol: row.symbol.trim(),
        direction: row.direction,
        entry_price: row.entry_price.trim(),
        entry_time: row.entry_time.trim(),
      }));

    if (rows.length === 0) {
      return;
    }

    setIsSubmittingManual(true);
    setErrorMessage(null);

    try {
      handleImportSuccess(await importTradeRows(rows));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '手动录入失败，请稍后重试。');
    } finally {
      setIsSubmittingManual(false);
    }
  }, [handleImportSuccess, manualRows]);

  return (
    <div className="flex-1 overflow-y-auto bg-base-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.24em] text-base-content/50">Phase 1 import workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">导入交易复盘</h1>
          <p className="max-w-3xl text-base leading-7 text-base-content/70">
            支持 Excel 导入和手动复盘后的重复提交。系统会先告诉你它理解了什么，再给出成功、失败、重复和冲突的分层结果。
          </p>
        </header>

        <ImportDropzone
          file={selectedFile}
          isUploading={isUploading}
          onFileChange={setSelectedFile}
          onSubmit={handleSubmit}
        />

        <ManualImportPanel
          rows={manualRows}
          isSubmitting={isSubmittingManual}
          onAddRow={handleAddManualRow}
          onRemoveRow={handleRemoveManualRow}
          onRowChange={handleManualRowChange}
          onSubmit={handleManualSubmit}
        />

        <ImportContractNote />

        <LocalSafekeepingPanel importReport={report} />

        {errorMessage ? (
          <div className="alert alert-error">
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {report ? (
          <section className="space-y-4">
            {hasFileRejection ? (
              <div className="alert alert-warning">
                <span>文件被拒绝，先修复列头或必填列，再重新导入。</span>
              </div>
            ) : null}

            <ImportSummary summary={report.summary} />

            <ImportResultsTable
              report={report}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
