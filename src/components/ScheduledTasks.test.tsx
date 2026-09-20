import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledRun, ScheduledTask } from '../../shared/ipc';
import { ScheduledTasks } from './ScheduledTasks';

const HOUR = 3_600_000;

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 't1',
    name: '每日构建巡检',
    prompt: '检查主分支构建状态',
    runtime: 'local',
    scheduleKind: 'cron',
    scheduleExpr: '0 9 * * *',
    enabled: true,
    nextRunAt: Date.now() + HOUR,
    lastRunAt: Date.now() - HOUR,
    lastStatus: 'success',
    createdAt: Date.now() - 2 * HOUR,
    updatedAt: Date.now() - HOUR,
    ...overrides,
  };
}

function makeRun(overrides: Partial<ScheduledRun> = {}): ScheduledRun {
  return {
    id: 'r1',
    taskId: 't1',
    startedAt: Date.now() - 2 * HOUR,
    finishedAt: Date.now() - 2 * HOUR + 12_000,
    status: 'success',
    sessionId: 'session-1',
    ...overrides,
  };
}

function stubApi(tasks: ScheduledTask[], runs: ScheduledRun[] = []) {
  const unsubscribe = vi.fn();
  const api = {
    scheduled: {
      list: vi.fn().mockResolvedValue(tasks),
      create: vi.fn().mockResolvedValue(makeTask()),
      update: vi.fn().mockResolvedValue(makeTask()),
      remove: vi.fn().mockResolvedValue(undefined),
      toggle: vi.fn().mockResolvedValue(undefined),
      runNow: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      runs: vi.fn().mockResolvedValue(runs),
      onChanged: vi.fn().mockReturnValue(unsubscribe),
    },
    servers: { list: vi.fn().mockResolvedValue([]) },
    models: { getAll: vi.fn().mockResolvedValue([]) },
    projects: { list: vi.fn().mockResolvedValue([]) },
    dialog: { selectProjectDir: vi.fn().mockResolvedValue(null) },
  };
  (window as any).electronAPI = api;
  return { api, unsubscribe };
}

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mountedViews = new Set<MountedView>();

async function renderScheduled(props: React.ComponentProps<typeof ScheduledTasks> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.add(view);
  await act(async () => {
    root.render(<ScheduledTasks {...props} />);
  });
  return {
    container,
    unmount: () => {
      if (!mountedViews.delete(view)) return;
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function setInput(element: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!element) throw new Error('Element not found for input');
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setSelect(element: HTMLSelectElement | null, value: string) {
  if (!element) throw new Error('Element not found for select');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function exactButton(container: ParentNode, text: string): HTMLElement | null {
  return Array.from(container.querySelectorAll<HTMLElement>('button')).find(
    (button) => button.textContent?.trim() === text,
  ) ?? null;
}

function byLabel(container: ParentNode, label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

function taskRow(container: ParentNode, id: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`.scheduled-task-row[data-task-id="${id}"]`);
  if (!row) throw new Error(`Task row not found: ${id}`);
  return row;
}

async function openCreateDialog(container: HTMLElement): Promise<HTMLElement> {
  await click(exactButton(container, '新建任务'));
  const dialog = container.querySelector<HTMLElement>('.scheduled-dialog');
  if (!dialog) throw new Error('Create dialog did not open');
  return dialog;
}

async function fillRequiredFields(
  dialog: HTMLElement,
  { name = '巡检任务', prompt = '检查构建状态' }: { name?: string; prompt?: string } = {},
) {
  setInput(byLabel(dialog, '任务名') as HTMLInputElement | null, name);
  setInput(byLabel(dialog, '提示词') as HTMLTextAreaElement | null, prompt);
  setInput(byLabel(dialog, '执行时间') as HTMLInputElement | null, '2099-01-01T09:00');
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  mountedViews.forEach(({ container, root }) => {
    act(() => root.unmount());
    container.remove();
  });
  mountedViews.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('ScheduledTasks 列表', () => {
  it('renders tasks with target badge, next run, last status and switch state', async () => {
    stubApi(
      [
        makeTask(),
        makeTask({
          id: 't2',
          name: '间隔值班',
          runtime: 'server',
          serverId: 'srv-1',
          scheduleKind: 'interval',
          scheduleExpr: '30',
          enabled: false,
          nextRunAt: null,
          lastStatus: null,
        }),
      ],
      [],
    );
    const { container } = await renderScheduled();

    expect(container.textContent).toContain('每日构建巡检');
    expect(container.textContent).toContain('间隔值班');
    expect(taskRow(container, 't1').textContent).toContain('本地');
    expect(taskRow(container, 't2').textContent).toContain('服务器');
    expect(taskRow(container, 't1').textContent).toContain('下次运行');
    expect(taskRow(container, 't1').textContent).toContain('成功');
    expect(taskRow(container, 't2').textContent).toContain('已停用');
    expect(taskRow(container, 't1').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(taskRow(container, 't2').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('renders the empty state when there are no tasks', async () => {
    stubApi([]);
    const { container } = await renderScheduled();
    expect(container.textContent).toContain('还没有定时任务');
    expect(exactButton(container, '新建任务')).toBeTruthy();
  });
});

describe('ScheduledTasks 行操作', () => {
  it('toggling the switch calls scheduled.toggle for that task', async () => {
    const { api } = stubApi([makeTask()]);
    const { container } = await renderScheduled();
    await click(taskRow(container, 't1').querySelector('[role="switch"]'));
    expect(api.scheduled.toggle).toHaveBeenCalledWith('t1');
  });

  it('shows the error banner when toggle fails, even after the reload settles', async () => {
    const { api } = stubApi([makeTask()]);
    api.scheduled.toggle.mockRejectedValueOnce(new Error('无法启用：执行时间已过期'));
    const { container } = await renderScheduled();

    await click(taskRow(container, 't1').querySelector('[role="switch"]'));

    const banner = container.querySelector<HTMLElement>('.error-banner');
    expect(banner?.textContent).toContain('无法启用：执行时间已过期');
  });

  it('立即运行 calls scheduled.runNow', async () => {
    const { api } = stubApi([makeTask()]);
    const { container } = await renderScheduled();
    await click(exactButton(taskRow(container, 't1'), '立即运行'));
    expect(api.scheduled.runNow).toHaveBeenCalledWith('t1');
  });

  it('运行中的任务显示停止按钮并调用 scheduled.abort', async () => {
    const { api } = stubApi([makeTask({ running: true })]);
    const { container } = await renderScheduled();
    const row = taskRow(container, 't1');

    expect(exactButton(row, '停止')).toBeTruthy();
    expect((exactButton(row, '立即运行') as HTMLButtonElement).disabled).toBe(true);

    await click(exactButton(row, '停止'));
    expect(api.scheduled.abort).toHaveBeenCalledWith('t1');
  });

  it('非运行任务不显示停止按钮', async () => {
    stubApi([makeTask()]);
    const { container } = await renderScheduled();
    expect(exactButton(taskRow(container, 't1'), '停止')).toBeNull();
    expect((exactButton(taskRow(container, 't1'), '立即运行') as HTMLButtonElement).disabled).toBe(false);
  });

  it('行操作进行中时该行按钮禁用（防连点）', async () => {
    const { api } = stubApi([makeTask()]);
    const gate = deferred<void>();
    api.scheduled.toggle.mockReturnValueOnce(gate.promise);
    const { container } = await renderScheduled();
    const row = taskRow(container, 't1');

    await click(row.querySelector('[role="switch"]'));
    const runNowButton = exactButton(row, '立即运行') as HTMLButtonElement;
    const removeButton = exactButton(row, '删除') as HTMLButtonElement;
    const switchButton = row.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(runNowButton.disabled).toBe(true);
    expect(removeButton.disabled).toBe(true);
    expect(switchButton.disabled).toBe(true);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(runNowButton.disabled).toBe(false);
    expect(removeButton.disabled).toBe(false);
    expect(switchButton.disabled).toBe(false);
  });

  it('删除 requires a secondary confirmation before calling scheduled.remove', async () => {
    const { api } = stubApi([makeTask()]);
    const { container } = await renderScheduled();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await click(exactButton(taskRow(container, 't1'), '删除'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(api.scheduled.remove).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await click(exactButton(taskRow(container, 't1'), '删除'));
    expect(api.scheduled.remove).toHaveBeenCalledWith('t1');
  });

  it('编辑 opens a prefilled dialog and saves through scheduled.update', async () => {
    const { api } = stubApi([makeTask()]);
    const { container } = await renderScheduled();
    await click(exactButton(taskRow(container, 't1'), '编辑'));

    const dialog = container.querySelector<HTMLElement>('.scheduled-dialog');
    expect(dialog?.getAttribute('aria-label')).toBe('编辑任务');
    const nameInput = byLabel(dialog!, '任务名') as HTMLInputElement;
    expect(nameInput.value).toBe('每日构建巡检');

    setInput(nameInput, '巡检 v2');
    await click(exactButton(dialog!, '保存'));
    expect(api.scheduled.update).toHaveBeenCalledTimes(1);
    expect(api.scheduled.update.mock.calls[0][0]).toBe('t1');
    expect(api.scheduled.update.mock.calls[0][1]).toMatchObject({ name: '巡检 v2' });
  });
});

describe('ScheduledTasks 对话框校验', () => {
  it('blocks save until name, prompt and schedule are valid', async () => {
    const { api } = stubApi([]);
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);

    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('任务名不能为空');

    setInput(byLabel(dialog, '任务名') as HTMLInputElement | null, '巡检任务');
    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('提示词不能为空');

    setInput(byLabel(dialog, '提示词') as HTMLTextAreaElement | null, '检查构建状态');
    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('请选择执行时间');

    setInput(byLabel(dialog, '执行时间') as HTMLInputElement | null, '2099-01-01T09:00');
    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).toHaveBeenCalledTimes(1);
    const input = api.scheduled.create.mock.calls[0][0];
    expect(input).toMatchObject({ name: '巡检任务', prompt: '检查构建状态', scheduleKind: 'once' });
    expect(input.scheduleExpr).toBe(new Date('2099-01-01T09:00').toISOString());
  });

  it('a cron preset fills the expression field', async () => {
    stubApi([]);
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);
    setSelect(byLabel(dialog, '调度方式') as HTMLSelectElement | null, 'cron');

    await click(exactButton(dialog, '每天 9:00'));
    expect((byLabel(dialog, 'Cron 表达式') as HTMLInputElement).value).toBe('0 9 * * *');

    await click(exactButton(dialog, '每 5 分钟'));
    expect((byLabel(dialog, 'Cron 表达式') as HTMLInputElement).value).toBe('*/5 * * * *');
  });

  it('surfaces IPC schedule rejection inside the dialog', async () => {
    const { api } = stubApi([]);
    api.scheduled.create.mockRejectedValueOnce(new Error('无效的 Cron 表达式'));
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);

    setInput(byLabel(dialog, '任务名') as HTMLInputElement | null, '巡检任务');
    setInput(byLabel(dialog, '提示词') as HTMLTextAreaElement | null, '检查构建状态');
    setSelect(byLabel(dialog, '调度方式') as HTMLSelectElement | null, 'cron');
    setInput(byLabel(dialog, 'Cron 表达式') as HTMLInputElement | null, 'bad cron');

    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.scheduled-dialog')).toBeTruthy();
    expect(dialog.textContent).toContain('无效的 Cron 表达式');
  });
});

describe('ScheduledTasks 写操作策略', () => {
  it('未选择写工具时保存不带 policy', async () => {
    const { api } = stubApi([]);
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);
    await fillRequiredFields(dialog);
    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).toHaveBeenCalledTimes(1);
    expect(api.scheduled.create.mock.calls[0][0].policy).toBeUndefined();
  });

  it('选择写工具但缺少范围时提示且不保存', async () => {
    const { api } = stubApi([]);
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);
    await fillRequiredFields(dialog);
    await click(byLabel(dialog, '编辑文件'));
    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('可写范围');
  });

  it('填写完整并确认后保存带 policy', async () => {
    const { api } = stubApi([]);
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);
    await fillRequiredFields(dialog);
    await click(byLabel(dialog, '编辑文件'));
    setInput(byLabel(dialog, '可写范围') as HTMLTextAreaElement | null, 'src/**');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click(exactButton(dialog, '创建'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(api.scheduled.create.mock.calls[0][0].policy).toEqual({
      allowedTools: ['edit_file'], fileScopes: ['src/**'], allowedCommands: [],
    });
  });

  it('风险确认被拒绝时不保存', async () => {
    const { api } = stubApi([]);
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);
    await fillRequiredFields(dialog);
    await click(byLabel(dialog, '运行命令'));
    setInput(byLabel(dialog, '命令白名单') as HTMLTextAreaElement | null, 'npm test');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).not.toHaveBeenCalled();
  });

  it('卡片展示策略摘要', async () => {
    stubApi([makeTask({ policy: { allowedTools: ['edit_file'], fileScopes: ['src/**'], allowedCommands: [] } })]);
    const { container } = await renderScheduled();
    const row = taskRow(container, 't1');
    expect(row.textContent).toContain('写操作：编辑文件');
    expect(row.textContent).toContain('范围 src/**');
  });
});

describe('ScheduledTasks 执行历史', () => {
  it('opens the history panel, renders the last runs and wires session jump', async () => {
    const onOpenSession = vi.fn();
    const runs = [
      makeRun(),
      makeRun({ id: 'r2', status: 'error', sessionId: undefined, error: 'Agent 执行失败', finishedAt: null }),
      makeRun({ id: 'r3', status: 'running', sessionId: undefined, finishedAt: null }),
    ];
    const { api } = stubApi([makeTask()], runs);
    const { container } = await renderScheduled({ onOpenSession });

    await click(exactButton(taskRow(container, 't1'), '历史'));
    expect(api.scheduled.runs).toHaveBeenCalledWith('t1');

    const panel = container.querySelector<HTMLElement>('.scheduled-history');
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain('每日构建巡检');
    expect(panel!.textContent).toContain('成功');
    expect(panel!.textContent).toContain('失败');
    expect(panel!.textContent).toContain('运行中');
    expect(panel!.textContent).toContain('Agent 执行失败');

    await click(exactButton(panel!, '查看会话'));
    expect(onOpenSession).toHaveBeenCalledWith('session-1');
  });

  it('shows an empty hint when a task has no runs', async () => {
    stubApi([makeTask()], []);
    const { container } = await renderScheduled();
    await click(exactButton(taskRow(container, 't1'), '历史'));
    const panel = container.querySelector<HTMLElement>('.scheduled-history');
    expect(panel?.textContent).toContain('暂无执行记录');
  });
});

describe('ScheduledTasks 变更订阅', () => {
  it('refreshes on scheduled.onChanged and unsubscribes on unmount', async () => {
    const { api, unsubscribe } = stubApi([makeTask()]);
    const { unmount } = await renderScheduled();
    const onChange = api.scheduled.onChanged.mock.calls[0][0] as () => void;
    const callsBefore = api.scheduled.list.mock.calls.length;

    await act(async () => {
      onChange();
    });
    expect(api.scheduled.list.mock.calls.length).toBeGreaterThan(callsBefore);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
