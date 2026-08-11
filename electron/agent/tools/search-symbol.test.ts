import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { searchSymbol } from './search-symbol';

let tmpDir: string;
beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symbol-')); });
afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });
async function write(rel: string, content: string) {
  const p = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf-8');
}

describe('searchSymbol', () => {
  it('finds function definition with context lines', async () => {
    await write('src/a.ts', 'const x = 1;\nfunction handleSend() {\n  return 1;\n}\n');
    const r = await searchSymbol({ symbol: 'handleSend' }, tmpDir);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('src/a.ts:2');
    expect(r.output).toContain('const x = 1;'); // 上下文前一行
    expect(r.output).toContain('return 1;');    // 上下文后一行
  });

  it('matches class/interface/import definitions', async () => {
    await write('src/b.ts', 'import { helper } from "./h";\nexport class Worker {}\ninterface Spec {}\n');
    const r = await searchSymbol({ symbol: 'Worker' }, tmpDir);
    expect(r.output).toContain('src/b.ts:2');
    const r2 = await searchSymbol({ symbol: 'helper' }, tmpDir);
    expect(r2.output).toContain('src/b.ts:1');
  });

  it('ignores non-definition occurrences and non-code files', async () => {
    await write('src/c.ts', 'const msg = "handleSend 是函数";\n');
    await write('notes.txt', 'function handleSend() {}\n');
    const r = await searchSymbol({ symbol: 'handleSend' }, tmpDir);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('未找到');
  });

  it('limits results and validates args', async () => {
    await write('src/d.ts', 'function f1() {}\nfunction f2() {}\n');
    const r = await searchSymbol({ symbol: 'f', limit: 1 }, tmpDir);
    expect(r.output.split('src/d.ts:').length).toBeLessThanOrEqual(2);
    const bad = await searchSymbol({ symbol: 'f', limit: 500 }, tmpDir);
    expect(bad.ok).toBe(false);
  });
});
