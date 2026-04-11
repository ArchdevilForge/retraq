import { useRef } from 'react';
import { CloudUpload } from 'lucide-react';

interface ImportDropzoneProps {
  file: File | null;
  isUploading: boolean;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
}

export default function ImportDropzone({ file, isUploading, onFileChange, onSubmit }: ImportDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="rounded-2xl border border-dashed border-primary/40 bg-base-200/60 p-6 transition-colors hover:border-primary/60">
      <button
        className="flex w-full flex-col gap-4 rounded-2xl text-left md:flex-row md:items-start md:justify-between"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const droppedFile = event.dataTransfer.files.item(0);
          onFileChange(droppedFile ?? null);
        }}
        type="button"
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <CloudUpload className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-base-content/50">上传 Excel</p>
              <h2 className="text-xl font-semibold">拖进来，或者点区域选文件</h2>
            </div>
          </div>

          <p className="max-w-2xl text-sm leading-6 text-base-content/70">
            这里不是一个隐藏弹窗，而是 Phase 1 的专属入口。先提交一笔历史交易表，系统会告诉你它是怎样理解列头、时间和重复记录的。
          </p>
        </div>

        <div className="flex flex-col gap-3 md:items-end">
          <div className="btn btn-outline btn-sm md:btn-md">选择 Excel 文件</div>
          <div className="text-right text-xs text-base-content/55">支持 .xlsx / .xls</div>
        </div>
      </button>

      <input
        ref={inputRef}
        aria-label="选择 Excel 文件"
        className="hidden"
        type="file"
        accept=".xlsx,.xls"
        onChange={(event) => onFileChange(event.target.files?.item(0) ?? null)}
      />

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
          <span className="badge badge-ghost">Excel</span>
          <span className="badge badge-ghost">单文件上传</span>
          <span className="badge badge-ghost">支持重复提交</span>
          <span className="badge badge-ghost">行级报告</span>
          {file ? <span className="badge badge-primary badge-outline">已选：{file.name}</span> : null}
        </div>

        <button className="btn btn-primary" disabled={!file || isUploading} onClick={onSubmit} type="button">
          {isUploading ? '导入中…' : '开始导入'}
        </button>
      </div>
    </section>
  );
}
