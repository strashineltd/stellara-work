import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act, useState } from 'react';
import { InputArea } from './InputArea';
import type { SlashState } from './InputArea';
import type { AttachmentMeta, SkillDef } from '../../../shared/ipc';

const EMPTY_SLASH: SlashState = {
  slashOpen: false,
  slashItems: [],
  slashIdx: 0,
  skillsLoaded: false,
};

const IMG_ATT: AttachmentMeta = {
  id: 'shot-1.png', name: 'shot-1.png', size: 2048,
  mimeType: 'image/png', kind: 'image', relPath: 'sess-1/shot-1.png',
};

const FILE_ATT: AttachmentMeta = {
  id: 'notes.txt', name: 'notes.txt', size: 1024,
  mimeType: 'text/plain', kind: 'file', relPath: 'sess-1/notes.txt',
};

interface RenderProps {
  attachments?: AttachmentMeta[];
  onAttachmentsChange?: (next: AttachmentMeta[]) => void;
  onPickAttachments?: () => void;
  onAddAttachmentPaths?: (paths: string[]) => void;
  onSlashOpen?: () => void;
  onLazyLoadSkills?: () => void;
}

function render(overrides: RenderProps = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <InputArea
        input=""
        busy={false}
        planMode={false}
        slash={EMPTY_SLASH}
        hasWorkDir={true}
        onInputChange={vi.fn()}
        onPlanToggle={vi.fn()}
        onSend={vi.fn()}
        onSlashApply={vi.fn()}
        onSlashOpen={overrides.onSlashOpen ?? vi.fn()}
        onSlashClose={vi.fn()}
        onSlashIdxChange={vi.fn()}
        onLazyLoadSkills={overrides.onLazyLoadSkills ?? vi.fn()}
        attachments={overrides.attachments ?? []}
        onAttachmentsChange={overrides.onAttachmentsChange ?? vi.fn()}
        onPickAttachments={overrides.onPickAttachments ?? vi.fn()}
        onAddAttachmentPaths={overrides.onAddAttachmentPaths ?? vi.fn()}
      />,
    );
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root!.unmount();
      });
      document.body.removeChild(container);
    },
    getByText: (text: string | RegExp) => {
      const pattern = typeof text === 'string' ? text : text;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.textContent && (typeof pattern === 'string' ? node.textContent.includes(pattern) : pattern.test(node.textContent))) {
          return node.parentElement!;
        }
      }
      return null;
    },
    querySelector: (sel: string) => container.querySelector(sel),
    querySelectorAll: (sel: string) => container.querySelectorAll(sel),
  };
}

const SLASH_ITEMS: SkillDef[] = [
  { name: 'plan', description: '制定计划', prompt: '请先制定计划' },
  { name: 'review', description: '审查代码', prompt: '请审查代码' },
];

function SlashHarness({ initialOpen, onSlashApply }: {
  initialOpen?: boolean;
  onSlashApply?: (skill: SkillDef) => void;
}) {
  const [slash, setSlash] = useState<SlashState>({
    slashOpen: initialOpen ?? false,
    slashItems: SLASH_ITEMS,
    slashIdx: 0,
    skillsLoaded: true,
  });
  return (
    <InputArea
      input=""
      busy={false}
      planMode={false}
      slash={slash}
      hasWorkDir={true}
      onInputChange={vi.fn()}
      onPlanToggle={vi.fn()}
      onSend={vi.fn()}
      onSlashApply={(skill) => {
        onSlashApply?.(skill);
        setSlash((prev) => ({ ...prev, slashOpen: false }));
      }}
      onSlashOpen={() => setSlash((prev) => ({ ...prev, slashOpen: true, slashIdx: 0 }))}
      onSlashClose={() => setSlash((prev) => ({ ...prev, slashOpen: false }))}
      onSlashIdxChange={(idx) => setSlash((prev) => ({ ...prev, slashIdx: idx }))}
      onLazyLoadSkills={vi.fn()}
      attachments={[]}
      onAttachmentsChange={vi.fn()}
      onPickAttachments={vi.fn()}
      onAddAttachmentPaths={vi.fn()}
    />
  );
}

interface SlashView {
  container: HTMLDivElement;
  root: Root;
}

const slashViews = new Set<SlashView>();

function renderSlash(options: { initialOpen?: boolean; onSlashApply?: (skill: SkillDef) => void } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const view = { container, root };
  slashViews.add(view);
  act(() => {
    root.render(<SlashHarness {...options} />);
  });
  return {
    container,
    unmount: () => {
      if (!slashViews.delete(view)) return;
      act(() => {
        root.unmount();
      });
      container.remove();
    },
    querySelector: (sel: string) => container.querySelector(sel),
    querySelectorAll: (sel: string) => container.querySelectorAll(sel),
  };
}

function fireClick(el: Element | null) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function fireEscapeOnTextarea(el: Element | null) {
  if (!el) throw new Error('Textarea not found');
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

function fireTransitionEnd(el: Element | null) {
  if (!el) throw new Error('Element not found for transitionend');
  act(() => {
    el.dispatchEvent(new Event('transitionend', { bubbles: true }));
  });
}

describe('InputArea', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    slashViews.forEach(({ container, root }) => {
      act(() => root.unmount());
      container.remove();
    });
    slashViews.clear();
    if (vi.isFakeTimers()) {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('renders without throwing', () => {
    expect(() => render()).not.toThrow();
  });

  it('uses token-driven class name main-input', () => {
    const { querySelector } = render();
    const footer = querySelector('.main-input');
    expect(footer).toBeTruthy();
  });

  it('does not use emoji glyphs in rendered HTML', () => {
    const { container } = render();
    const html = container.innerHTML;
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('opens skill suggestions when the user types a slash command', () => {
    const onSlashOpen = vi.fn();
    const onLazyLoadSkills = vi.fn();
    const { querySelector } = render({ onSlashOpen, onLazyLoadSkills });
    const textarea = querySelector('.input-chat') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '/');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onSlashOpen).toHaveBeenCalledOnce();
    expect(onLazyLoadSkills).toHaveBeenCalledOnce();
  });

  it('renders attachment chips through AttachmentPicker and removes on x', () => {
    const onAttachmentsChange = vi.fn();
    const { querySelector, querySelectorAll, getByText } = render({
      attachments: [IMG_ATT, FILE_ATT],
      onAttachmentsChange,
    });
    expect(querySelectorAll('.attach-chip').length).toBe(2);
    expect(getByText('shot-1.png')).not.toBeNull();
    expect(getByText('2.0 KB')).not.toBeNull();
    const remove = querySelector('.attach-chip-remove') as HTMLButtonElement;
    act(() => {
      remove.click();
    });
    expect(onAttachmentsChange).toHaveBeenCalledWith([FILE_ATT]);
  });

  it('renders the slash list with a top placement contract', () => {
    const { container } = renderSlash({ initialOpen: true });
    const list = container.querySelector('.slash-menu') as HTMLElement;
    expect(list).toBeTruthy();
    expect(list.getAttribute('data-motion')).toBe('menu');
    expect(list.getAttribute('data-side')).toBe('top');
    expect(list.getAttribute('data-motion-state')).toBe('entering');
  });

  it('keeps textarea ARIA logical while the retained slash list exits', () => {
    const { container } = renderSlash({ initialOpen: true });
    const textarea = container.querySelector('.input-chat') as HTMLTextAreaElement;
    const list = container.querySelector('.slash-menu') as HTMLElement;
    expect(textarea.getAttribute('aria-expanded')).toBe('true');
    expect(textarea.getAttribute('aria-controls')).toBe('slash-suggestions');

    fireEscapeOnTextarea(textarea);

    expect(list.getAttribute('data-motion-state')).toBe('closing');
    expect(list.hasAttribute('inert')).toBe(true);
    expect(list.getAttribute('aria-hidden')).toBe('true');
    expect(textarea.getAttribute('aria-expanded')).toBe('false');
    expect(textarea.getAttribute('aria-controls')).toBeNull();
    fireTransitionEnd(list);
    expect(container.querySelector('.slash-menu')).toBeNull();
  });

  it('applies a slash skill on mouse selection and refocuses the textarea', () => {
    const onSlashApply = vi.fn();
    const { container } = renderSlash({ initialOpen: true, onSlashApply });
    const textarea = container.querySelector('.input-chat') as HTMLTextAreaElement;
    const list = container.querySelector('.slash-menu') as HTMLElement;
    textarea.blur();
    const item = Array.from(container.querySelectorAll('.slash-item'))
      .find((el) => el.textContent?.includes('review'))!;

    fireClick(item);

    expect(onSlashApply).toHaveBeenCalledWith(SLASH_ITEMS[1]);
    expect(document.activeElement).toBe(textarea);
    expect(list.getAttribute('data-motion-state')).toBe('closing');
    expect(list.hasAttribute('inert')).toBe(true);
    fireTransitionEnd(list);
    expect(container.querySelector('.slash-menu')).toBeNull();
  });

  it('does not replay a slash apply on a retained-closing root', () => {
    const onSlashApply = vi.fn();
    const { container } = renderSlash({ initialOpen: true, onSlashApply });
    const list = container.querySelector('.slash-menu') as HTMLElement;
    const item = Array.from(container.querySelectorAll('.slash-item'))
      .find((el) => el.textContent?.includes('plan'))!;

    fireClick(item);
    expect(onSlashApply).toHaveBeenCalledTimes(1);
    expect(list.getAttribute('data-motion-state')).toBe('closing');

    fireClick(item);
    expect(onSlashApply).toHaveBeenCalledTimes(1);
    expect(list.getAttribute('data-motion-state')).toBe('closing');
    fireTransitionEnd(list);
    expect(container.querySelector('.slash-menu')).toBeNull();
  });

  it('completes the slash exit only from the list root, not a child', () => {
    const { container } = renderSlash({ initialOpen: true });
    const textarea = container.querySelector('.input-chat') as HTMLTextAreaElement;
    const list = container.querySelector('.slash-menu') as HTMLElement;
    const item = list.querySelector('.slash-item')!;

    fireEscapeOnTextarea(textarea);
    expect(list.getAttribute('data-motion-state')).toBe('closing');

    fireTransitionEnd(item);
    expect(container.querySelector('.slash-menu')).toBe(list);

    fireTransitionEnd(list);
    expect(container.querySelector('.slash-menu')).toBeNull();
  });

  it('removes the slash list via the 170ms Presence fallback without a transitionend', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container } = renderSlash({ initialOpen: true });
    const textarea = container.querySelector('.input-chat') as HTMLTextAreaElement;
    const list = container.querySelector('.slash-menu') as HTMLElement;

    fireEscapeOnTextarea(textarea);
    expect(list.getAttribute('data-motion-state')).toBe('closing');

    act(() => vi.advanceTimersByTime(169));
    expect(container.querySelector('.slash-menu')).toBe(list);
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.slash-menu')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders the active skill chip and clears it on click', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root;
    const onClear = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(
        <InputArea
          input=""
          busy={false}
          planMode={false}
          slash={EMPTY_SLASH}
          hasWorkDir={true}
          onInputChange={vi.fn()}
          onPlanToggle={vi.fn()}
          onSend={vi.fn()}
          onSlashApply={vi.fn()}
          onSlashOpen={vi.fn()}
          onSlashClose={vi.fn()}
          onSlashIdxChange={vi.fn()}
          onLazyLoadSkills={vi.fn()}
          attachments={[]}
          onAttachmentsChange={vi.fn()}
          onPickAttachments={vi.fn()}
          onAddAttachmentPaths={vi.fn()}
          activeSkill={{ name: 'code-review', description: '审查代码', prompt: '请审查' }}
          onActiveSkillClear={onClear}
        />,
      );
    });

    const chip = container.querySelector('.active-skill-chip');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('/code-review');

    const clearBtn = container.querySelector('.active-skill-chip__clear') as HTMLButtonElement;
    fireClick(clearBtn);
    expect(onClear).toHaveBeenCalledTimes(1);

    act(() => root!.unmount());
    document.body.removeChild(container);
  });
});
