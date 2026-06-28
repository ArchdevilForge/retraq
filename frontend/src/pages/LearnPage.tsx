import { useState } from 'react';
import { Brain, Wallet, TrendingUp, AlertTriangle, BookOpen, CheckCircle2 } from 'lucide-react';

const tabs = ['入门概念', '交易流程', '资金管理', '心态管理', '避坑指南'];

// 入门概念
const concepts = [
  {
    title: '什么是交易？',
    content: '交易不是赌博，而是一个概率游戏。我们通过寻找高胜率的"逻辑"和"结构"，在大概率赚钱的时候下注，在小概率亏钱的时候止损。',
    highlight: '核心：赚的时候大赚，亏的时候小亏'
  },
  {
    title: '什么是K线？',
    content: 'K线就是价格走过的路。它记录了过去一段时间比特币或山寨币是涨了还是跌了。我们看K线不是为了算命，而是为了找规律和结构。'
  },
  {
    title: '什么是趋势（顺势）？',
    content: '就像水往低处流，价格一旦形成一个方向（比如一直涨），它就很可能会继续往那个方向走。',
    highlight: '顺势：跟着大部队走。涨的时候只做多，绝对不做空',
    warning: '逆势：涨的时候你非要猜顶做空，这是新手死得最快的方式'
  },
  {
    title: '什么是箱体（平台/结构）？',
    content: '价格不会一直涨，它累了需要休息。当价格在一个区间里上上下下震荡，这就叫"箱体"或"盘整"。',
    highlight: '画法：找出震荡期间的最高点和最低点，画两条线，中间的区域就是箱体',
    tip: '意义：箱体是蓄力。蓄力越久，突破后的力量越大'
  },
  {
    title: '什么是分歧？',
    content: '分歧就是大家意见不统一，有人买有人卖，导致价格回调或震荡。',
    highlight: '小分歧：涨势中的小休息，是上车机会',
    tip: '大分歧：涨了很多之后的大回调，通常会有"二波"行情'
  },
];

// 交易流程
const tradingSteps = [
  {
    title: '第一步：判断市场环境（春夏秋冬理论）',
    desc: '一定要先看比特币（大饼）的脸色，再决定做不做山寨币',
    seasons: [
      { name: '春天（启动期）', desc: '大饼刚开始涨，百花齐放，很多币都在乱涨，分不清谁是龙一。这时候可以稍微激进一点。' },
      { name: '夏天（高潮期）', desc: '赚钱效应最热的时候。大饼震荡或上涨，龙头币会跟大饼"共振"走出来，这是最暴利的一段，必须重仓抓龙头。' },
      { name: '秋天（补涨期）', desc: '龙头涨不动了，大饼在高位震荡。资金开始去炒那些没涨过的垃圾币。这时候赚钱很难，行情不流畅，建议少做。' },
      { name: '冬天（调整期）', desc: '市场全面熄火，大饼下跌或深度调整。策略：空仓休息，管住手。' },
    ]
  },
  {
    title: '第二步：选择币种（龙头战法）',
    desc: '不要爱上垃圾币，只做最强的',
    points: [
      { label: '共振逻辑', desc: '大饼涨的时候，它跟着涨，甚至涨得更猛；大饼横盘的时候，它还能创新高。这就是强。' },
      { label: '日线结构好', desc: '上方没有套牢盘（没有压力位），或者已经突破了大箱体。' },
      { label: '新币/次新币', desc: '没有历史包袱，容易拉升。' },
      { label: '热点板块', desc: '市场当下最关注的题材（如AI、铭文等）。' },
    ]
  },
  {
    title: '第三步：确定进场时机（三种买点）',
    desc: '千万不要追高，要在有逻辑的位置进场',
    buyPoints: [
      { name: '箱体突破（启动点）', desc: '价格长时间在箱体里震荡，突然放量突破箱体上沿。操作：在突破并站稳的那一刻买入。' },
      { name: '小分歧（接多）', desc: '主升浪过程中，价格稍微回调，或者横盘不跌。操作：在箱体底部或回调企稳时买入，博弈它继续涨。' },
      { name: '大分歧（做二波）', desc: '龙头币涨了很多后，大幅下跌回调（比如跌了30%）。操作：等它跌不动了，企稳拐头向上时买入，博弈"第二波"上涨。' },
    ]
  },
  {
    title: '第四步：设置止损止盈（保命法则）',
    desc: '没有止损的单子坚决不开！',
    rules: [
      { label: '止损位置', desc: '不要用固定百分比（如亏10%就跑），要用结构止损。做突破止损放在起涨点或箱体下沿，做回调止损放在前低下方。' },
      { label: '止损核心', desc: '如果价格跌破了这个位置，说明你的看涨逻辑不存在了，必须认赔离场。' },
      { label: '止盈方法', desc: '分批止盈：赚了钱先卖一半，剩下让利润奔跑。看压力位：左边有密集成交区就卖。' },
    ]
  },
];

// 资金管理
const moneyRules = [
  {
    title: '充多少钱？',
    content: '如果你没钱或负债，不要充太多。几千块人民币就够了，把这点钱做起来再说。',
    warning: '如果几千块都做不起来，几百万你也只会亏光。'
  },
  {
    title: '如何分仓？（必做）',
    content: '假设你有3万U（或者3000块），分成3份。每次只拿其中的1份去开仓。',
    steps: ['如果这份钱亏了，再从外面补一份进来', '如果赚了（比如翻倍），就把利润提走'],
    highlight: '好处：即使爆仓也只亏1/3，永远有翻身的机会，心态不会崩'
  },
  {
    title: '杠杆控制',
    content: '新手严禁高倍杠杆，高倍杠杆是一条死路。',
    limits: [
      { type: '山寨币', max: '最高5倍' },
      { type: '大饼/以太', max: '最高10倍' },
    ]
  },
];

// 心态管理
const mindsetRules = [
  {
    title: '如何克服FOMO（怕踏空）？',
    content: '市场永远不缺机会。错过了一波行情不要紧，哪怕是大饼从2万涨到6万你没做，只要你本金还在，下一个机会就能赚回来。',
    warning: '如果你因为怕错过而乱追高，往往会亏损，导致心态更坏。'
  },
  {
    title: '连续亏损后如何调整？',
    content: '连续亏损说明你的节奏错了，或者市场进入了"垃圾时间"（震荡/冬天）。',
    highlight: '立刻停止交易！出去走走，睡觉，打游戏，强制自己离开盘面。',
    warning: '不要想着"马上回本"，越想回本亏得越快。'
  },
  {
    title: '如何避免"上头"？',
    content: '一旦出现非逻辑的亏损（比如乱刷单、扛单），这笔钱就是你要交的学费。',
    highlight: '承认错误，必须严格执行分仓策略，这样就算上头爆仓一次，也只是总资金的一部分，不会让你破产。'
  },
];

// 十大错误
const fatalErrors = [
  { title: '做逆势单（做空）', desc: '涨得太高了觉得要跌，去摸顶做空。绝对禁止！强势币会一直涨，空头会被拉爆。' },
  { title: '不止损（扛单）', desc: '觉得"总会回来的"。这是归零的源头。止损是你的生命线。' },
  { title: '重仓梭哈', desc: '一把定输赢。只要输一次就再也没有机会了。' },
  { title: '高倍杠杆', desc: '甚至还没波动，手续费和插针就让你没了。' },
  { title: '频繁交易（刷单）', desc: '在震荡行情里来回被打脸。看不懂的时候要空仓休息。' },
  { title: '迷信技术指标', desc: '不要看太多复杂的指标，只看K线、量能和结构。' },
  { title: '想吃掉所有行情', desc: '总是想买在最低点、卖在最高点。这是不可能的，只吃鱼身（中间一段）就够了。' },
  { title: '借贷炒币', desc: '压力会让你动作变形，必定失败。' },
  { title: '不看大饼做山寨', desc: '大饼要跌的时候，山寨币通常会跌得更惨，必须看大饼脸色。' },
  { title: '亏钱后报复性开单', desc: '亏了想马上赚回来，这是赌徒心态。' },
];

export default function LearnPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-base-100">
      <div className="tabs tabs-boxed tabs-xs shrink-0 border-b border-base-300 bg-base-200 px-2 py-1">
        {tabs.map((tab, i) => (
          <button
            key={i}
            className={`tab ${activeTab === i ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
        {/* 入门概念 */}
        {activeTab === 0 && (
          <div className="space-y-3">
            {concepts.map((item, i) => (
              <div key={i} className="bg-base-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  <span className="font-semibold">{item.title}</span>
                </div>
                <p className="text-base-content/80 text-sm mb-2">{item.content}</p>
                {item.highlight && (
                  <div className="text-sm text-success flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{item.highlight}</span>
                  </div>
                )}
                {item.warning && (
                  <div className="text-sm text-error flex items-start gap-2 mt-1">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{item.warning}</span>
                  </div>
                )}
                {item.tip && (
                  <div className="text-sm text-info flex items-start gap-2 mt-1">
                    <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{item.tip}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 交易流程 */}
        {activeTab === 1 && (
          <div className="space-y-4">
            {tradingSteps.map((step, i) => (
              <div key={i} className="bg-base-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-[#D97757]" />
                  <span className="font-semibold">{step.title}</span>
                </div>
                <p className="text-base-content/60 text-sm mb-3">{step.desc}</p>
                
                {step.seasons && (
                  <div className="space-y-2">
                    {step.seasons.map((s, j) => (
                      <div key={j} className="bg-base-300 rounded p-2">
                        <span className="font-medium text-sm">{s.name}</span>
                        <p className="text-xs text-base-content/70 mt-1">{s.desc}</p>
                      </div>
                    ))}
                  </div>
                )}
                
                {step.points && (
                  <div className="space-y-2">
                    {step.points.map((p, j) => (
                      <div key={j} className="flex gap-2 text-sm">
                        <span className="badge badge-sm badge-outline shrink-0">{p.label}</span>
                        <span className="text-base-content/80">{p.desc}</span>
                      </div>
                    ))}
                  </div>
                )}
                
                {step.buyPoints && (
                  <div className="space-y-2">
                    {step.buyPoints.map((p, j) => (
                      <div key={j} className="bg-base-300 rounded p-2">
                        <span className="font-medium text-sm text-primary">{p.name}</span>
                        <p className="text-xs text-base-content/70 mt-1">{p.desc}</p>
                      </div>
                    ))}
                  </div>
                )}
                
                {step.rules && (
                  <div className="space-y-2">
                    {step.rules.map((r, j) => (
                      <div key={j} className="flex gap-2 text-sm">
                        <span className="badge badge-sm badge-warning shrink-0">{r.label}</span>
                        <span className="text-base-content/80">{r.desc}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 资金管理 */}
        {activeTab === 2 && (
          <div className="space-y-3">
            {moneyRules.map((item, i) => (
              <div key={i} className="bg-base-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-accent" />
                  <span className="font-semibold">{item.title}</span>
                </div>
                <p className="text-base-content/80 text-sm mb-2">{item.content}</p>
                
                {item.steps && (
                  <ul className="text-sm text-base-content/70 list-disc list-inside mb-2">
                    {item.steps.map((s, j) => <li key={j}>{s}</li>)}
                  </ul>
                )}
                
                {item.highlight && (
                  <div className="text-sm text-success flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{item.highlight}</span>
                  </div>
                )}
                
                {item.warning && (
                  <div className="text-sm text-error flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{item.warning}</span>
                  </div>
                )}
                
                {item.limits && (
                  <div className="flex gap-4 mt-2">
                    {item.limits.map((l, j) => (
                      <div key={j} className="badge badge-lg badge-outline">
                        {l.type}：<span className="text-warning ml-1">{l.max}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 心态管理 */}
        {activeTab === 3 && (
          <div className="space-y-3">
            {mindsetRules.map((item, i) => (
              <div key={i} className="bg-base-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-4 h-4 text-warning" />
                  <span className="font-semibold">{item.title}</span>
                </div>
                <p className="text-base-content/80 text-sm mb-2">{item.content}</p>
                
                {item.highlight && (
                  <div className="text-sm text-success flex items-start gap-2 mb-1">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{item.highlight}</span>
                  </div>
                )}
                
                {item.warning && (
                  <div className="text-sm text-error flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{item.warning}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 避坑指南 */}
        {activeTab === 4 && (
          <div className="space-y-2">
            {fatalErrors.map((error, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-base-200 rounded-lg">
                <span className="badge badge-error shrink-0">{i + 1}</span>
                <div>
                  <div className="font-medium text-sm">{error.title}</div>
                  <div className="text-xs text-base-content/60 mt-1">{error.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
