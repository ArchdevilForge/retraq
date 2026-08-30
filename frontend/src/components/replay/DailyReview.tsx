import { useEffect, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { fetchReviews, upsertReview } from '../../services/api';
import { useToast } from '../ToastHost';
import { periodKey } from '../../utils/review';

/**
 * 复盘页常驻「今日复盘」入口（docs/DESIGN.md §6 / docs/PRODUCT.md §三）。
 * 按钮嵌在图表工具条最右（不遮挡时间轴），展开卡片为右上浮层；
 * 一句话结论写全局时间线（daily period），与分析页复盘 tab 共享同一份数据。
 */
export default function DailyReview() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const todayKey = periodKey('daily', new Date());

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    fetchReviews('daily')
      .then((rows) => {
        if (!ignore) {
          const current = rows.find((r) => r.period_key === todayKey);
          if (current) setContent(current.content);
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [open, todayKey]);

  const save = async () => {
    const text = content.trim();
    if (!text) {
      toast('先写一句话结论再保存', 'warning');
      return;
    }
    setSaving(true);
    try {
      await upsertReview('daily', todayKey, text);
      // 评审定稿：保存后保持开着——写长结论不怕误关，随手能改；收起走按钮/点外部
      toast(`已保存今日结论（${todayKey}）`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`oc-btn oc-btn--sm oc-btn--secondary shrink-0${open ? ' oc-btn--primary' : ''}`}
        aria-label="打开今日复盘"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <NotebookPen className="h-3.5 w-3.5" aria-hidden />
        今日复盘
      </button>
      {open ? (
        <div
          className="panel-card fixed right-3 top-[64px] z-[60] max-h-[min(70vh,420px)] w-[320px] space-y-2 overflow-y-auto"
          data-testid="daily-review-card"
        >
          <div className="panel-card-title flex items-center justify-between">
            <span>今日复盘 · {todayKey}</span>
            <button
              type="button"
              className="oc-btn oc-btn--sm oc-btn--ghost"
              aria-label="收起今日复盘"
              onClick={() => setOpen(false)}
            >
              收起
            </button>
          </div>
          <textarea
            className="oc-input-wrap min-h-16 text-[13px]"
            placeholder="一句话结论：今天保持什么、改什么？"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button
            type="button"
            className="oc-btn oc-btn--sm oc-btn--primary w-full"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : '保存今日结论'}
          </button>
          <p className="text-[11px] oc-text-faint">结论存全局时间线，与分析页复盘 tab 同步，可随时回看。</p>
        </div>
      ) : null}
    </>
  );
}
