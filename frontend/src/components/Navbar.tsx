import { NavLink } from 'react-router-dom';
import { CandlestickChart, ChartNoAxesCombined, Sparkles } from 'lucide-react';
import DatasetPicker from './DatasetPicker';

function navClass({ isActive }: { isActive: boolean }) {
  return `flex cursor-pointer items-center gap-2.5 rounded-lg px-4 py-2 text-[0.9375rem] font-medium transition-colors duration-150 ${
    isActive
      ? 'bg-[#D97757] text-[#141413]'
      : 'text-base-content/80 hover:bg-white/[0.06] hover:text-base-content'
  }`;
}

function Navbar() {
  return (
    <header className="relative z-50 grid h-[3.25rem] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 overflow-visible border-b border-white/[0.08] bg-base-200/90 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3 justify-self-start">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D97757]/15 text-[#D97757] ring-1 ring-[#D97757]/25">
          <CandlestickChart className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <div className="font-display text-xl font-semibold tracking-tight text-base-content">Retraq</div>
          <div className="text-sm text-base-content/45">交易复盘</div>
        </div>
      </div>

      <nav className="justify-self-center">
        <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-base-300/40 p-1">
          <NavLink to="/replay" className={navClass}>
            <Sparkles className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
            复盘
          </NavLink>
          <NavLink to="/analysis" className={navClass}>
            <ChartNoAxesCombined className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
            分析
          </NavLink>
        </div>
      </nav>

      <div className="flex min-w-0 items-center justify-self-end">
        <DatasetPicker />
      </div>
    </header>
  );
}

export default Navbar;