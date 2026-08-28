import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'workbench.css'), 'utf8');

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectorBlock(...selectors: string[]): string {
  const prelude = selectors.map(escapeRegex).join('\\s*,\\s*');
  const leadingComments = '(?:/\\*[\\s\\S]*?\\*/\\s*)*';
  return css.match(new RegExp(`(?:^|})\\s*${leadingComments}${prelude}\\s*\\{([^{}]*)\\}`))?.[1] ?? '';
}

function keyframeFromBlock(name: string): string {
  return css.match(new RegExp(`@keyframes\\s+${escapeRegex(name)}\\s*\\{\\s*from\\s*\\{([^{}]*)\\}`))?.[1] ?? '';
}

describe('motion contracts', () => {
  it('uses direction-aware state-driven menu motion', () => {
    const menu = selectorBlock("[data-motion='menu']");
    const topMenu = selectorBlock("[data-motion='menu'][data-side='top']");
    const stateMenu = selectorBlock(
      "[data-motion='menu'][data-motion-state='entering']",
      "[data-motion='menu'][data-motion-state='closing']",
    );
    const closingMenu = selectorBlock("[data-motion='menu'][data-motion-state='closing']");
    const modelMenu = selectorBlock('.model-switcher-menu');

    expect(menu).toMatch(/--menu-offset-y:\s*calc\(-1 \* var\(--motion-distance-sm\)\)/);
    expect(menu).toMatch(/--menu-enter-duration:\s*var\(--motion-base\)/);
    expect(menu).toMatch(/transition:\s*opacity\s+var\(--menu-enter-duration\)\s+var\(--ease-out\)\s*,\s*transform\s+var\(--menu-enter-duration\)\s+var\(--ease-out\)\s*;/);
    expect(topMenu).toMatch(/--menu-offset-y:\s*var\(--motion-distance-sm\)/);
    expect(stateMenu).toMatch(/opacity:\s*0\s*;/);
    expect(stateMenu).toMatch(/transform:\s*translate\(var\(--menu-x\),\s*var\(--menu-offset-y\)\)\s*;/);
    expect(closingMenu).toMatch(/transition-duration:\s*var\(--motion-fast\)/);
    expect(closingMenu).toMatch(/transition-timing-function:\s*var\(--ease-in\)/);
    expect(modelMenu).toMatch(/--menu-x:\s*-50%/);
    expect(modelMenu).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(selectorBlock('.slash-menu')).toMatch(/--menu-enter-duration:\s*var\(--motion-fast\)/);
    expect(css).not.toMatch(/\b(?:popover-enter|model-popover-enter)\b/);
  });

  it('keeps ordinary task entries static', () => {
    expect(selectorBlock('.entry')).not.toMatch(/animation\s*:/);
    expect(selectorBlock('.main-chat')).not.toMatch(/animation\s*:/);
  });

  it('animates only explicit live entry classes with approved motion tokens', () => {
    const live = selectorBlock('.entry--live');
    const statusLive = selectorBlock('.entry--status-live');
    const statusEnter = css.match(/@keyframes\s+status-enter\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(live).toMatch(/animation:\s*entry-enter\s+var\(--motion-base\)\s+var\(--ease-out\)\s+both\s*;/);
    expect(statusLive).toMatch(/animation:\s*status-enter\s+var\(--motion-fast\)\s+var\(--ease-out\)\s+both\s*;/);
    expect(statusEnter).toMatch(/from\s*\{\s*opacity:\s*0\s*;\s*transform:\s*translateY\(var\(--motion-distance-xs\)\);\s*\}/);
    expect(statusEnter).toMatch(/to\s*\{\s*opacity:\s*1\s*;\s*transform:\s*translateY\(0\);\s*\}/);
    expect(live).not.toMatch(/will-change|transition:\s*all/);
    expect(statusLive).not.toMatch(/will-change|transition:\s*all/);
  });

  it('uses approved page and settings distances', () => {
    const pageMotion = selectorBlock(
      "[data-motion='page-enter']",
      "[data-motion='onboarding-step-enter']",
    );
    const settingsMotion = selectorBlock("[data-motion='settings-content-enter']");
    const pageKeyframes = keyframeFromBlock('page-content-enter');
    const settingsKeyframes = keyframeFromBlock('settings-content-enter');

    expect(pageMotion).toMatch(/animation:\s*page-content-enter\s+var\(--motion-base\)\s+var\(--ease-out\)\s+both\s*;/);
    expect(settingsMotion).toMatch(/animation:\s*settings-content-enter\s+var\(--motion-fast\)\s+var\(--ease-out\)\s+both\s*;/);
    expect(pageKeyframes).toMatch(/transform:\s*translateY\(var\(--motion-distance-sm\)\)/);
    expect(settingsKeyframes).toMatch(/transform:\s*translateY\(var\(--motion-distance-xs\)\)/);
    expect(selectorBlock('.settings-panels')).not.toMatch(/(?:^|;)\s*(?:animation|width|height)\s*:/);
  });

  it('applies one-shot status-enter feedback to newly mounting status nodes', () => {
    const feedback = selectorBlock('.motion-feedback-enter');
    expect(feedback).toMatch(/animation:\s*status-enter\s+var\(--motion-fast\)\s+var\(--ease-out\)\s+both\s*;/);
    expect(feedback).not.toMatch(/infinite/);
    expect(feedback).not.toMatch(/will-change|transition:\s*all/);
  });
});
