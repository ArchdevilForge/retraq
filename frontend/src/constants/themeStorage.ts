export const THEME_STORAGE_KEY = 'retraq-theme';

export type ThemeMode = 'light' | 'dark';

export function readStoredTheme(): ThemeMode | null {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : null;
}

export function resolveInitialTheme(): ThemeMode {
  const stored = readStoredTheme();
  if (stored) return stored;
  // 深色为默认主题（docs/DESIGN.md §3）；用户显式选择后存 localStorage。
  return 'dark';
}
