import { describe, it, expect, beforeEach } from 'vitest';
import { filePreviewCache } from './file-preview-cache';

describe('filePreviewCache', () => {
  beforeEach(() => filePreviewCache.clear());

  it('stores and retrieves by workDir:path', () => {
    expect(filePreviewCache.get('/w', 'src/a.ts')).toBeNull();
    filePreviewCache.set('/w', 'src/a.ts', { content: 'content', truncated: true });
    expect(filePreviewCache.get('/w', 'src/a.ts')).toEqual({ content: 'content', truncated: true });
  });

  it('isolates by workDir', () => {
    filePreviewCache.set('/w1', 'a.ts', { content: 'one', truncated: false });
    expect(filePreviewCache.get('/w2', 'a.ts')).toBeNull();
  });

  it('clears per workDir', () => {
    filePreviewCache.set('/w1', 'a.ts', { content: 'one', truncated: false });
    filePreviewCache.set('/w2', 'b.ts', { content: 'two', truncated: true });
    filePreviewCache.clearForWorkDir('/w1');
    expect(filePreviewCache.get('/w1', 'a.ts')).toBeNull();
    expect(filePreviewCache.get('/w2', 'b.ts')).toEqual({ content: 'two', truncated: true });
  });
});
