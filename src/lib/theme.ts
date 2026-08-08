import type { ThemeName } from '../../shared/ipc';

/** 把 theme（light/dark/system）解析成实际写到 data-theme 的值 */
export function resolveTheme(theme: ThemeName): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}
