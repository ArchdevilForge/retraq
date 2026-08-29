import { X } from 'lucide-react';
import type { Hint } from '../utils/hints';

type Props = {
  hint: Hint;
  onDismiss: () => void;
};

/** 场景内上下文心法卡（docs/DESIGN.md §7）：可关闭，不遮挡关键行情。 */
export default function HintCard({ hint, onDismiss }: Props) {
  return (
    <div className="oc-hint-card" role="note">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold uppercase tracking-wide">{hint.title}</span>
        <button
          type="button"
          className="oc-icon-btn oc-icon-btn--sm"
          aria-label="关闭提示"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <ul className="mt-1.5 space-y-1 text-[12px] leading-snug">
        {hint.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
