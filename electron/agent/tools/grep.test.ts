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
});
