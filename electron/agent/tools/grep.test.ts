import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { searchContent } from './grep';

let tmpDir: string;
beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grep-')); });
afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });
async function write(rel: string, content: string) {
  const p = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf-8');
}
async function trySymlink(target: string, linkPath: string, type?: 'file' | 'dir'): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, type);
    return true;
  } catch {
    return false; // 平台不允许创建 symlink 时跳过
  }
}

describe('searchContent', () => {
  it('finds matching lines in files within workdir', async () => {
    await write('src/a.js', 'const x = 1;\nconst secretFlag = true;\n');
    const r = await searchContent({ pattern: '**/*.js', query: 'secretFlag' }, tmpDir);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('src/a.js:2');
  });

  it('rejects pattern escaping the workdir', async () => {
    await write('inner/.keep', '');
    await write('outside/secret.js', 'const secretValue = 42;\n');
    const r = await searchContent(
      { pattern: '../**/*.js', query: 'secret' },
      path.join(tmpDir, 'inner'),
    );
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain('secretValue');
  });

  it('rejects cwd escaping the workdir', async () => {
    await write('outside/secret.js', 'const secretValue = 42;\n');
    const r = await searchContent({ pattern: '**/*.js', query: 'secretValue', cwd: '../' }, tmpDir);
    expect(r.ok).toBe(false);
    expect(r.output).not.toContain('secretValue');
  });

  it('allows cwd within the workdir', async () => {
    await write('sub/inner.js', 'const secretFlag = true;\n');
    const r = await searchContent({ pattern: '**/*.js', query: 'secretFlag', cwd: 'sub' }, tmpDir);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('inner.js:1');
  });

  it('does not read files outside the workdir through a symlinked file (H6)', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grep-outside-'));
    try {
      await fs.writeFile(path.join(outsideDir, 'secret.js'), 'const secretFlag = true;\n');
      await write('src/ok.js', 'const secretFlag = true;\n');
      if (!(await trySymlink(path.join(outsideDir, 'secret.js'), path.join(tmpDir, 'evil.js')))) return;
      const r = await searchContent({ pattern: '**/*.js', query: 'secretFlag' }, tmpDir);
      expect(r.ok).toBe(true);
      expect(r.output).toContain('src/ok.js');
      expect(r.output).not.toContain('evil.js');
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('skips symlinked directories escaping the workdir (H6)', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grep-outside-'));
    try {
      await fs.writeFile(path.join(outsideDir, 'secret.js'), 'const secretFlag = true;\n');
      if (!(await trySymlink(outsideDir, path.join(tmpDir, 'evil-dir'), 'dir'))) return;
      const r = await searchContent({ pattern: '**/*.js', query: 'secretFlag' }, tmpDir);
      expect(r.ok).toBe(true);
      expect(r.output).not.toContain('secretFlag');
      expect(r.output).toContain('(无匹配)');
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
