import type { Time } from 'lightweight-charts';
import type { RulerDrawStyle } from '../utils/chartTheme';

export type RulerCorner = { time: Time; price: number; x: number; y: number };

export type RulerMeasure = {
  priceDelta: number;
  pricePct: number;
  bars: number;
  durationSec: number;
};

export function timeToUnixSec(t: Time): number | null {
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  if (typeof t === 'object' && t && 'year' in t) {
    const { year, month, day } = t;
    return Math.floor(Date.UTC(year, month - 1, day) / 1000);
  }
  return null;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  if (sec < 3600) return `${Math.round(sec / 60)} 分`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} 时`;
  return `${(sec / 86400).toFixed(1)} 天`;
}

export function measureRuler(a: RulerCorner, b: RulerCorner, stepSec: number): RulerMeasure {
  const pa = a.price;
  const pb = b.price;
  const priceDelta = pb - pa;
  const pricePct = pa !== 0 ? (priceDelta / pa) * 100 : 0;
  const ta = timeToUnixSec(a.time);
  const tb = timeToUnixSec(b.time);
  let bars = 0;
  let durationSec = 0;
  if (ta != null && tb != null && stepSec > 0) {
    durationSec = Math.abs(tb - ta);
    bars = Math.max(1, Math.round(durationSec / stepSec));
  }
  return { priceDelta, pricePct, bars, durationSec };
}

export function drawRulerOnCanvas(
  canvas: HTMLCanvasElement,
  a: RulerCorner,
  b: RulerCorner,
  measure: RulerMeasure,
  style: RulerDrawStyle,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const x1 = a.x;
  const y1 = a.y;
  const x2 = b.x;
  const y2 = b.y;
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);

  ctx.fillStyle = style.rulerFill;
  ctx.strokeStyle = style.rulerStroke;
  ctx.lineWidth = 1;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.strokeRect(left, top, right - left, bottom - top);

  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  const sign = measure.priceDelta >= 0 ? '+' : '';
  const label = `${sign}${measure.priceDelta.toFixed(4)} (${sign}${measure.pricePct.toFixed(2)}%) · ${measure.bars} 根 · ${formatDuration(measure.durationSec)}`;
  const pad = 6;
  ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
  const tw = ctx.measureText(label).width;
  const lx = Math.min(x1, x2) + pad;
  const ly = Math.min(y1, y2) - pad;
  ctx.fillStyle = style.rulerLabelBg;
  ctx.fillRect(lx - 2, ly - 14, tw + pad * 2, 18);
  ctx.fillStyle = style.rulerLabelText;
  ctx.fillText(label, lx + pad - 2, ly);
}

export function clearRulerCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function syncOverlayCanvasSize(canvas: HTMLCanvasElement, container: HTMLElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = container.clientWidth;
  const h = container.clientHeight;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}