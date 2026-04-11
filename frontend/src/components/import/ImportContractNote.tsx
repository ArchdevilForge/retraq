export default function ImportContractNote() {
  return (
    <section className="rounded-2xl border border-base-300 bg-base-200/70 p-5 space-y-3">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.24em] text-base-content/50">导入契约</p>
        <h2 className="text-lg font-semibold">先看系统怎么理解你的表</h2>
      </div>

      <div className="grid gap-3 text-sm text-base-content/80 md:grid-cols-3">
        <div className="rounded-xl bg-base-100/70 p-3">
          <p className="font-medium text-base-content">必填列</p>
          <p className="mt-1">symbol、entry_price、entry_time</p>
        </div>
        <div className="rounded-xl bg-base-100/70 p-3">
          <p className="font-medium text-base-content">系统会归一</p>
          <p className="mt-1">时区时间、数字格式、常见列头别名</p>
        </div>
        <div className="rounded-xl bg-base-100/70 p-3">
          <p className="font-medium text-base-content">重复、冲突、缺列、无法解析的行会被单独标出</p>
          <p className="mt-1">方便你回到 Excel 逐行修正。</p>
        </div>
      </div>
    </section>
  );
}
