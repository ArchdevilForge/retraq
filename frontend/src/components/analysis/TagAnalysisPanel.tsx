import { useEffect, useState } from 'react';
import {
  fetchDiscipline,
  fetchErrorStats,
  fetchRDistribution,
  fetchSetupStats,
  type DisciplineStat,
  type ErrorStat,
  type OwnerGroup,
  type RDistribution,
  type SetupStat,
} from '../../services/api';
import { fmtMoney } from '../../utils/format';

type Props = { className?: string };

function BarRow({
  label,
  value,
  maxAbs,
  secondary,
  positive,
}: {
  label: string;
  value: number;
  maxAbs: number;
  secondary: string;
  positive: boolean;
}) {
  const width = maxAbs > 0 ? Math.max(2, (Math.abs(value) / maxAbs) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[12px]">
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

function SimCompareNote<T>({ data }: { data: OwnerGroup<T> }) {
  if (!data.sim) return null;
  return <p className="text-[12px] oc-text-faint">含训练（sim）对比视角：self 为主视图。</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="oc-card oc-card--bordered">
      <h2 className="oc-card__title">{title}</h2>
      {children}
    </div>
  );
}

function SetupBlocks({ stats }: { stats: OwnerGroup<SetupStat[]> }) {
  const rows = stats.self;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.total_profit)), 1);
  if (rows.length === 0) return <p className="text-[13px] oc-text-faint">还没有带 setup 标签的交易——在复盘中给持仓打标签后出现。</p>;
  return (
    <div className="space-y-3">
      <SimCompareNote data={stats} />
      <div className="space-y-1.5">
        {[...rows]
          .sort((a, b) => b.total_profit - a.total_profit)
          .map((r) => (
            <BarRow
              key={r.tag}
              label={r.tag}
              value={r.total_profit}
              maxAbs={maxAbs}
              positive={r.total_profit >= 0}
              secondary={`${fmtMoney(r.total_profit)} U`}
            />
          ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.tag} className="panel-card">
            <div className="truncate font-mono text-[12px]" title={r.tag}>
              {r.tag}
            </div>
            <div className="mt-1 font-mono tabular-nums">
              {r.trade_count} 笔 · 胜率 {r.win_rate != null ? `${(r.win_rate * 100).toFixed(0)}%` : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorBlocks({ stats }: { stats: OwnerGroup<ErrorStat[]> }) {
  const rows = stats.self;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.total_profit)), 1);
  if (rows.length === 0) return <p className="text-[13px] oc-text-faint">没有错误分类记录——好事，或者还没标注。</p>;
  return (
    <div className="space-y-3">
      <SimCompareNote data={stats} />
      <div className="space-y-1.5">
        {[...rows]
          .sort((a, b) => a.total_profit - b.total_profit)
          .map((r) => (
            <BarRow
              key={r.tag}
              label={r.tag}
              value={r.total_profit}
              maxAbs={maxAbs}
              positive={false}
              secondary={`${fmtMoney(r.total_profit)} U`}
            />
          ))}
      </div>
    </div>
  );
}

function RBlocks({ dist }: { dist: OwnerGroup<RDistribution> }) {
  const block = dist.self;
  const max = Math.max(...block.buckets.map((b) => b.count), 1);
  return (
    <div className="space-y-2">
      <SimCompareNote data={dist} />
      <div className="flex items-end gap-1.5">
        {block.buckets.map((b) => (
          <div key={b.bucket} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-24 w-full items-end bg-[var(--surface-base)]">
              <div
                className={`w-full ${b.bucket.startsWith('-') || b.bucket.startsWith('≤') ? 'bg-[var(--oc-loss)]/60' : 'bg-[var(--oc-profit)]/70'}`}
                style={{ height: `${Math.max(2, (b.count / max) * 100)}%` }}
                title={`${b.bucket}R · ${b.count} 笔`}
              />
            </div>
            <span className="font-mono text-[10px] oc-text-faint">{b.bucket}</span>
          </div>
        ))}
      </div>
      <p className="text-[12px] oc-text-faint">
        平均 R：{block.avg_r != null ? block.avg_r.toFixed(2) : '—'} · 未标注计划止损 {block.without_stop} 笔（不计入分布）
      </p>
    </div>
  );
}

function DisciplineBlock({ stat }: { stat: OwnerGroup<DisciplineStat> }) {
  const block = stat.self;
  const rate = block.annotated > 0 ? block.clean / block.annotated : null;
  return (
    <div className="space-y-2">
      <SimCompareNote data={stat} />
      <div className="oc-stat-grid oc-stat-grid--cols-2">
        <div className="oc-stat">
          <div className="oc-stat__label">纪律遵守率</div>
          <div className={`oc-stat__value ${rate != null && rate >= 0.7 ? 'oc-text-profit' : rate == null ? '' : 'oc-text-loss'}`}>
            {rate != null ? `${(rate * 100).toFixed(0)}%` : '—'}
          </div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat__label">已标注 / 未标注</div>
          <div className="oc-stat__value">
            {block.annotated} / {block.unannotated}
          </div>
        </div>
      </div>
      <p className="text-[12px] oc-text-faint">
        {block.annotated} 笔已标注中 {block.clean} 笔无错误分类，{block.with_error} 笔带错误标签。
      </p>
    </div>
  );
}

/** 标签报告（docs/PRODUCT.md §七）：图表化，默认 self，可切 sim 对比。 */
export default function TagAnalysisPanel({ className = '' }: Props) {
  const [includeSim, setIncludeSim] = useState(false);
  const [setup, setSetup] = useState<OwnerGroup<SetupStat[]> | null>(null);
  const [errors, setErrors] = useState<OwnerGroup<ErrorStat[]> | null>(null);
  const [rDist, setRDist] = useState<OwnerGroup<RDistribution> | null>(null);
  const [discipline, setDiscipline] = useState<OwnerGroup<DisciplineStat> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    Promise.all([fetchSetupStats(includeSim), fetchErrorStats(includeSim), fetchRDistribution(includeSim), fetchDiscipline(includeSim)])
      .then(([s, e, r, d]) => {
        if (ignore) return;
        setSetup(s);
        setErrors(e);
        setRDist(r);
        setDiscipline(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!ignore) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      ignore = true;
    };
  }, [includeSim]);

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px]">
        <input type="checkbox" checked={includeSim} onChange={(e) => setIncludeSim(e.target.checked)} />
        对比训练（sim）数据
      </label>

      {error ? (
        <p className="text-[13px] oc-text-loss" role="alert">
          标签统计加载失败：{error}
        </p>
      ) : !setup || !errors || !rDist || !discipline ? (
        <div className="flex h-40 items-center justify-center">
          <span className="oc-spinner" aria-label="加载中…" />
        </div>
      ) : (
        <>
          <Section title="Setup 表现（按累计盈亏）">
            <SetupBlocks stats={setup} />
          </Section>
          <Section title="错误代价（按累计盈亏）">
            <ErrorBlocks stats={errors} />
          </Section>
          <Section title="R 值分布（按计划止损归一）">
            <RBlocks dist={rDist} />
          </Section>
          <Section title="纪律遵守率">
            <DisciplineBlock stat={discipline} />
          </Section>
        </>
      )}
    </div>
  );
}
