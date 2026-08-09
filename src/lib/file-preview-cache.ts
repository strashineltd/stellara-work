export interface PreviewCacheValue {
  content: string;
  truncated: boolean;
}

const cache = new Map<string, PreviewCacheValue>();

function key(workDir: string, path: string): string {
  return `${workDir}\u0000${path}`;
}

export const filePreviewCache = {
  get(workDir: string, path: string): PreviewCacheValue | null {
    return cache.get(key(workDir, path)) ?? null;
  },
  set(workDir: string, path: string, value: PreviewCacheValue): void {
    cache.set(key(workDir, path), value);
  },
  clearForWorkDir(workDir: string): void {
    const prefix = `${workDir}\u0000`;
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) cache.delete(k);
    }
  },
  clear(): void {
    cache.clear();
  },
};
