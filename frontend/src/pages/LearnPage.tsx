import { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,
  Layers,
  Shield,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';

type Callout = { kind: 'ok' | 'warn' | 'tip'; text: string };
type Bullet = { label?: string; text: string };
type Block = {
  title: string;
  body?: string;
  bullets?: Bullet[];
  callouts?: Callout[];
  chips?: string[];
};

type Tab = {
  id: string;
  label: string;
  icon: typeof BookOpen;
  intro?: string;
  blocks: Block[];
};

const tabs: Tab[] = [
  {
    id: 'philosophy',
    label: '核心哲学',
    icon: BookOpen,
    intro: 'Bit浪浪完整交易系统 · 顺势、敬畏、结构优先',
    blocks: [
      {
        title: '顺势而为',
        body: '交易是概率游戏：在大概率赚钱的结构上下注，在逻辑失效时立刻认赔。',
        bullets: [
          { label: '不做逆势', text: '明确多头主升浪中，没有任何一笔空单。' },
          { label: '宁愿踏空', text: '绝不摸顶；逆势单难设有效止损，加速行情极易爆仓。' },
          { label: '上方有空间', text: '顺势前提是上方无密集套牢盘，距强阻力有足够距离。' },
        ],
        callouts: [{ kind: 'ok', text: '核心：赚的时候大赚，亏的时候小亏。' }],
      },
      {
        title: '敬畏市场',
        bullets: [
          { text: '市场永远是对的，不能幻想征服市场。' },
          { text: '一波行情或一笔交易无论成败，都是沧海一粟。' },
          { text: '真正能赚钱的好行情时间占比极小；大部分时间在场外等待。' },
        ],
      },
      {
        title: '盈利公式',
        body: '周期判断 + 选币筛选 + 低杠杆 + 严格分仓 + 底部防守止损 + 关键压力位分批止盈 = 长期稳定盈利。',
        chips: ['春夏重仓', '秋轻仓', '冬空仓', '裸K结构', '不用指标'],
      },
      {
        title: '技术底色：只用裸K',
        body: '均线、MACD 等指标不参与开单决策。体系只看：箱体/五浪结构、支撑压力、春夏秋冬情绪、资金合力与历史盘面规律。',
        callouts: [{ kind: 'tip', text: '大级别定方向（日线/4H），小级别找买点（15m/5m）。' }],
      },
    ],
  },
  {
    id: 'seasons',
    label: '春夏秋冬',
    icon: Layers,
    intro: '先看大盘温度，再决定仓位与频率。顺应天时，因时施策。',
    blocks: [
      {
        title: '春天 · 启动期',
        body: 'BTC 长期下跌/震荡后底部企稳并向上突破；市场「百花齐放」，资金试探布局，龙头尚不清晰。',
        bullets: [
          { label: '策略', text: '试仓与跟随；积极找右侧突破机会，建立底仓。' },
          { label: '仓位', text: '开始建仓 · 频率中等 · 杠杆正常。' },
        ],
      },
      {
        title: '夏天 · 主升狂热期',
        body: '赚钱效应最极端。「共振分离」后真龙头脱颖而出，走出流畅独立主升浪。',
        bullets: [
          { label: '策略', text: '激进做多、聚焦龙头；放弃杂乱补涨，小分歧承接或突破跟进。' },
          { label: '仓位', text: '重仓出击 · 频率高 · 可相对激进。' },
        ],
        callouts: [{ kind: 'ok', text: '这是系统里最该全力以赴的阶段。' }],
      },
      {
        title: '秋天 · 鱼尾补涨期',
        body: 'BTC 高位横盘，前期龙头涨幅透支；资金炒「老弱病残 / 动物园补涨」，一级市场可能狂热但走势恶心。',
        bullets: [
          { label: '策略', text: '收缩防守：降频、降杠杆、严止损；不在高位追突破。' },
          { label: '仓位', text: '轻仓试错 · 频率低 · 保守。' },
        ],
        callouts: [{ kind: 'warn', text: '假突破极多、画门频繁，宁可错过不确定的补涨。' }],
      },
      {
        title: '冬天 · 熊市/狗屎市',
        body: '补涨逻辑走完，全市场熄火；深度下跌或漫长无序箱体，多空绞杀。',
        bullets: [
          { label: '策略', text: '空仓冬眠，坚决管住手。技术与突破策略在此阶段盈亏比极差。' },
          { label: '仓位', text: '空仓等待 · 不交易。' },
        ],
        callouts: [{ kind: 'warn', text: '不要妄想震荡里多空双吃。' }],
      },
      {
        title: '周期对照',
        chips: [
          '春：建仓 / 中频',
          '夏：重仓 / 高频',
          '秋：轻仓 / 低频',
          '冬：空仓 / 休息',
        ],
      },
    ],
  },
  {
    id: 'select',
    label: '选币',
    icon: Target,
    intro: '只做市场最强合力选出的龙头，不做拖沓补涨。',
    blocks: [
      {
        title: '选币完美公式',
        body: '大盘拐点企稳 + 次新/热点龙头 + 日线结构完美且上方无压力 + 底层箱体蓄力充分。',
        callouts: [{ kind: 'ok', text: '同时满足才值得重仓并一路持有。' }],
      },
      {
        title: '龙头与高人气',
        bullets: [
          { label: '次新币', text: '上方筹码干净，点火后易出大幅主升浪（如历史 APT、WLD 类）。' },
          { label: '热点题材', text: 'AI、香港概念等资金扎堆板块；动物园 Meme 牛市爆发力强。' },
          { label: '放弃', text: '走势拖沓的补涨币、上方套牢盘重重的币。' },
        ],
      },
      {
        title: '日线结构与上方空间',
        bullets: [
          { text: '先决条件：日线结构好，上方无密集筹码压力区。' },
          { text: '一马平川或距下一强阻力极远 → 突破后潜力大。' },
          { text: '上方阻力交错 → 持仓体验差，不做趋势单。' },
        ],
      },
      {
        title: '与大盘共振',
        bullets: [
          { label: '共振', text: 'BTC/ETH 突破或企稳拐点同期，山寨同步放量最猛、最强 → 真龙头。' },
          { label: '非共振', text: '大盘主升已完、高位休息时的补涨 = 鱼尾，反复画门，难度极大。' },
        ],
        callouts: [{ kind: 'tip', text: '脱离大盘周期盲目选山寨是危险的。' }],
      },
      {
        title: '调整期找抗跌种子',
        body: 'BTC 第一波主升后高位横盘时：跟涨亮眼且回调极抗跌（高位横盘收敛、拒绝回调）的币，往往有主力护盘，二波爆发概率高。',
      },
      {
        title: '箱体蓄力',
        body: '拉升前最好有大级别下跌后的长时间箱体盘整。盘整越久、二次探顶/探底后越收敛，突破确定性和动能越强。',
      },
    ],
  },
  {
    id: 'entry',
    label: '结构进场',
    icon: TrendingUp,
    intro: '箱体界定结构，分歧定义阶段，右侧拐点进场；高位不追突破。',
    blocks: [
      {
        title: '箱体怎么画',
        bullets: [
          { label: '上下沿', text: '主升/主跌后震荡，第一次高低点确立初始边界。' },
          { label: '二次探顶/底', text: '箱体是否饱满的关键分界；之后收敛才是酝酿突破阶段。' },
          { label: '收敛末端', text: '振幅越来越小，结构构建完毕，即将选出方向。' },
        ],
      },
      {
        title: '箱体用法',
        bullets: [
          { label: '突破', text: '大级别盘整充分后向上突破 = 高胜率启动点；止损放启动低点/箱体下沿。' },
          { label: '底部承接', text: '砸到箱底不创新低并拐点时接多；防守在箱体最下沿。' },
          { label: '禁止', text: '箱体中间猜涨跌，盈亏比极差。' },
        ],
      },
      {
        title: '分歧：小 vs 大',
        bullets: [
          { label: '小分歧', text: '突破新高后短暂横盘回踩。误区：小级别追突破易假突破洗盘。正确：箱底承接，止损箱下沿。' },
          { label: '大分歧', text: '连续拉升后的深度调整。等结构收敛、企稳再介入，博弈二波。' },
        ],
      },
      {
        title: '三种核心买点',
        bullets: [
          { label: '启动突破', text: '底部/中继大箱体突破时跟随，或等第一次回踩企稳。' },
          { label: '分歧承接', text: '小分歧箱底；大分歧收敛后拐点。' },
          { label: '右侧拐点', text: '砸→弹→再砸不创新低（双底）拐头；或突破后回踩「踩住」支撑。' },
        ],
        callouts: [{ kind: 'warn', text: '趋势后期/高位震荡：不追小级别突破；必须参与只做箱底低吸。' }],
      },
      {
        title: '假突破识别',
        bullets: [
          { text: '高位五浪末端小平台向上突破 → 常为诱多。' },
          { text: '小分歧阶段追突破 → 主力洗盘陷阱。' },
          { text: '应对：改追突破为承接/等回踩；假动作走完再入场。' },
          { text: '大级别结构饱满的关键突破：宁愿轻仓试错，不能错过。' },
        ],
        callouts: [{ kind: 'warn', text: '尝试突破单必须轻仓低杠杆；确认失败坚决出局。' }],
      },
      {
        title: 'K 线信号（无指标）',
        bullets: [
          { label: '双底拐点', text: '再砸不创新低后拐头向上。' },
          { label: '回踩企稳', text: '回踩支撑/箱上沿，下影止跌再拐头。' },
          { label: '假突破反包', text: '假动作后强力大 K 全包，反向启动。' },
          { label: '放量突破阳', text: '箱体收敛末期坚决放量突破上沿。' },
        ],
      },
      {
        title: '支撑压力怎么找',
        bullets: [
          { text: '前期筹码密集区 / 套牢盘。' },
          { text: '结构前高、前低、箱体上下沿、起跌/启动点。' },
          { text: '整数关口的心理位。' },
        ],
      },
    ],
  },
  {
    id: 'risk',
    label: '仓位风控',
    icon: Wallet,
    intro: '仓位管理是核心中的核心；止损是命，止盈不贪顶点。',
    blocks: [
      {
        title: '固定分仓',
        body: '总资金等份划分（例：3 万 U → 3 份）。每次只用 1 份一次性进场。',
        bullets: [
          { text: '亏了从场外补回该份额度；赚了把利润提现，维持固定开仓额。' },
          { text: '只有本金大幅跃升（如 3 万→6 万）才提高每份金额。' },
        ],
        callouts: [{ kind: 'ok', text: '上头最多亏掉约 1/3，保留东山再起缓冲。' }],
      },
      {
        title: '杠杆铁律',
        chips: ['BTC ≤ 10x', '山寨 ≤ 5x', '高倍 = 死路'],
        callouts: [{ kind: 'warn', text: '分仓 + 低杠杆 + 止损 = 理论上不应爆仓。' }],
      },
      {
        title: '止损：有效防守位',
        bullets: [
          { label: '本质', text: '不止是认错，是市场里的命。' },
          { label: '双底/拐点', text: '止损在最低点下方一点。' },
          { label: '箱体突破/承接', text: '止损在箱体下沿或启动低点。' },
          { label: '高位追涨', text: '止损仍在最近有效拐点，因距离大必须降仓。' },
          { label: '推原价', text: '脱离成本后止损上移至成本或阶段低点，锁定不亏。' },
        ],
        callouts: [{ kind: 'tip', text: '逻辑对时，小级别试错被扫 1–3 次正常；一单趋势可反转盈亏比。' }],
      },
      {
        title: '止盈：分批兑现',
        bullets: [
          { text: '进场前用大级别标出上方筹码区/整数关口作目标。' },
          { text: '到目标区或「走势不对劲」时分批平，不追求绝对顶点。' },
          { label: '主升初中期', text: '趋势未破可格局等二波。' },
          { label: '中后期/高位', text: '见好就收，边拉边跑。' },
        ],
      },
      {
        title: '加仓纪律',
        bullets: [
          { text: '前提：已有成本极佳的底仓利润作缓冲。' },
          { text: '方法：回调企稳 → 反弹 → 再踩不创新低 → 拐头/二次突破时加。' },
          { text: '禁止直线拉升时追高加仓；高位加仓严格轻仓，弱流动性币更甚。' },
        ],
      },
      {
        title: '未到止盈止损的出场信号',
        bullets: [
          { label: '全砸回来', text: '突破后大阴全包涨幅 → 动能衰竭，立刻走。' },
          { label: '该破不破', text: '完美结构假突破拐头 → 主力意愿不足，离场。' },
          { label: '丧失龙头', text: '市场出现更猛新龙头 → 切换最强合力。' },
          { label: '大盘见顶', text: 'BTC 触及强压/见顶信号 → 山寨再好看也跑。' },
        ],
      },
      {
        title: '盈亏比怎么算',
        body: '预期盈利（到最近强压/空间）÷ 预期亏损（到有效防守位）。箱体收敛末端突破常可达极高盈亏比；箱中开单则极差。',
      },
      {
        title: '新币小窍门',
        bullets: [
          { text: '上市初期抛压重：不急做多；高位收敛假突破结构反而常是做空机会。' },
          { text: '做多须等深跌洗筹 + 底部长盘整，再从深坑突破启动。' },
        ],
      },
    ],
  },
  {
    id: 'mind',
    label: '心态复盘',
    icon: Brain,
    intro: '仓位托底心态；复盘分清体系试错与上头犯病。',
    blocks: [
      {
        title: '用仓位给心态托底',
        bullets: [
          { text: '分仓 + 低杠杆：即使上头，伤害可控。' },
          { text: '固定开仓额：盈亏都不轻易改变单笔风险。' },
          { text: '建好底仓和止损后，减少盯盘，和市场保持距离。' },
        ],
      },
      {
        title: '卖飞与怕踏空',
        bullets: [
          { text: '卖飞最可怕的是引发「怕踏空」心魔，进而动作变形。' },
          { text: '违背纪律追高即使赚钱，也是「错误的盈利」、美丽的陷阱。' },
          { text: '市场永远不缺行情；本金还在就能等下一次。' },
        ],
      },
      {
        title: '连续亏损',
        bullets: [
          { text: '立刻停手复盘：节奏错了还是进入垃圾时间。' },
          { text: '回撤是认识系统漏洞的契机，不是马上回本的理由。' },
          { text: '严查无逻辑单与逆势单。' },
        ],
        callouts: [{ kind: 'warn', text: '想着马上回本，往往亏得更快。' }],
      },
      {
        title: '无效磨损（≠ 体系内试错）',
        bullets: [
          { text: '箱中乱猜、过度盯盘刷单。' },
          { text: '主升摸顶做空、左侧接飞刀。' },
          { text: '卖飞后焦虑追高、亏损后报复性重仓。' },
          { text: '极差流动性盘口的滑点磨损。' },
        ],
      },
      {
        title: '复盘流程',
        bullets: [
          { label: '裸K推演', text: '15m/5m 遮住后续，逐根回放：箱体还是趋势？买点与防守在哪？' },
          { label: '逐单分类', text: '体系内试错可接受；左侧/追高/逆势属犯病，必须改。' },
          { label: '情绪诱因', text: '诚实挖：是否因卖飞导致踏空焦虑变形。' },
          { label: '周期规律', text: '谁先启动、谁跟涨、谁补涨，沉淀下次预案。' },
        ],
      },
      {
        title: '交易计划四步',
        bullets: [
          { label: '1 战略', text: '春夏秋冬 + BTC 阶段 → 总仓位与多空基调。' },
          { label: '2 选币', text: '日线完美、上方空间、热点/次新龙头。' },
          { label: '3 买点', text: '15m/5m 等箱体收敛、分歧拐点、回踩企稳。' },
          { label: '4 进出', text: '先定死防守位与分批止盈；走势恶心随时平价撤。' },
        ],
      },
      {
        title: '新手底线',
        bullets: [
          { text: '极轻仓极低杠杆；小资金也分 3 份。' },
          { text: '坚决不做逆势；开单先设结构止损，绝不扛单。' },
          { text: '做单必须有逻辑；冬天或心态失衡就关机休息。' },
          { text: '不贷款、不用生活急需的钱炒币。' },
        ],
      },
    ],
  },
  {
    id: 'pitfalls',
    label: '避坑',
    icon: Shield,
    intro: '把最容易归零的动作钉在墙上。',
    blocks: [
      {
        title: '十大致命错误',
        bullets: [
          { label: '1', text: '逆势摸顶做空：强势币可一直涨，空头被抬爆。' },
          { label: '2', text: '不止损扛单：归零源头。' },
          { label: '3', text: '重仓梭哈：输一次没有下次。' },
          { label: '4', text: '高倍杠杆：插针与费用先杀死你。' },
          { label: '5', text: '震荡刷单：看不懂就空仓。' },
          { label: '6', text: '迷信指标：只看 K 线、量能与结构。' },
          { label: '7', text: '想吃整条鱼：只吃鱼身就够。' },
          { label: '8', text: '借贷炒币：压力必使动作变形。' },
          { label: '9', text: '不看大饼做山寨：大饼跌时山寨更惨。' },
          { label: '10', text: '亏损后报复开单：赌徒心态。' },
        ],
      },
      {
        title: '生存法则',
        callouts: [
          { kind: 'ok', text: '不让任何一笔失败动摇整套体系。' },
          { kind: 'ok', text: '高容错率让你连续做错仍保持清醒。' },
          { kind: 'tip', text: '市场永远是对的，始终保持敬畏。' },
        ],
      },
    ],
  },
];

function CalloutRow({ item }: { item: Callout }) {
  if (item.kind === 'ok') {
    return (
      <div className="flex items-start gap-2 text-[13px] oc-text-profit">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{item.text}</span>
      </div>
    );
  }
  if (item.kind === 'warn') {
    return (
      <div className="flex items-start gap-2 text-[13px] oc-text-loss">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{item.text}</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-[13px] oc-text-brand">
      <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{item.text}</span>
    </div>
  );
}

export default function LearnPage() {
  const [tabId, setTabId] = useState(tabs[0].id);
  const active = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const Icon = active.icon;

  return (
    <div className="oc-page flex h-full min-h-0 flex-1 flex-col overflow-hidden p-2">
      <div className="oc-page__frame mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 overflow-hidden p-4">
        <header className="shrink-0">
          <h1 className="text-[20px] font-medium tracking-tight">学习</h1>
          <p className="mt-1 text-[13px] oc-text-faint">
            Bit浪浪交易系统精要 · 与复盘页同一套结构语言
          </p>
        </header>

        <div role="tablist" aria-label="学习章节" className="oc-tabs w-full shrink-0 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.id}
              id={`learn-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tabId === t.id}
              aria-controls={`learn-panel-${t.id}`}
              className={`oc-tab${tabId === t.id ? ' oc-tab--active' : ''}`}
              onClick={() => setTabId(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          id={`learn-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`learn-tab-${active.id}`}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-1"
        >
          {active.intro && (
            <div className="flex shrink-0 items-start gap-2 text-[13px] oc-text-muted">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 oc-text-brand" />
              <span>{active.intro}</span>
            </div>
          )}

          {active.blocks.map((block) => (
            <article key={block.title} className="oc-card oc-card--bordered shrink-0">
              <h2 className="oc-card__title mb-2">{block.title}</h2>
              {block.body && <p className="mb-2 text-[13px] oc-text-muted">{block.body}</p>}

              {block.bullets && block.bullets.length > 0 && (
                <ul className="mb-2 flex flex-col gap-2">
                  {block.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-[13px]">
                      {b.label ? (
                        <span className="oc-badge shrink-0">{b.label}</span>
                      ) : (
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--text-weaker-base)]" />
                      )}
                      <span className="oc-text-muted">{b.text}</span>
                    </li>
                  ))}
                </ul>
              )}

              {block.chips && block.chips.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {block.chips.map((c) => (
                    <span key={c} className="oc-chip">
                      {c}
                    </span>
                  ))}
                </div>
              )}

              {block.callouts && block.callouts.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {block.callouts.map((c, i) => (
                    <CalloutRow key={i} item={c} />
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
