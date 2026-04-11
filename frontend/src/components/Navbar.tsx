import { BrainCircuit, GraduationCap, History, LineChart, SquareArrowOutUpRight } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export default function Navbar() {
  return (
    <div className="navbar bg-base-200 border-b border-base-300 px-6">
      {/* Logo 靠左 */}
      <div className="navbar-start">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg">Retraq</span>
        </div>
      </div>

      {/* Navigation 居中 */}
      <div className="navbar-center">
        <div className="flex items-center gap-1 bg-base-300 p-1.5 rounded-xl">
          <NavLink
            to="/replay"
            className={({ isActive }) =>
              `flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary text-primary-content'
                  : 'text-base-content/70 hover:text-base-content hover:bg-base-200'
              }`
            }
          >
            <History className="h-4 w-4" />
            复盘
          </NavLink>
          <NavLink
            to="/import"
            className={({ isActive }) =>
              `flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary text-primary-content'
                  : 'text-base-content/70 hover:text-base-content hover:bg-base-200'
              }`
            }
          >
            <SquareArrowOutUpRight className="h-4 w-4" />
            导入
          </NavLink>
          <NavLink
            to="/analysis"
            className={({ isActive }) =>
              `flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary text-primary-content'
                  : 'text-base-content/70 hover:text-base-content hover:bg-base-200'
              }`
            }
          >
            <LineChart className="h-4 w-4" />
            分析
          </NavLink>
          <NavLink
            to="/learn"
            className={({ isActive }) =>
              `flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary text-primary-content'
                  : 'text-base-content/70 hover:text-base-content hover:bg-base-200'
              }`
            }
          >
            <GraduationCap className="h-4 w-4" />
            学习
          </NavLink>
        </div>
      </div>

      {/* 占位保持居中 */}
      <div className="navbar-end"></div>
    </div>
  );
}
