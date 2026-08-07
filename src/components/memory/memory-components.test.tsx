import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Memory } from '../../../shared/ipc';
import { MemoryCard } from './MemoryCard';
import { MemoryDeleteDialog } from './MemoryDeleteDialog';
import { MemoryEditDialog } from './MemoryEditDialog';

const DAY = 24 * 60 * 60 * 1000;

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    scope: 'personal',
    kind: 'fact',
    content: 'Agent 工具白名单（POSIX）：npm/node/git。',
    source: 'manual',
    importance: 0.5,
    confidence: 0.9,
    accessCount: 3,
    createdAt: Date.now() - DAY,
    updatedAt: Date.now() - DAY,
    ...overrides,
  };
}

const LONG_CONTENT = '这是一条很长的记忆内容，'.repeat(9);

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

function fireClick(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for click');
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function byLabel(container: HTMLElement, label: string) {
  return container.querySelector(`[aria-label="${label}"]`);
}

describe('MemoryCard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clamps long content and expands to reveal meta row', () => {
    const { container } = render(
      <MemoryCard
        memory={makeMemory({
          content: LONG_CONTENT,
          source: 'session:abc123',
          accessCount: 12,
          updatedAt: Date.now() - DAY + 1000,
        })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onCopy={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const content = container.querySelector('.memory-card__content');
    expect(content).toBeTruthy();
    expect(content?.className).toContain('memory-card__content--clamped');
    expect(content?.textContent).toContain('展开');
    expect(container.querySelector('.memory-card__meta')).toBeNull();

    fireClick(container.querySelector('.memory-card__more'));

    expect(content?.className).not.toContain('memory-card__content--clamped');
    const meta = container.querySelector('.memory-card__meta');
    expect(meta).toBeTruthy();
    expect(meta?.textContent).toContain('Agent 自动提取');
    expect(meta?.textContent).toContain('使用 12 次');
    expect(meta?.textContent).toContain('创建');
    expect(meta?.textContent).toContain('更新');
  });

  it('keeps short content unclamped without an expand link', () => {
    const { container } = render(
      <MemoryCard memory={makeMemory()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.querySelector('.memory-card__content--clamped')).toBeNull();
    expect(container.querySelector('.memory-card__more')).toBeNull();
    expect(container.querySelector('.memory-card__meta')).toBeNull();
  });

  it('renders the five action buttons with aria-labels', () => {
    const { container } = render(
      <MemoryCard
        memory={makeMemory()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onCopy={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    for (const label of ['置顶', '编辑', '导出 MD', '复制 MD', '删除']) {
      expect(byLabel(container, label)).toBeTruthy();
    }
  });

  it('shows the pin action in its on state for pinned memories', () => {
    const { container } = render(
      <MemoryCard memory={makeMemory({ importance: 0.9 })} onTogglePin={vi.fn()} />,
    );
    expect(container.querySelector('.memory-card')?.className).toContain('memory-card--pinned');
    const star = byLabel(container, '取消置顶');
    expect(star).toBeTruthy();
    expect(star?.className).toContain('on');
  });

  it('fires pin/export/copy/delete handlers with the memory', () => {
    const memory = makeMemory();
    const onTogglePin = vi.fn();
    const onExport = vi.fn();
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    const { container } = render(
      <MemoryCard
        memory={memory}
        onEdit={vi.fn()}
        onDelete={onDelete}
        onExport={onExport}
        onCopy={onCopy}
        onTogglePin={onTogglePin}
      />,
    );

    fireClick(byLabel(container, '置顶'));
    expect(onTogglePin).toHaveBeenCalledWith(memory);

    fireClick(byLabel(container, '导出 MD'));
    expect(onExport).toHaveBeenCalledWith(memory);

    fireClick(byLabel(container, '复制 MD'));
    expect(onCopy).toHaveBeenCalledWith(memory);

    fireClick(byLabel(container, '删除'));
    expect(onDelete).toHaveBeenCalledWith(memory);
  });

  it('shows a copied hint for 1.5s after copy', () => {
    vi.useFakeTimers();
    const { container } = render(
      <MemoryCard
        memory={makeMemory()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onCopy={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    fireClick(byLabel(container, '复制 MD'));
    expect(byLabel(container, '复制 MD')?.textContent).toContain('已复制');
    act(() => vi.advanceTimersByTime(1600));
    expect(byLabel(container, '复制 MD')?.textContent).not.toContain('已复制');
  });

  it('shows relative time on the card head', () => {
    const threeDaysAgo = Date.now() - 3 * DAY;
    const { container } = render(
      <MemoryCard memory={makeMemory({ updatedAt: threeDaysAgo })} onEdit={vi.fn()} />,
    );
    expect(container.querySelector('.memory-card__time')?.textContent).toContain('3 天前');
  });
});

describe('MemoryEditDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('prefills stars from importance and maps a star click to importance on save', () => {
    const onSave = vi.fn();
    const memory = makeMemory({ content: '已有的记忆内容', importance: 0.6, tags: ['a', 'b'] });
    const { container } = render(
      <MemoryEditDialog memory={memory} onSave={onSave} onClose={vi.fn()} />,
    );
    const stars = Array.from(container.querySelectorAll('.memory-star'));
    expect(stars.length).toBe(5);
    expect(stars.filter((s) => s.classList.contains('on')).length).toBe(3);

    fireClick(stars[3]);

    const saveBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '保存',
    );
    expect(saveBtn).toBeTruthy();
    fireClick(saveBtn);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ content: '已有的记忆内容', importance: 0.8, kind: 'fact', scope: 'personal', tags: ['a', 'b'] }),
    );
  });

  it('renders create mode with empty form and 创建 button', () => {
    const onSave = vi.fn();
    const { container } = render(
      <MemoryEditDialog onSave={onSave} onClose={vi.fn()} />,
    );
    const textarea = container.querySelector('textarea');
    expect(textarea?.textContent).toBe('');
    const submit = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '创建',
    );
    expect(submit).toBeTruthy();
  });
});

describe('MemoryDeleteDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('confirms deletion with a content preview', () => {
    const longContent = '被删除记忆的内容'.repeat(20);
    const memory = makeMemory({ content: longContent });
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <MemoryDeleteDialog memory={memory} onConfirm={onConfirm} onClose={onClose} />,
    );
    expect(container.textContent).toContain('删除这条记忆？');
    expect(container.textContent).toContain(longContent.slice(0, 80));

    const del = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '删除',
    );
    fireClick(del);
    expect(onConfirm).toHaveBeenCalledOnce();

    const cancel = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '取消',
    );
    fireClick(cancel);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
