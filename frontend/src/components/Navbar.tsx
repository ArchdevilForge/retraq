import { NavLink } from 'react-router-dom';
import DatasetPicker from './DatasetPicker';
import { useTheme } from '../context/ThemeContext';

function navTabClass(isActive: boolean) {
  return `oc-tab${isActive ? ' oc-tab--active' : ''}`;
}

function Navbar() {
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      <a href="#main-content" className="oc-skip-link">
        跳到主内容
      </a>
      <header className="oc-navbar oc-enter">
        <div className="oc-navbar__start">
          <NavLink to="/replay" className="oc-brand-title" translate="no">
            Retraq
          </NavLink>
          <nav className="oc-navbar__nav" aria-label="主菜单">
            <div className="oc-tabs">
              <NavLink to="/replay" className={({ isActive }) => navTabClass(isActive)}>
                复盘
              </NavLink>
              <NavLink to="/train" className={({ isActive }) => navTabClass(isActive)}>
                训练
              </NavLink>
              <NavLink to="/analysis" className={({ isActive }) => navTabClass(isActive)}>
                分析
              </NavLink>
              <NavLink to="/learn" className={({ isActive }) => navTabClass(isActive)}>
                学习
              </NavLink>
            </div>
          </nav>
        </div>

        <div className="oc-navbar__actions">
          <button
            type="button"
            className="oc-btn oc-btn--sm oc-btn--secondary"
            onClick={toggleTheme}
            aria-label={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
          >
            {theme === 'light' ? '深色' : '浅色'}
          </button>
          <DatasetPicker />
        </div>
      </header>
    </>
  );
}

export default Navbar;
