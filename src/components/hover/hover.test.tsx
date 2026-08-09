import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ElectronAPI } from '../../../shared/ipc';
import { filePreviewCache } from '../../lib/file-preview-cache';
import { FileHoverPreview } from './FileHoverPreview';
import { HoverablePath } from './HoverablePath';

function installApi() {
  const mocks = {
    readFile: vi.fn().mockResolvedValue({ content: 'const x = 1;', size: 12, truncated: false }),
    openPath: vi.fn().mockResolvedValue(true),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: { fs: mocks } as unknown as ElectronAPI,
    writable: true,
    configurable: true,
  });
  return mocks;
}

async function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
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

function fireMouseEnter(el: Element) {
  act(() => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
}

function fireMouseLeave(el: Element) {
  act(() => el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
}

function fireClick(el: Element) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  act(() => el.dispatchEvent(event));
  return event;
}

describe('FileHoverPreview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    installApi();
    filePreviewCache.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders file content from fs.readFile', async () => {
    await render(
      <FileHoverPreview anchor={{ x: 10, y: 20 }} path="src/a.ts" workDir="/w" onClose={() => {}} />,
    );
    expect(window.electronAPI.fs.readFile).toHaveBeenCalledWith('/w', 'src/a.ts', 100 * 1024);
    expect(document.body.textContent).toContain('const x = 1;');
    expect(filePreviewCache.get('/w', 'src/a.ts')).toBe('const x = 1;');
  });

  it('serves content from filePreviewCache without re-reading', async () => {
    filePreviewCache.set('/w', 'src/a.ts', 'cached-content');
    await render(
      <FileHoverPreview anchor={{ x: 10, y: 20 }} path="src/a.ts" workDir="/w" onClose={() => {}} />,
    );
    expect(window.electronAPI.fs.readFile).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('cached-content');
  });

  it('shows error state on failure', async () => {
    window.electronAPI.fs.readFile = vi.fn().mockRejectedValue(new Error('不存在'));
    await render(
      <FileHoverPreview anchor={{ x: 10, y: 20 }} path="src/missing.ts" workDir="/w" onClose={() => {}} />,
    );
    expect(document.body.textContent).toContain('无法预览');
  });

  it('marks truncated content', async () => {
    window.electronAPI.fs.readFile = vi.fn().mockResolvedValue({ content: 'x'.repeat(100), size: 100, truncated: true });
    await render(
      <FileHoverPreview anchor={{ x: 10, y: 20 }} path="src/big.ts" workDir="/w" onClose={() => {}} />,
    );
    expect(document.body.textContent).toContain('已截断');
  });

  it('flips position near the bottom-right edge', async () => {
    await render(
      <FileHoverPreview anchor={{ x: 1000, y: 700 }} path="src/a.ts" workDir="/w" onClose={() => {}} />,
    );
    const el = document.body.querySelector('.file-hover-preview') as HTMLElement;
    expect(el.style.left).toBe('520px');
    expect(el.style.top).toBe('372px');
  });

  it('calls fs.openPath on the open button', async () => {
    await render(
      <FileHoverPreview anchor={{ x: 10, y: 20 }} path="src/a.ts" workDir="/w" onClose={() => {}} />,
    );
    document.body.querySelector('.file-hover-preview__open')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(window.electronAPI.fs.openPath).toHaveBeenCalledWith('/w', 'src/a.ts');
  });
});

describe('HoverablePath', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    installApi();
    filePreviewCache.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens preview on hover after delay and closes on leave', async () => {
    const { container } = await render(
      <HoverablePath path="src/a.ts" workDir="/w">src/a.ts</HoverablePath>,
    );
    const el = container.querySelector('.hoverable-path')!;
    fireMouseEnter(el);
    expect(document.body.querySelector('.file-hover-preview')).toBeNull();
    await act(() => vi.advanceTimersByTime(300));
    expect(document.body.querySelector('.file-hover-preview')).toBeTruthy();
    fireMouseLeave(el);
    await act(() => vi.advanceTimersByTime(200));
    expect(document.body.querySelector('.file-hover-preview')).toBeNull();
  });

  it('keeps the preview open while hovering the popover', async () => {
    const { container } = await render(
      <HoverablePath path="src/a.ts" workDir="/w">src/a.ts</HoverablePath>,
    );
    const el = container.querySelector('.hoverable-path')!;
    fireMouseEnter(el);
    await act(() => vi.advanceTimersByTime(300));
    const preview = document.body.querySelector('.file-hover-preview')!;
    fireMouseEnter(preview);
    fireMouseLeave(el);
    await act(() => vi.advanceTimersByTime(400));
    expect(document.body.querySelector('.file-hover-preview')).toBeTruthy();
    fireMouseLeave(preview);
    await act(() => vi.advanceTimersByTime(200));
    expect(document.body.querySelector('.file-hover-preview')).toBeNull();
  });

  it('opens the file on click', async () => {
    const { container } = await render(
      <HoverablePath path="src/a.ts" workDir="/w">src/a.ts</HoverablePath>,
    );
    const el = container.querySelector('.hoverable-path')!;
    const event = fireClick(el);
    expect(event.defaultPrevented).toBe(true);
    expect(window.electronAPI.fs.openPath).toHaveBeenCalledWith('/w', 'src/a.ts');
  });

  it('cancels the pending open timer when leaving before the delay', async () => {
    const { container } = await render(
      <HoverablePath path="src/a.ts" workDir="/w">src/a.ts</HoverablePath>,
    );
    const el = container.querySelector('.hoverable-path')!;
    fireMouseEnter(el);
    fireMouseLeave(el);
    await act(() => vi.advanceTimersByTime(300));
    expect(document.body.querySelector('.file-hover-preview')).toBeNull();
  });
});
