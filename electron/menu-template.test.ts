import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { buildAppMenuTemplate } from './menu-template';

type Item = MenuItemConstructorOptions;

function submenuOf(template: Item[], label: string): Item[] {
  const item = template.find((entry) => entry.label === label);
  expect(item, `顶层菜单 ${label}`).toBeDefined();
  return item?.submenu as Item[];
}

function rolesOf(items: Item[]): string[] {
  return items.flatMap((item) => (typeof item.role === 'string' ? [item.role] : []));
}

describe('buildAppMenuTemplate', () => {
  const base = { appName: 'Stellara Work', openHomepage: () => {} };

  it('omits reload, forceReload and toggleDevTools in production', () => {
    const template = buildAppMenuTemplate({ ...base, isDev: false, onAction: () => {} });
    const viewRoles = rolesOf(submenuOf(template, '视图'));

    expect(viewRoles).not.toContain('reload');
    expect(viewRoles).not.toContain('forceReload');
    expect(viewRoles).not.toContain('toggleDevTools');
    expect(viewRoles).toEqual(
      expect.arrayContaining(['resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen']),
    );
  });

  it('includes reload, forceReload and toggleDevTools in development', () => {
    const template = buildAppMenuTemplate({ ...base, isDev: true, onAction: () => {} });
    const viewRoles = rolesOf(submenuOf(template, '视图'));

    expect(viewRoles).toEqual(
      expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools']),
    );
  });

  it('keeps settings, new session, edit roles and quit working in production', () => {
    const onAction = vi.fn();
    const template = buildAppMenuTemplate({ ...base, isDev: false, onAction });
    const appItems = submenuOf(template, 'Stellara Work');
    const viewItems = submenuOf(template, '视图');
    const editItems = submenuOf(template, '编辑');
    const taskItems = submenuOf(template, '任务');
    const all = [...appItems, ...viewItems, ...editItems, ...taskItems];

    expect(rolesOf(appItems)).toContain('quit');
    expect(rolesOf(editItems)).toEqual(
      expect.arrayContaining(['undo', 'redo', 'copy', 'paste', 'selectAll']),
    );

    const settings = all.find((item) => item.label === '设置…');
    const newSession = all.find((item) => item.label === '新建会话');
    expect(settings?.click).toBeTypeOf('function');
    expect(newSession?.click).toBeTypeOf('function');
    settings?.click?.(undefined as never, undefined, undefined as never);
    newSession?.click?.(undefined as never, undefined, undefined as never);

    expect(onAction).toHaveBeenCalledWith('open-settings');
    expect(onAction).toHaveBeenCalledWith('new-session');
  });
});
