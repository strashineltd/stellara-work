import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('grounded design system', () => {
  const tokens = readFileSync(resolve(__dirname, 'grounded-tokens.css'), 'utf-8');
  const workbench = readFileSync(resolve(__dirname, 'workbench.css'), 'utf-8');
  const entry = readFileSync(resolve(__dirname, '../main.tsx'), 'utf-8');
  const electronMain = readFileSync(resolve(__dirname, '../../electron/main.ts'), 'utf-8');
  const mainView = readFileSync(resolve(__dirname, '../components/MainView.tsx'), 'utf-8');

  const REQUIRED = [
    '--color-bg-app', '--color-bg-sidebar', '--color-bg-content',
    '--color-bg-elevated', '--color-bg-input',
    '--color-text', '--color-text-soft',
    '--color-border', '--color-border-strong',
    '--color-primary', '--color-accent', '--color-accent-soft',
    '--color-success', '--color-warning', '--color-danger', '--color-info',
    '--font-sans', '--font-mono',
    '--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-lg', '--fs-xl',
    '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6',
    '--radius-sm', '--radius-md', '--radius-lg',
  ];

  it.each(REQUIRED)(`defines %s`, (token) => {
    const re = new RegExp(`${token}\\s*:`, 'm');
    expect(tokens, `missing token ${token}`).toMatch(re);
  });

  it('defines a [data-theme="dark"] block with overrides', () => {
    expect(tokens).toMatch(/\[data-theme="dark"\]\s*\{/);
  });

  it('loads only the new grounded UI styles', () => {
    expect(entry).toContain("./styles/grounded-tokens.css");
    expect(entry).toContain("./styles/workbench.css");
    expect(entry).not.toContain("./styles/global.css");
  });

  it('avoids sci-fi and AI-template visual effects', () => {
    expect(workbench).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/i);
    expect(workbench).not.toMatch(/text-shadow\s*:/i);
    expect(workbench).not.toMatch(/backdrop-filter\s*:/i);
  });

  it('fills the native window client area without an inset outer shell', () => {
    const mainViewBlocks = [...workbench.matchAll(/\.main-view\s*\{([^}]*)\}/g)];
    const mainView = mainViewBlocks[0]?.[1] ?? '';

    expect(mainViewBlocks).toHaveLength(1);
    expect(mainView).toMatch(/width:\s*100%\s*;/);
    expect(mainView).toMatch(/height:\s*100%\s*;/);
    expect(mainView).toMatch(/margin:\s*0\s*;/);
    expect(mainView).toMatch(/border:\s*0\s*;/);
    expect(mainView).toMatch(/border-radius:\s*0\s*;/);
    expect(mainView).toMatch(/box-shadow:\s*none\s*;/);
  });

  it('uses a frameless title bar without system window controls', () => {
    const windowOptions = electronMain.match(/new BrowserWindow\(\{([\s\S]*?)webPreferences:/)?.[1] ?? '';
    const header = workbench.match(/\.main-header\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(windowOptions).toMatch(/frame:\s*false/);
    expect(windowOptions).not.toMatch(/titleBarOverlay/);
    expect(windowOptions).not.toMatch(/trafficLightPosition/);
    expect(header).toMatch(/env\(titlebar-area-width/);
    expect(header).toMatch(/-webkit-app-region:\s*drag/);
    expect(workbench).toMatch(/\.main-header button,[\s\S]*?-webkit-app-region:\s*no-drag/);
    expect(workbench).not.toMatch(/data-platform='darwin'/);
    expect(header).toMatch(/padding: 0 max\(22px[^}]*0 22px/);
  });

  it('keeps the workspace inspector available across all main sections', () => {
    expect(mainView).toMatch(/\{props\.workspaceOpen\s*&&\s*activeWorkDir\s*&&\s*\(/);
    expect(mainView).not.toMatch(/activeSection\s*===\s*['"]tasks['"]\s*&&\s*props\.workspaceOpen/);
  });
});
