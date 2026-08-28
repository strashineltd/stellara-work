import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REDUCED_MOTION_QUERY } from '../hooks/useReducedMotion';
import { DEFAULT_PRESENCE_EXIT_MS } from '../hooks/usePresence';

function extractCssBlock(source: string, prelude: string): string | null {
  const escapedPrelude = prelude.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|})\\s*${escapedPrelude}\\s*\\{`, 'm').exec(source);
  if (!match) return null;
  const openingBrace = match.index + match[0].lastIndexOf('{');
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  return null;
}

const SIDEBAR_OVERLAY_DECLARATIONS = [
  /position:\s*absolute\s*;/,
  /z-index:\s*var\(--z-overlay-panel\)\s*;/,
  /top:\s*0\s*;/,
  /bottom:\s*0\s*;/,
  /left:\s*0\s*;/,
  /box-shadow:\s*var\(--shadow-lg\)\s*;/,
];

function hasSidebarOverlayRule(mediaBlock: string | null): boolean {
  if (!mediaBlock) return false;
  const sidebarBlock = extractCssBlock(mediaBlock, '.sidebar');
  return sidebarBlock !== null
    && SIDEBAR_OVERLAY_DECLARATIONS.every((declaration) => declaration.test(sidebarBlock));
}

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

  const MOTION_TOKENS = [
    ['--motion-fast', '120ms'],
    ['--motion-base', '180ms'],
    ['--motion-slow', '220ms'],
    ['--motion-exit', '140ms'],
    ['--ease-standard', 'cubic-bezier(0.2, 0, 0, 1)'],
    ['--ease-out', 'cubic-bezier(0.16, 1, 0.3, 1)'],
    ['--ease-in', 'cubic-bezier(0.4, 0, 1, 1)'],
    ['--motion-distance-xs', '2px'],
    ['--motion-distance-sm', '4px'],
    ['--motion-distance-md', '8px'],
    ['--motion-loop-spin', '800ms'],
    ['--motion-loop-pulse', '1200ms'],
  ] as const;

  it.each(REQUIRED)(`defines %s`, (token) => {
    const re = new RegExp(`${token}\\s*:`, 'm');
    expect(tokens, `missing token ${token}`).toMatch(re);
  });

  it.each(MOTION_TOKENS)('defines %s as %s', (token, value) => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(tokens).toMatch(new RegExp(`${token}\\s*:\\s*${escaped}\\s*;`));
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

  it('keeps native window controls (macOS traffic lights / Windows overlay)', () => {
    const windowOptions = electronMain.match(/new BrowserWindow\(\{([\s\S]*?)webPreferences:/)?.[1] ?? '';
    const header = workbench.match(/\.main-header\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(windowOptions).toMatch(/titleBarStyle:\s*isMac \? 'hiddenInset' : 'hidden'/);
    expect(windowOptions).toMatch(/trafficLightPosition/);
    expect(windowOptions).toMatch(/titleBarOverlay/);
    expect(header).toMatch(/env\(titlebar-area-width/);
    expect(header).toMatch(/-webkit-app-region:\s*drag/);
    expect(workbench).toMatch(/\.main-header button,[\s\S]*?-webkit-app-region:\s*no-drag/);
    expect(workbench).toMatch(/html\[data-platform='darwin'\]\s*\.main-header\s*\{/);
    expect(header).toMatch(/padding: 0 max\(22px[^}]*0 22px/);
  });

  it('stacks the macOS sidebar toggle below the traffic-light controls', () => {
    const macHeader = workbench.match(/html\[data-platform='darwin'\]\s*\.main-header\s*\{([^}]*)\}/)?.[1] ?? '';
    const macSidebarToggle = workbench.match(/html\[data-platform='darwin'\]\s*\.sidebar-toggle\s*\{([^}]*)\}/)?.[1] ?? '';
    const macSidebar = workbench.match(/html\[data-platform='darwin'\]\s*\.sidebar\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(macHeader).toMatch(/padding-left:\s*82px\s*;/);
    expect(macSidebarToggle).toMatch(/position:\s*absolute\s*;/);
    expect(macSidebarToggle).toMatch(/left:\s*14px\s*;/);
    expect(macSidebarToggle).toMatch(/top:\s*28px\s*;/);
    expect(macSidebar).toMatch(/margin-top:\s*12px\s*;/);
  });

  it('coordinates CSS and JavaScript reduced motion', () => {
    expect(DEFAULT_PRESENCE_EXIT_MS).toBe(140);
    expect(tokens).toMatch(/--motion-exit:\s*140ms\s*;/);
    expect(workbench).toContain(`@media ${REDUCED_MOTION_QUERY}`);
    expect(workbench).toMatch(/animation-duration:\s*0s\s*!important/);
    expect(workbench).toMatch(/animation-delay:\s*0s\s*!important/);
    expect(workbench).toMatch(/transition-duration:\s*0s\s*!important/);
    expect(workbench).toMatch(/transition-delay:\s*0s\s*!important/);
    expect(workbench).not.toContain('0.01ms');
    expect(workbench).toMatch(/\[data-motion-state=['"]closing['"]\][^{]*\{[^}]*pointer-events:\s*none/);
    expect(workbench).not.toMatch(/transition\s*:\s*all\b/);
  });

  it('uses state-driven panel and modal transitions', () => {
    expect(workbench).not.toMatch(/\.sidebar\s*\{[^}]*animation:/);
    expect(workbench).not.toMatch(/\.workspace-panel\s*\{[^}]*animation:/);
    expect(workbench).toMatch(/\.sidebar\[data-motion-state=['"]entering['"]\][^{]*\{[^}]*translateX/);
    expect(workbench).toMatch(/\.workspace-panel\[data-motion-state=['"]closing['"]\][^{]*\{[^}]*translateX/);
    expect(workbench).toMatch(/\.modal-backdrop\[data-motion-state=['"]closing['"]\][^{]*\{[^}]*--motion-exit/);
    expect(workbench).not.toMatch(/(?:width|height|flex-basis|grid-template-columns)\s+var\(--motion/);
  });

  it('uses canonical active status loops', () => {
    expect(workbench).toMatch(/\.loading-spinner\s*\{[^}]*animation:\s*spin var\(--motion-loop-spin\) linear infinite/);
    expect(workbench).toMatch(/\.thinking::before\s*\{[^}]*animation:\s*pulse var\(--motion-loop-pulse\) ease-in-out infinite/);
    expect(workbench).toMatch(/\.plan-step-spinner\.is-active\s*\{[^}]*animation:\s*spin var\(--motion-loop-spin\) linear infinite/);
    expect(workbench).not.toMatch(/\.plan-step-spinner\s*\{[^}]*animation:/);
    expect(workbench).toMatch(/\.kbd\.rec\s*\{[^}]*animation:\s*pulse var\(--motion-loop-pulse\) ease-in-out infinite/);
    expect(workbench).not.toMatch(/@keyframes\s+plan-spin/);
    expect(workbench).not.toMatch(/@keyframes\s+settings-kbd-pulse/);
  });

  it('pauses only approved loops while the page is hidden', () => {
    expect(workbench).toMatch(
      /html\[data-page-hidden\]\s*\.loading-spinner,[\s\S]*?html\[data-page-hidden\]\s*\.thinking::before,[\s\S]*?html\[data-page-hidden\]\s*\.plan-step-spinner\.is-active,[\s\S]*?html\[data-page-hidden\]\s*\.kbd\.rec\s*\{[^}]*animation-play-state:\s*paused\s*;/,
    );
    expect(workbench).not.toMatch(/html\[data-page-hidden\][^{]*\*/);
  });

  it('animates progress with scaleX transforms instead of width transitions', () => {
    expect(workbench).not.toMatch(/transition:\s*width/);
    expect(workbench).toMatch(/\.progress-bar,\s*\n\s*\.context-stats__bar-fill\s*\{[^}]*width:\s*100%;[^}]*transform-origin:\s*left center;/);
    expect(workbench).toMatch(/transition:\s*transform\s+var\(--motion-slow\)\s+var\(--ease-out\)\s*;/);
    expect(workbench).toMatch(/transition:\s*transform\s+var\(--motion-slow\)\s+var\(--ease-out\)\s*,\s*background-color\s+var\(--motion-fast\)\s+var\(--ease-standard\)\s*;/);
  });

  it('completes the microinteraction property contract', () => {
    expect(workbench).not.toMatch(/transition\s*:\s*all\b/);
    expect(workbench).not.toMatch(/transition\s*:\s*width\b/);
    expect(workbench).not.toMatch(/\.btn-danger:hover[^}]*filter\s*:/);
    expect(workbench).not.toContain('0.15s ease');
    expect(workbench).not.toMatch(/transform:\s*scale\((?!X)/);
    expect(workbench).toMatch(/\.continue-row\s*\{[^}]*border-color var\(--motion-fast\)/);

    const attachBtn = extractCssBlock(workbench, '.attach-btn');
    const attachChip = extractCssBlock(workbench, 'button.attach-chip');
    expect(attachBtn).toMatch(/transition:[\s\S]*background-color var\(--motion-fast\)/);
    expect(attachBtn).not.toMatch(/background var\(--motion-fast\)/);
    expect(attachChip).toMatch(/transition:[\s\S]*background-color var\(--motion-fast\)/);
    expect(attachChip).not.toMatch(/background var\(--motion-fast\)/);

    const settingsSwitch = extractCssBlock(workbench, '.settings-switch');
    const settingsKnob = extractCssBlock(workbench, '.settings-switch::after');
    expect(settingsSwitch).toMatch(/transition:[\s\S]*background-color var\(--motion-fast\)/);
    expect(settingsSwitch).not.toMatch(/background var\(--motion-fast\)/);
    expect(settingsKnob).toMatch(/transition:[\s\S]*background-color var\(--motion-fast\)/);
    expect(settingsKnob).not.toMatch(/background var\(--motion-fast\)/);
  });

  it('gives every hover microinteraction an explicit 120ms property list', () => {
    const fastTransition = (properties: string[]) =>
      new RegExp(
        `transition:\\s*${properties
          .map((p) => `${p} var\\(--motion-fast\\) var\\(--ease-standard\\)`)
          .join(',\\s*')}\\s*;`,
      );

    expect(extractCssBlock(workbench, '.model-pill')).toMatch(
      fastTransition(['color', 'background-color']),
    );
    expect(extractCssBlock(workbench, '.attach-chip-remove')).toMatch(
      fastTransition(['color', 'background-color']),
    );
    expect(extractCssBlock(workbench, '.attach-thumb-wrap')).toMatch(
      fastTransition(['border-color']),
    );
    expect(extractCssBlock(workbench, '.new-entry-menu__item')).toMatch(
      fastTransition(['background-color']),
    );
    expect(extractCssBlock(workbench, '.radio-card')).toMatch(
      fastTransition(['color', 'background-color', 'border-color']),
    );
    expect(extractCssBlock(workbench, '.settings-skill-row')).toMatch(
      fastTransition(['background-color']),
    );
    expect(extractCssBlock(workbench, '.settings-mcp-row')).toMatch(
      fastTransition(['background-color']),
    );
    expect(extractCssBlock(workbench, '.settings-mcp-expand')).toMatch(
      fastTransition(['color', 'background-color']),
    );
    expect(extractCssBlock(workbench, '.settings-shortcut-row')).toMatch(
      fastTransition(['background-color']),
    );
    expect(extractCssBlock(workbench, '.hoverable-path')).toMatch(
      fastTransition(['background-color']),
    );
    expect(workbench).toMatch(
      /\.header-menu-item,[\s\S]*?\.context-menu > li\s*\{[^}]*transition:\s*background-color var\(--motion-fast\) var\(--ease-standard\)\s*;/,
    );
  });

  it('keeps the workspace inspector available across all main sections', () => {
    expect(mainView).toMatch(/const workspacePresent\s*=\s*props\.workspaceOpen\s*&&\s*Boolean\(activeWorkDir\)/);
    expect(mainView).toMatch(/\{workspacePresence\.mounted\s*&&\s*retainedWorkDirRef\.current\s*&&\s*\(/);
    expect(mainView).not.toMatch(/activeSection\s*===\s*['"]tasks['"]\s*&&\s*props\.workspaceOpen/);
  });

  it('places the complete sidebar overlay rule at 920px but not 780px', () => {
    const media920 = extractCssBlock(workbench, '@media (max-width: 920px)');
    const media780 = extractCssBlock(workbench, '@media (max-width: 780px)');

    expect(media920).not.toBeNull();
    expect(media780).not.toBeNull();
    expect(hasSidebarOverlayRule(media920)).toBe(true);
    expect(hasSidebarOverlayRule(media780)).toBe(false);
  });
});
