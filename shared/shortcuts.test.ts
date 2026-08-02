import { describe, it, expect } from 'vitest';
import {
  SHORTCUT_DEFS,
  DEFAULT_SHORTCUTS,
  eventToBinding,
  formatBinding,
  findActionByBinding,
  type KeyEventLike,
} from './shortcuts';

function fakeEvent(opts: Partial<KeyEventLike>): KeyEventLike {
  return {
    key: opts.key ?? '',
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    metaKey: opts.metaKey ?? false,
  };
}

describe('SHORTCUT_DEFS', () => {
  it('has 17 actions', () => {
    expect(SHORTCUT_DEFS).toHaveLength(17);
  });

  it('all actions have unique action ids', () => {
    const ids = new Set(SHORTCUT_DEFS.map((d) => d.action));
    expect(ids.size).toBe(SHORTCUT_DEFS.length);
  });

  it('every defaultBinding is non-empty', () => {
    for (const def of SHORTCUT_DEFS) {
      expect(def.defaultBinding).toBeTruthy();
    }
  });
});

describe('DEFAULT_SHORTCUTS', () => {
  it('has bindings for all 17 actions', () => {
    expect(Object.keys(DEFAULT_SHORTCUTS)).toHaveLength(17);
  });

  it('bindings match defaultBinding in SHORTCUT_DEFS', () => {
    for (const def of SHORTCUT_DEFS) {
      expect(DEFAULT_SHORTCUTS[def.action]).toBe(def.defaultBinding);
    }
  });
});

describe('eventToBinding', () => {
  it('Ctrl+B', () => {
    expect(eventToBinding(fakeEvent({ key: 'b', ctrlKey: true }))).toBe('Ctrl+B');
  });

  it('Ctrl+Shift+P', () => {
    expect(eventToBinding(fakeEvent({ key: 'P', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+P');
  });

  it('Ctrl+Enter', () => {
    expect(eventToBinding(fakeEvent({ key: 'Enter', ctrlKey: true }))).toBe('Ctrl+Enter');
  });

  it('Escape alone', () => {
    expect(eventToBinding(fakeEvent({ key: 'Escape' }))).toBe('Escape');
  });

  it('metaKey 也算 Ctrl（Mac 兼容）', () => {
    expect(eventToBinding(fakeEvent({ key: 'b', metaKey: true }))).toBe('Ctrl+B');
  });

  it('空格转 Space', () => {
    expect(eventToBinding(fakeEvent({ key: ' ', ctrlKey: true }))).toBe('Ctrl+Space');
  });

  it('单独 modifier 不返回 binding', () => {
    expect(eventToBinding(fakeEvent({ key: 'Control' }))).toBeNull();
    expect(eventToBinding(fakeEvent({ key: 'Shift' }))).toBeNull();
    expect(eventToBinding(fakeEvent({ key: 'Alt' }))).toBeNull();
    expect(eventToBinding(fakeEvent({ key: 'Meta' }))).toBeNull();
  });

  it('Ctrl+Shift+W（区分大小写）', () => {
    expect(eventToBinding(fakeEvent({ key: 'w', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+W');
  });

  it('Alt+方向键', () => {
    expect(eventToBinding(fakeEvent({ key: 'ArrowUp', altKey: true }))).toBe('Alt+ArrowUp');
  });
});

describe('formatBinding', () => {
  it('加空格', () => {
    expect(formatBinding('Ctrl+Shift+P')).toBe('Ctrl + Shift + P');
  });

  it('简单 binding', () => {
    expect(formatBinding('Escape')).toBe('Escape');
  });
});

describe('findActionByBinding', () => {
  it('找到匹配的 action', () => {
    expect(findActionByBinding({}, 'Ctrl+B')).toBe('toggleSidebar');
    expect(findActionByBinding({}, 'Ctrl+Shift+P')).toBe('togglePlanMode');
  });

  it('用户覆盖 binding 后匹配新值', () => {
    expect(findActionByBinding({ toggleSidebar: 'Ctrl+K' }, 'Ctrl+K')).toBe('toggleSidebar');
    expect(findActionByBinding({ toggleSidebar: 'Ctrl+K' }, 'Ctrl+B')).toBeUndefined();
  });

  it('未匹配返回 undefined', () => {
    expect(findActionByBinding({}, 'Ctrl+Unknown')).toBeUndefined();
  });
});