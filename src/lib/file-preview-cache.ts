const cache = new Map<string, string>();

function key(workDir: string, path: string): string {
  return `${workDir}\u0000${path}`;
}

export const filePreviewCache = {
  get(workDir: string, path: string): string | null {
    return cache.get(key(workDir, path)) ?? null;
  },
  set(workDir: string, path: string, content: string): void {
    cache.set(key(workDir, path), content);
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
