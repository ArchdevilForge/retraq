import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  fetchAnnotation,
  fetchAnnotationPresets,
  upsertAnnotation,
  type AnnotationPresets,
  type AnnotationSubjectType,
  type TradeAnnotation,
} from '../services/api';
import { useToast } from './ToastHost';

const SAVE_DEBOUNCE_MS = 800;

type Props = {
  subjectType: AnnotationSubjectType;
  subjectId: number | null;
};

const EMPTY: Omit<TradeAnnotation, 'subject_type' | 'subject_id' | 'updated_at'> = {
  note: null,
  setup_tags: [],
  error_tags: [],
  grade: null,
  emotion: null,
  planned_stop: null,
  planned_target: null,
};

/**
 * 持仓标注编辑器（docs/DESIGN.md §6）：笔记/setup/错误标签/评分/情绪/计划止损目标。
 * 写入自动保存；保存失败才 toast（docs/DESIGN.md §6）。
 */
export default function AnnotationEditor({ subjectType, subjectId }: Props) {
  const { toast } = useToast();
  const [value, setValue] = useState(EMPTY);
  const [presets, setPresets] = useState<AnnotationPresets | null>(null);
  const [customSetup, setCustomSetup] = useState('');
  const [customError, setCustomError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const latestRef = useRef(value);
  useEffect(() => {
    latestRef.current = value;
  }, [value]);

  useEffect(() => {
    setLoaded(false);
    setValue(EMPTY);
    if (subjectId == null) return;
    let ignore = false;
    fetchAnnotation(subjectType, subjectId)
      .then((a) => {
        if (ignore) return;
        setValue({
          note: a.note,
          setup_tags: a.setup_tags,
          error_tags: a.error_tags,
          grade: a.grade,
          emotion: a.emotion,
          planned_stop: a.planned_stop,
          planned_target: a.planned_target,
        });
        setLoaded(true);
      })
      .catch(() => {
        if (!ignore) setLoaded(true); // edit against the default shape; save will create the row
      });
    return () => {
      ignore = true;
    };
  }, [subjectType, subjectId]);

  useEffect(() => {
    fetchAnnotationPresets()
      .then(setPresets)
      .catch(() => setPresets(null));
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const sid = subjectId;
      if (sid == null) return;
      setSaving(true);
      upsertAnnotation(subjectType, sid, latestRef.current)
        .catch((err: unknown) => {
          toast(err instanceof Error ? err.message : '标注保存失败', 'error');
        })
        .finally(() => setSaving(false));
    }, SAVE_DEBOUNCE_MS);
  }, [subjectType, subjectId, toast]);

  useEffect(
    () => () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const update = useCallback(
    (patch: Partial<typeof EMPTY>) => {
      setValue((prev) => ({ ...prev, ...patch }));
      scheduleSave();
    },
    [scheduleSave],
  );

  const toggleTag = useCallback(
    (key: 'setup_tags' | 'error_tags', tag: string) => {
      setValue((prev) => {
        const current = prev[key];
        const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
        return { ...prev, [key]: next };
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const addCustomTag = useCallback(
    (key: 'setup_tags' | 'error_tags', raw: string, reset: () => void) => {
      const tag = raw.trim();
      if (!tag) return;
      if (!latestRef.current[key].includes(tag)) update({ [key]: [...latestRef.current[key], tag] });
      reset();
    },
    [update],
  );

  if (subjectId == null) return null;

  const tagChips = (key: 'setup_tags' | 'error_tags', presetList: string[] | undefined, custom: string, setCustom: (v: string) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {[...new Set([...(presetList ?? []), ...value[key]])].map((tag) => {
        const active = value[key].includes(tag);
        return (
          <button
            key={tag}
            type="button"
            className={`oc-btn oc-btn--sm${active ? ' oc-btn--primary' : ' oc-btn--secondary'}`}
            onClick={() => toggleTag(key, tag)}
          >
            {tag}
          </button>
        );
      })}
      <input
        className="oc-input-wrap w-24 px-2 py-0.5 text-[12px]"
        placeholder="+ 自定义"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') addCustomTag(key, custom, () => setCustom(''));
        }}
      />
    </div>
  );

  return (
    <div className="panel-card space-y-3" data-loaded={loaded}>
      <div className="panel-card-title flex items-center justify-between">
        <span>复盘标注</span>
        {saving ? (
          <span className="flex items-center gap-1 text-[11px] oc-text-faint">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> 保存中
          </span>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <div className="text-[12px] oc-text-faint">评分</div>
        <div className="flex gap-1.5">
          {(presets?.grades ?? ['A+', 'A', 'B', 'C']).map((g) => (
            <button
              key={g}
              type="button"
              className={`oc-btn oc-btn--sm${value.grade === g ? ' oc-btn--primary' : ' oc-btn--secondary'}`}
              onClick={() => update({ grade: value.grade === g ? null : g })}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-[12px] oc-text-faint">情绪</div>
        <div className="flex flex-wrap gap-1.5">
          {(presets?.emotions ?? []).map((emo) => (
            <button
              key={emo}
              type="button"
              className={`oc-btn oc-btn--sm${value.emotion === emo ? ' oc-btn--primary' : ' oc-btn--secondary'}`}
              onClick={() => update({ emotion: value.emotion === emo ? null : emo })}
            >
              {emo}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-[12px] oc-text-faint">Setup 标签</div>
        {tagChips('setup_tags', presets?.setup_tags, customSetup, setCustomSetup)}
      </div>

      <div className="space-y-1.5">
        <div className="text-[12px] oc-text-faint">错误分类</div>
        {tagChips('error_tags', presets?.error_tags, customError, setCustomError)}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[12px] oc-text-faint">
          计划止损
          <input
            type="number"
            step="any"
            className="oc-input-wrap tabular-nums"
            value={value.planned_stop ?? ''}
            onChange={(e) => update({ planned_stop: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] oc-text-faint">
          计划目标
          <input
            type="number"
            step="any"
            className="oc-input-wrap tabular-nums"
            value={value.planned_target ?? ''}
            onChange={(e) => update({ planned_target: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-[12px] oc-text-faint">
        笔记
        <textarea
          className="oc-input-wrap min-h-20 text-[13px]"
          placeholder="这笔交易做对了什么？下次改什么？"
          value={value.note ?? ''}
          onChange={(e) => update({ note: e.target.value })}
        />
      </label>
    </div>
  );
}
