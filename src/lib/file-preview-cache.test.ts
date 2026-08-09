import { describe, it, expect, beforeEach } from 'vitest';
import { filePreviewCache } from './file-preview-cache';

describe('filePreviewCache', () => {
  beforeEach(() => filePreviewCache.clear());

  it('stores and retrieves by workDir:path', () => {
    expect(filePreviewCache.get('/w', 'src/a.ts')).toBeNull();
    filePreviewCache.set('/w', 'src/a.ts', 'content');
    expect(filePreviewCache.get('/w', 'src/a.ts')).toBe('content');
  });

  it('isolates by workDir', () => {
    filePreviewCache.set('/w1', 'a.ts', 'one');
    expect(filePreviewCache.get('/w2', 'a.ts')).toBeNull();
  });

  it('clears per workDir', () => {
    filePreviewCache.set('/w1', 'a.ts', 'one');
    filePreviewCache.set('/w2', 'b.ts', 'two');
    filePreviewCache.clearForWorkDir('/w1');
    expect(filePreviewCache.get('/w1', 'a.ts')).toBeNull();
    expect(filePreviewCache.get('/w2', 'b.ts')).toBe('two');
  });
});
