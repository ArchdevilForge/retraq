/**
 * DESIGN §11 设计要素护栏：把「规范里写了但代码里违背」的偏差钉成红灯。
 *
 * 历史证据（这些偏差都曾长期存在，靠人眼审查拦不住）：
 *   py-0.2 死类名 / rounded-md·lg / z-index 裸值 / h-4 w-4 图标 / text-[18px] 阶梯外字号。
 *
 * 用 Vite 的 ?raw 与 import.meta.glob 读取源码文本，无需 node 类型，纯文本扫描，
 * 不依赖浏览器与后端，任何新增违规都会在这里失败。
 */

import { describe, expect, it } from 'vitest';

import cssText from './opencode.css?raw';
import indexCss from '../index.css?raw';

// glob 相对本文件；排除测试自身
const RAW = import.meta.glob('../**/*.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const TSX: { path: string; text: string }[] = Object.entries(RAW)
  .filter(([path]) => !/\.test\.tsx$/.test(path))
  .map(([path, text]) => ({ path: path.replace(/^\.\.\//, ''), text }));

/** 收集匹配，返回 `file:line  片段` 便于定位。 */
function find(re: RegExp, files = TSX): string[] {
  const hits: string[] = [];
  for (const { path, text } of files) {
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${path}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
    re.lastIndex = 0;
  }
  return hits;
}

/** 扫描 CSS 行，列出违反 `bad` 定位的行。 */
function findCss(bad: RegExp, label: string, source = cssText): string[] {
  return source
    .split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => bad.test(line))
    .map(({ line, i }) => `${label}:${i + 1}  ${line.trim()}`);
}

describe('DESIGN §11.1 圆角', () => {
  it('禁用 Tailwind 默认圆角尺度（rounded-md/-lg/-full/-t-*）', () => {
    expect(find(/\brounded(-(md|lg|full|t|b|l|r|tl|tr|bl|br)(-[a-z0-9]+)?)\b/)).toEqual([]);
  });

  it('CSS 不裸写 border-radius 字面值', () => {
    expect(findCss(/border-radius:\s*(?!var\(|50%)\S/, 'opencode.css')).toEqual([]);
  });
});

describe('DESIGN §3 语义色完整性', () => {
  it('失败/亏损语义底色必为红系，不得误用绿系', () => {
    // 防回归：深色 --surface-critical-weak 曾被写成 rgba(48,209,88,0.1)（成功绿），
    // 导致做空/亏损行显示绿色背景。语义名与色相必须一致。
    const grab = (name: string): string[] => {
      const re = new RegExp(`${name}:\\s*([^;]+);`, 'g');
      return [...cssText.matchAll(re)].map((m) => m[1].trim());
    };
    const critical = [...grab('--surface-critical-weak'), ...grab('--surface-critical-base')];
    expect(critical.length, '应能扫到 critical 语义令牌').toBeGreaterThan(0);
    for (const v of critical) {
      expect(v, `失败语义应是红系: ${v}`).toMatch(/(255,\s*59,\s*48|#ff3b30|#c41e12)/i);
    }
  });

  it('成功/盈利语义底色必为绿系', () => {
    const grab = (name: string): string[] => {
      const re = new RegExp(`${name}:\\s*([^;]+);`, 'g');
      return [...cssText.matchAll(re)].map((m) => m[1].trim());
    };
    for (const v of [...grab('--surface-success-weak'), ...grab('--surface-success-base')]) {
      expect(v, `成功语义应是绿系: ${v}`).toMatch(/(48,\s*209,\s*88|#30d158|#248a3d)/i);
    }
  });

  it('深浅两套主题都定义了完整语义层', () => {
    for (const token of ['--surface-critical-weak', '--surface-success-weak', '--oc-profit', '--oc-loss']) {
      const n = [...cssText.matchAll(new RegExp(`${token}:`, 'g'))].length;
      expect(n, `${token} 应在 :root 与 [data-theme="dark"] 都定义`).toBeGreaterThanOrEqual(2);
    }
  });

  it('§3 文字明度阶梯完整四档，深浅主题各自定义', () => {
    // 防回归：规范表曾漏掉 --text-weaker 且深色列错位一格。
    for (const token of ['--text-strong', '--text-base', '--text-weak', '--text-weaker']) {
      const n = [...cssText.matchAll(new RegExp(`${token}:`, 'g'))].length;
      expect(n, `${token} 应在浅/深两套主题都定义`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('DESIGN §11.4 边框', () => {
  it('CSS 不裸写结构性/分隔线宽（必须走 --oc-border-* 令牌）', () => {
    // 防回归：曾定义了 --oc-border-hairline/structural 但 30+ 条规则仍硬编码 1px/2px。
    // 豁免：令牌定义行自身、border-radius（上文）、outline。
    expect(
      findCss(/^\s*border(-[a-z]+)?:\s*[0-9.]+px\b(?!\s*solid\s*var\(--oc-border-)/, 'opencode.css'),
    ).toEqual([]);
  });
});

describe('DESIGN §11.2 间距 / §4.3 字号', () => {
  it('无 Tailwind 无法生成的死类名（py-0.2 / px-1.2 / py-0.75 类）', () => {
    // Tailwind v4 动态间距只覆盖 0.5 的倍数；非 0.5 倍数不生成 CSS，写等于没写
    expect(find(/\b-?[pm][xytrbl]?-\d+\.(?!5\b)\d\b/)).toEqual([]);
  });

  it('CSS 间距值落在 2px 网格上（无奇数 px）', () => {
    // §11.2：基准 2px，半档 2/6/10/14 合法；奇数 px 禁止。
    // 豁免 .sr-only 的 clip 矩技（-1px 是屏幕阅读器惯例，不是间距选择）。
    const srOnly = cssText.slice(cssText.indexOf('.sr-only {'), cssText.indexOf('.sr-only {') + 220);
    const bad = cssText
      .split('\n')
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /^\s*(gap|padding|margin)(-[a-z]+)?:\s/.test(line))
      .filter(({ line }) => !srOnly.includes(line))
      .filter(({ line }) => {
        const nums = [...line.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
        return nums.some((n) => n % 2 !== 0);
      })
      .map(({ line, i }) => `opencode.css:${i + 1}  ${line.trim()}`);
    expect(bad).toEqual([]);
  });

  it('无阶梯外字号 text-[Npx]', () => {
    expect(find(/text-\[[0-9]+px\]/)).toEqual([]);
  });

  it('无 Tailwind 默认字号尺度（text-xs/sm/base/lg/xl…）', () => {
    // 只扫 class 属性内部；后缀必须是空白/引号/大括号，避免误伤 var(--oc-text-base) 令牌名
    expect(find(/class(?:Name)?="[^"]*\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)(?=[\s"'])/)).toEqual([]);
    expect(find(/className=\{`[^`]*\btext-(xs|sm|base|lg|xl)(?=[\s`])/)).toEqual([]);
  });
});

describe('DESIGN §11.5 图标尺寸', () => {
  it('无 Tailwind 默认图标尺寸 h-N w-N', () => {
    // 豁免：图形类元素（h-1.5 圆点 / 头像框 h-control-* / 分数值 h-8+）
    expect(find(/\bh-(2\.5|3|3\.5|4|5)\s+w-(2\.5|3|3\.5|4|5)\b/)).toEqual([]);
  });

  it('控件高度不用 Tailwind 字面类（h-7 等）覆盖 §11.3 令牌', () => {
    // 防回归：oc-btn--sm + h-7(28px) 重复声明高度，令牌一变就漂移。
    // 豁免 <svg> 外的大尺寸、skeleton 占位、图形容器（此处只查控件类同行）。
    const bad: string[] = [];
    for (const { path, text } of TSX) {
      for (const line of text.split('\n')) {
        if (!/oc-(btn|icon-btn|tab|chip|input|select)/.test(line)) continue;
        // 只看独立的 h-N，不匹配 min-h-20 / max-h-64 这类前缀词
        const m = line.match(/(?<![\w-])h-(\d+)\b/);
        if (m) bad.push(`${path}  h-${m[1]}  ${line.trim().slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('DESIGN §11.6 层级', () => {
  it('TSX 不裸写 z-index 数值工具类', () => {
    expect(find(/\bz-\[?\d+/)).toEqual([]);
  });

  it('CSS 不裸写 z-index 数值', () => {
    expect(findCss(/z-index:\s*(?!var\()\S/, 'opencode.css')).toEqual([]);
  });
});

describe('DESIGN §4.2 图标可访问性', () => {
  it('装饰性图标（在带文字的控件内）必带 aria-hidden', () => {
    // 只扫「尺寸类 = h-icon-*」的 lucide 图标 — 它们总是装饰性。
    // 功能性图标靠 title / aria-label / 相邻文字提供名称，此处不作强制。
    const bad: string[] = [];
    for (const { path, text } of TSX) {
      for (const m of text.matchAll(/<([A-Z][A-Za-z0-9]*)\b[^>]*?\/>/g)) {
        const tag = m[0];
        if (!/className="[^"]*h-icon-/.test(tag)) continue;
        if (/aria-hidden|aria-label|title=/.test(tag)) continue;
        bad.push(`${path}  ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('表单控件必有无障碍名（aria-label / id / 包裹 label）', () => {    // WCAG 4.1.2：placeholder 不是名字 —— 输入后即消失，屏幕阅读器无凭。
    // 防回归：曾 11 处 input/select/textarea 仅靠 placeholder。
    const bad: string[] = [];
    for (const { path, text } of TSX) {
      for (const m of text.matchAll(/<(input|select|textarea)\b[^>]*?\/?>/gs)) {
        const tag = m[0];
        if (/aria-label|aria-labelledby|\bid=/.test(tag)) continue;
        const pre = text.slice(Math.max(0, m.index - 250), m.index);
        if (pre.includes('<label') && pre.lastIndexOf('<label') > pre.lastIndexOf('</label>')) continue;
        bad.push(`${path}  ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('每个 <dialog> 都有 aria-label（屏幕阅读器需要标题）', () => {
    // 防回归：对比交易对弹窗曾无 aria-label，仅内部 h3 不足以命名对话框。
    const bad: string[] = [];
    for (const { path, text } of TSX) {
      for (const m of text.matchAll(/<dialog\b[^>]*?>/gs)) {
        if (!/aria-label|aria-labelledby/.test(m[0])) {
          bad.push(`${path}  ${m[0].replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('DESIGN §10 禁止项', () => {  it('无硬编码盈亏色（必须走 --oc-pnl-* / --oc-chart-*）', () => {
    // var(--x, #hex) 的令牌兑底位允许；裸字面值禁止
    expect(find(/(?<!,\s)#(30D158|FF3B30)\b/i)).toEqual([]);
  });

  it('无裸写 button 样式（可点击行必须用 oc-* 类）', () => {
    const naked: string[] = [];
    for (const { path, text } of TSX) {
      for (const m of text.matchAll(/<button\b[^>]*?>/gs)) {
        if (!/oc-|className=\{`/.test(m[0])) {
          naked.push(`${path}  ${m[0].replace(/\s+/g, ' ').slice(0, 100)}`);
        }
      }
    }
    expect(naked).toEqual([]);
  });
});

describe('DESIGN §5 / §11 令牌自洽', () => {
  it('§5 规范表里的 oc-* 类确有 CSS 定义（防死类名回归）', () => {
    // oc-select 曾同时出现在文档与 JSX，但 CSS 里从未定义 —— 渲染为浏览器原生控件
    for (const cls of ['oc-select', 'oc-bar-row', 'oc-input-wrap', 'oc-icon-btn', 'oc-float-panel']) {
      expect(cssText, `${cls} 应在 opencode.css 中定义`).toContain(`.${cls}`);
    }
  });

  it('Tailwind 桥接了 §11 全部要素类别', () => {
    for (const token of [
      '--radius-none',
      '--radius-pill',
      '--spacing-oc-1',
      '--spacing-icon-tool',
      '--spacing-control-md',
    ]) {
      expect(indexCss, `index.css @theme 缺少 ${token}`).toContain(token);
    }
  });

  it('JSX 用到的尺寸/图标/间距工具类确有令牌支撑', () => {
    // 防回归：h-control-nav 曾被用在 JSX 但未桥接 —— 类名不存在于产物，
    // 元素回退到内容尺寸（头像被撑到整栏宽）。此处对每个用到的尺寸类
    // 要求存在对应的 @theme 桥接（--spacing-*）。
    const used = new Set<string>();
    for (const { text } of TSX) {
      for (const m of text.matchAll(/(?:^|\s)h-(oc-\d|control-[a-z]+|icon-[a-z]+)\b/g)) {
        used.add(m[1]);
      }
    }
    expect(used.size, '应当能扫到尺寸工具类').toBeGreaterThan(0);
    const missing = [...used].filter((name) => !indexCss.includes(`--spacing-${name}:`));
    expect(missing, `以下 h-* 类未在 index.css @theme 桥接: ${missing.join(', ')}`).toEqual([]);
  });

  it('opencode.css 定义了 §11 全部令牌类别', () => {
    for (const token of [
      '--oc-radius-none',
      '--oc-radius-pill',
      '--oc-space-1',
      '--oc-control-md',
      '--oc-border-hairline',
      '--oc-icon-tool',
      '--oc-z-modal',
    ]) {
      expect(cssText, `opencode.css 缺少 ${token}`).toContain(token);
    }
  });
});
