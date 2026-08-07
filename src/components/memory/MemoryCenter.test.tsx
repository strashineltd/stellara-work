import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Memory, MemoryStats } from '../../../shared/ipc';
import { MemoryCenter } from './MemoryCenter';

const DAY = 24 * 60 * 60 * 1000;

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    scope: 'personal',
    kind: 'fact',
    content: 'Agent 会自动沉淀任务要点',
    source: 'manual',
    importance: 0.5,
    confidence: 0.9,
    accessCount: 3,
    createdAt: Date.now() - DAY,
    updatedAt: Date.now() - DAY,
    ...overrides,
  };
}

const STATS: MemoryStats = {
  total: 2,
  byScope: { personal: 1, project: 1 },
  byKind: { fact: 2 },
  recentCount: 1,
};

function stubElectronAPI() {
  const memory = {
    search: vi.fn().mockResolvedValue([] as Memory[]),
    list: vi.fn().mockResolvedValue([] as Memory[]),
    save: vi.fn().mockResolvedValue(makeMemory()),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    stats: vi.fn().mockResolvedValue(STATS),
    exportSingle: vi.fn().mockResolvedValue({ path: '/tmp/x.md' }),
    exportAll: vi.fn().mockResolvedValue({ path: '/tmp/all.md', count: 2 }),
    copyMd: vi.fn().mockResolvedValue('# md\n'),
    onExtracted: vi.fn().mockReturnValue(() => {}),
  };
  const projects = {
    list: vi
      .fn()
      .mockResolvedValue([{ id: 'p1', name: '桌面端', updatedAt: 0, sessionCount: 1 }]),
  };
  (window as any).electronAPI = { memory, projects };
  return { memory, projects };
}

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => root!.unmount());
      document.body.removeChild(container);
    },
  };
}

async function renderCenter() {
  const view = render(<MemoryCenter />);
  await flushAsync();
  return view;
}

async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function fireClick(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for click');
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function byLabel(container: HTMLElement, label: string) {
  return container.querySelector(`[aria-label="${label}"]`);
}

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
}

describe('MemoryCenter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('renders the page header with title, create and export-all actions', async () => {
    stubElectronAPI();
    const { container } = await renderCenter();
    expect(container.querySelector('h1')?.textContent).toBe('记忆');
    expect(findButton(container, '新建记忆')).toBeTruthy();
    expect(findButton(container, '导出全部')).toBeTruthy();
  });

  it('groups pinned memories (importance >= 0.8) into 重要记忆 and the rest into 最近记忆', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([
      makeMemory({ id: 'p', importance: 0.9, content: '重要内容' }),
      makeMemory({ id: 'n', importance: 0.5, content: '普通内容' }),
    ]);
    const { container } = await renderCenter();
    const sections = Array.from(container.querySelectorAll('.memory-section'));
    expect(sections.length).toBe(2);
    expect(sections[0]?.textContent).toContain('重要记忆');
    expect(sections[0]?.textContent).toContain('重要内容');
    expect(sections[1]?.textContent).toContain('最近记忆');
    expect(sections[1]?.textContent).toContain('普通内容');
  });

  it('filters by scope when a chip is clicked', async () => {
    const stub = stubElectronAPI();
    const { container } = await renderCenter();
    const chip = Array.from(container.querySelectorAll('.memory-chip')).find((c) =>
      c.textContent?.includes('个人'),
    );
    fireClick(chip);
    await flushAsync();
    expect(stub.memory.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: 'personal' }),
    );
    expect(chip?.className).toContain('memory-chip--active');
  });

  it('shows the empty state with a create button when there are no memories', async () => {
    const { container } = await renderCenter();
    const empty = container.querySelector('.memory-empty');
    expect(empty).toBeTruthy();
    expect(empty?.textContent).toContain('还没有记忆');
    expect(container.querySelector('.memory-section')).toBeNull();
    const createBtn = Array.from(empty!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('新建记忆'),
    );
    fireClick(createBtn);
    expect(container.querySelector('[role="dialog"][aria-label="新建记忆"]')).toBeTruthy();
  });

  it('calls memory.exportAll when the header export-all button is clicked', async () => {
    const stub = stubElectronAPI();
    const { container } = await renderCenter();
    fireClick(findButton(container, '导出全部'));
    expect(stub.memory.exportAll).toHaveBeenCalledOnce();
  });

  it('opens the delete dialog and only deletes after confirmation', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory()]);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '删除'));
    expect(container.textContent).toContain('删除这条记忆？');
    expect(stub.memory.delete).not.toHaveBeenCalled();

    const confirm = findButton(container, '删除');
    fireClick(confirm);
    await flushAsync();
    expect(stub.memory.delete).toHaveBeenCalledWith('m1');
    expect(container.textContent).not.toContain('删除这条记忆？');
  });

  it('cancels deletion without calling memory.delete', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory()]);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '删除'));
    const cancel = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === '取消',
    );
    fireClick(cancel);
    expect(stub.memory.delete).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('删除这条记忆？');
  });

  it('opens the create dialog from the header create button', async () => {
    const { container } = await renderCenter();
    fireClick(findButton(container, '新建记忆'));
    expect(container.querySelector('[role="dialog"][aria-label="新建记忆"]')).toBeTruthy();
  });

  it('unpins a pinned memory via updateMemory and reloads', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory({ id: 'p', importance: 0.9 })]);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '取消置顶'));
    await flushAsync();
    expect(stub.memory.update).toHaveBeenCalledWith('p', { importance: 0.5 });
    expect(stub.memory.list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('pins a normal memory via updateMemory to 0.9', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory({ id: 'n', importance: 0.5 })]);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '置顶'));
    await flushAsync();
    expect(stub.memory.update).toHaveBeenCalledWith('n', { importance: 0.9 });
  });

  it('exports a single memory via exportSingle', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory({ id: 'x' })]);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '导出 MD'));
    expect(stub.memory.exportSingle).toHaveBeenCalledWith('x');
  });

  it('copies markdown to the clipboard via copyMd', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory({ id: 'x' })]);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '复制 MD'));
    await flushAsync();
    expect(stub.memory.copyMd).toHaveBeenCalledWith('x');
    expect((navigator as any).clipboard.writeText).toHaveBeenCalledWith('# md\n');
  });

  it('resolves project names for the card scope label', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([
      makeMemory({ id: 'x', scope: 'project', scopeId: 'p1' }),
    ]);
    const { container } = await renderCenter();
    expect(container.querySelector('.memory-card__scope')?.textContent).toContain(
      '项目 · 桌面端',
    );
  });

  it('falls back to 项目 when the project name cannot be resolved', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([
      makeMemory({ id: 'x', scope: 'project', scopeId: 'missing' }),
    ]);
    const { container } = await renderCenter();
    expect(container.querySelector('.memory-card__scope')?.textContent).toBe('项目');
  });

  it('shows scope counts on the chips from stats', async () => {
    const { container } = await renderCenter();
    const allChip = Array.from(container.querySelectorAll('.memory-chip')).find((c) =>
      c.textContent?.startsWith('全部'),
    );
    expect(allChip?.textContent).toContain('2');
  });
});
