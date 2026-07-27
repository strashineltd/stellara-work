import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { InputArea } from './InputArea';
import type { SlashState } from './InputArea';

const EMPTY_SLASH: SlashState = {
  slashOpen: false,
  slashItems: [],
  slashIdx: 0,
  skillsLoaded: false,
};

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

describe('InputArea', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders without throwing', () => {
    expect(() =>
      render(
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
          onSlashClose={vi.fn()}
          onSlashIdxChange={vi.fn()}
          onLazyLoadSkills={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });

  it('uses token-driven class name main-input', () => {
    const { querySelector } = render(
      <InputArea
        input="test"
        busy={false}
        planMode={false}
        slash={EMPTY_SLASH}
        hasWorkDir={true}
        onInputChange={vi.fn()}
        onPlanToggle={vi.fn()}
        onSend={vi.fn()}
        onSlashApply={vi.fn()}
        onSlashClose={vi.fn()}
        onSlashIdxChange={vi.fn()}
        onLazyLoadSkills={vi.fn()}
      />,
    );
    const footer = querySelector('.main-input');
    expect(footer).toBeTruthy();
  });

  it('does not use emoji glyphs in rendered HTML', () => {
    const { container } = render(
      <InputArea
        input="hello"
        busy={false}
        planMode={true}
        slash={EMPTY_SLASH}
        hasWorkDir={true}
        onInputChange={vi.fn()}
        onPlanToggle={vi.fn()}
        onSend={vi.fn()}
        onSlashApply={vi.fn()}
        onSlashClose={vi.fn()}
        onSlashIdxChange={vi.fn()}
        onLazyLoadSkills={vi.fn()}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
