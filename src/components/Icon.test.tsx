import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';

function renderIcon(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    svg: container.querySelector('svg')!,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('Icon', () => {
  it('applies the stable shared icon class and requested dimensions', () => {
    const { svg, unmount } = renderIcon(<Icon name="settings" size={18} />);
    expect(svg.classList.contains('app-icon')).toBe(true);
    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.getAttribute('height')).toBe('18');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    unmount();
  });

  it('preserves component-specific classes without losing the shared class', () => {
    const { svg, unmount } = renderIcon(<Icon name="chevron-down" className="custom-icon" />);
    expect(svg.classList.contains('app-icon')).toBe(true);
    expect(svg.classList.contains('custom-icon')).toBe(true);
    unmount();
  });

  it('supports the paperclip icon used by the attachment picker', () => {
    const { svg, unmount } = renderIcon(<Icon name="paperclip" />);
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
    unmount();
  });
});
