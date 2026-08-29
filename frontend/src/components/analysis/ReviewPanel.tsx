import { useEffect, useMemo, useState } from 'react';
import {
  fetchReviewChecklists,
  fetchReviews,
  upsertReview,
  type ReviewChecklist,
  type ReviewNote,
} from '../../services/api';
import { useToast } from '../ToastHost';
import { fmtDateTime } from '../../utils/format';
import { periodKey } from '../../utils/review';

type Props = { className?: string };

function CadenceBlock({ checklist }: { checklist: ReviewChecklist }) {
  const { toast } = useToast();
  const currentKey = useMemo(() => periodKey(checklist.cadence, new Date()), [checklist.cadence]);
  const [content, setContent] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    fetchReviews(checklist.cadence)
      .then((rows) => {
        if (ignore) return;
        const current = rows.find((r) => r.period_key === currentKey);
        if (current) {
          setContent(current.content);
          setSavedKey(current.period_key);
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [checklist.cadence, currentKey]);

  const save = async () => {
    const text = content.trim();
    if (!text) {
      toast('先写一句话结论再保存', 'warning');
      return;
    }
    setSaving(true);
    try {
      await upsertReview(checklist.cadence, currentKey, text);
      setSavedKey(currentKey);
      toast(`已保存 ${checklist.label}结论（${currentKey}）`, 'success');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : '复盘结论保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="oc-card oc-card--bordered">
      <h2 className="oc-card__title">{checklist.label}</h2>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13px]">
        {checklist.questions.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ol>
      <label className="flex flex-col gap-1 text-[12px] oc-text-faint">
        一句话结论 · 本期 {currentKey}
        <textarea
          className="oc-input-wrap min-h-16 text-[13px]"
          placeholder="按清单过一遍，写一句话结论"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </label>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="oc-btn oc-btn--sm oc-btn--primary" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : savedKey === currentKey ? '更新本期结论' : '保存本期结论'}
        </button>
        {savedKey === currentKey ? <span className="text-[12px] oc-text-faint">本期已保存</span> : null}
      </div>
    </div>
  );
}

function HistoryTimeline() {
  const [notes, setNotes] = useState<ReviewNote[] | null>(null);

  useEffect(() => {
    let ignore = false;
    fetchReviews()
      .then((rows) => {
        if (!ignore) setNotes(rows);
      })
      .catch(() => {
        if (!ignore) setNotes([]);
      });
    return () => {
      ignore = true;
    };
  }, []);

  if (!notes) {
    return (
      <div className="flex h-24 items-center justify-center">
        <span className="oc-spinner oc-spinner--sm" aria-label="加载中…" />
      </div>
    );
  }
  if (notes.length === 0) {
    return <p className="text-[13px] oc-text-faint">还没有复盘结论。写下的结论存在全局时间线，与数据集无关，随时回看。</p>;
  }
  return (
    <ul className="space-y-2">
      {notes.map((n) => (
        <li key={n.id} className="panel-card text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[12px] oc-text-faint">
              {n.period_key} · {n.cadence === 'daily' ? '日' : n.cadence === 'weekly' ? '周' : '月'}
            </span>
          {n.updated_at ? (
            <span className="font-mono text-[10px] oc-text-faint">{fmtDateTime(Date.parse(n.updated_at))}</span>
          ) : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap leading-snug">{n.content}</p>
        </li>
      ))}
    </ul>
  );
}

/** 复盘节奏（docs/PRODUCT.md §三）：日/周/月清单驱动 + 全局时间线结论。 */
export default function ReviewPanel({ className = '' }: Props) {
  const [checklists, setChecklists] = useState<ReviewChecklist[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetchReviewChecklists()
      .then((rows) => {
        if (!ignore) setChecklists(rows);
      })
      .catch((err: unknown) => {
        if (!ignore) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {error ? (
        <p className="text-[13px] oc-text-loss" role="alert">
          复盘清单加载失败：{error}
        </p>
      ) : !checklists ? (
        <div className="flex h-40 items-center justify-center">
          <span className="oc-spinner" aria-label="加载中…" />
        </div>
      ) : (
        <>
          {checklists.map((c) => (
            <CadenceBlock key={c.cadence} checklist={c} />
          ))}
          <div className="oc-card oc-card--bordered">
            <h2 className="oc-card__title">结论时间线</h2>
            <HistoryTimeline />
          </div>
        </>
      )}
    </div>
  );
}
