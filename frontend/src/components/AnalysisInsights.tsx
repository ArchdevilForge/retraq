import { useMemo } from 'react';
import { fmtMoney, fmtPct } from '../utils/format';

type Insight = { tone: 'good' | 'warn' | 'neutral'; text: string };

type Props = {
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdown: number;
  revengeTradeCount: number;
  tradesPerDay: number | null;
};

export default function AnalysisInsights({
  winRate,
  profitFactor,
  expectancy,
  maxDrawdown,
  revengeTradeCount,
  tradesPerDay,
}: Props) {
  const insights = useMemo(() => {
    const rows: Insight[] = [];
    if (profitFactor != null && profitFactor >= 1.5) {
      rows.push({ tone: 'good', text: `利润因子 ${profitFactor.toFixed(2)}，整体盈利结构尚可` });
    } else if (profitFactor != null && profitFactor < 1) {
      rows.push({ tone: 'warn', text: `利润因子 ${profitFactor.toFixed(2)}，亏损总额超过盈利` });
    }
    if (winRate != null && winRate < 0.4) {
      rows.push({ tone: 'warn', text: `胜率 ${fmtPct(winRate)}，建议复盘入场与止损逻辑` });
    }
    if (expectancy != null && expectancy > 0) {
      rows.push({ tone: 'good', text: `单笔期望 ${fmtMoney(expectancy)} U，长期期望为正` });
    } else if (expectancy != null && expectancy < 0) {
      rows.push({ tone: 'warn', text: `单笔期望 ${fmtMoney(expectancy)} U，策略期望为负` });
    }
    if (revengeTradeCount >= 5) {
      rows.push({
        tone: 'warn',
        text: `快速再开仓 ${revengeTradeCount} 次，留意亏损后的冲动交易`,
      });
    }
    if (tradesPerDay != null && tradesPerDay > 20) {
      rows.push({ tone: 'warn', text: `日均 ${tradesPerDay.toFixed(1)} 笔，频率偏高` });
    }
    if (maxDrawdown < -500) {
      rows.push({ tone: 'warn', text: `最大回撤 ${fmtMoney(maxDrawdown)} U，检查仓位与止损` });
    }
    if (rows.length === 0) {
      rows.push({ tone: 'neutral', text: '样本量有限，继续积累交割单后可获得更稳定结论' });
    }
    return rows.slice(0, 4);
  }, [winRate, profitFactor, expectancy, maxDrawdown, revengeTradeCount, tradesPerDay]);

  return (
    <section className="oc-insights" aria-label="复盘提示">
      <h2 className="oc-insights__title">提示</h2>
      <ul className="oc-guide-list">
        {insights.map((item) => (
          <li key={item.text} className={`oc-guide-list__item oc-guide-list__item--${item.tone}`}>
            {item.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
