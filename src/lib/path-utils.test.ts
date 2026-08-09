import { describe, it, expect } from 'vitest';
import { extractRelativePaths, isRelativePathLike } from './path-utils';

describe('isRelativePathLike', () => {
  it('accepts nested relative paths', () => {
    expect(isRelativePathLike('src/foo.ts')).toBe(true);
    expect(isRelativePathLike('./electron/main.ts')).toBe(true);
    expect(isRelativePathLike('src/components/a-b/c.tsx')).toBe(true);
  });

  it('rejects urls, bare names, absolute paths, dirs', () => {
    expect(isRelativePathLike('https://example.com/a.ts')).toBe(false);
    expect(isRelativePathLike('http://x.dev/main.js')).toBe(false);
    expect(isRelativePathLike('foo.ts')).toBe(false);
    expect(isRelativePathLike('/usr/local/a.ts')).toBe(false);
    expect(isRelativePathLike('src/foo/')).toBe(false);
    expect(isRelativePathLike('C:\\Users\\a\\b.ts')).toBe(false);
  });

  it('rejects unknown extensions', () => {
    expect(isRelativePathLike('src/a.xyz')).toBe(false);
    expect(isRelativePathLike('src/a.exe')).toBe(false);
  });
});

describe('extractRelativePaths', () => {
  it('finds paths in text and dedupes', () => {
    const text = '修改了 src/main.ts 和 electron/main.ts，还有 src/main.ts';
    expect(extractRelativePaths(text)).toEqual(['src/main.ts', 'electron/main.ts']);
  });

  it('returns empty array when none', () => {
    expect(extractRelativePaths('没有任何路径')).toEqual([]);
  });
});
