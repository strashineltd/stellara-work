import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { searchFiles } from './search';

let tmpDir: string;
beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-')); });
afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });
async function write(rel: string, content: string) {
  const p = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf-8');
}

describe('searchFiles', () => {
  it('finds files by pattern within workdir', async () => {
    await write('src/a.js', '');
    const r = await searchFiles({ pattern: '**/*.js' }, tmpDir);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('src/a.js');
  });

  it('returns no-match message when nothing matches', async () => {
    await write('notes.txt', '');
    const r = await searchFiles({ pattern: '**/*.js' }, tmpDir);
    expect(r.ok).toBe(true);
    expect(r.output).toBe('(无匹配)');
  });

  it('rejects pattern escaping the workdir', async () => {
    await write('inner/.keep', '');
    await write('outside/secret.js', '');
    const r = await searchFiles({ pattern: '../**/*.js' }, path.join(tmpDir, 'inner'));
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain('secret.js');
  });

  it('rejects cwd escaping the workdir', async () => {
    await write('outside/secret.js', '');
    const r = await searchFiles({ pattern: '**/*.js', cwd: '../' }, tmpDir);
    expect(r.ok).toBe(false);
    expect(r.output).not.toContain('secret.js');
  });

  it('allows cwd within the workdir', async () => {
    await write('sub/inner.js', '');
    const r = await searchFiles({ pattern: '**/*.js', cwd: 'sub' }, tmpDir);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('inner.js');
  });
});
