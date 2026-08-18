import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addAttachments, readAttachmentImage, openAttachment, sanitizeFileName } from './attachments';

let workDir: string;
let sourceDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-att-'));
  sourceDir = path.join(workDir, 'src-files');
  await fs.mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

async function makeFile(dir: string, name: string, content: string | Buffer): Promise<string> {
  const p = path.join(dir, name);
  await fs.writeFile(p, content);
  return p;
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function attachmentDir(): string {
  return path.join(workDir, '.stellara-attachments', 'sess-1');
}

describe('addAttachments', () => {
  it('copies file into attachment dir and returns metadata', async () => {
    const src = await makeFile(sourceDir, 'notes.txt', 'hello');
    const metas = await addAttachments('sess-1', workDir, [src]);

    expect(metas).toHaveLength(1);
    const meta = metas[0]!;
    expect(meta.id).toBe('notes.txt');
    expect(meta.name).toBe('notes.txt');
    expect(meta.size).toBe(5);
    expect(meta.mimeType).toBe('text/plain');
    expect(meta.kind).toBe('file');
    expect(meta.relPath).toBe('sess-1/notes.txt');

    const stored = await fs.readFile(path.join(attachmentDir(), 'notes.txt'), 'utf8');
    expect(stored).toBe('hello');
  });

  it('classifies png as image', async () => {
    const src = await makeFile(sourceDir, 'pic.png', PNG_BYTES);
    const [meta] = await addAttachments('sess-1', workDir, [src]);
    expect(meta!.kind).toBe('image');
    expect(meta!.mimeType).toBe('image/png');
  });

  it('classifies jpeg/gif/webp/svg/bmp as image', async () => {
    const cases: Array<[string, string]> = [
      ['a.jpg', 'image/jpeg'],
      ['a.jpeg', 'image/jpeg'],
      ['a.gif', 'image/gif'],
      ['a.webp', 'image/webp'],
      ['a.svg', 'image/svg+xml'],
      ['a.bmp', 'image/bmp'],
    ];
    for (const [name, mime] of cases) {
      const src = await makeFile(sourceDir, name, PNG_BYTES);
      const [meta] = await addAttachments('sess-1', workDir, [src]);
      expect(meta!.kind).toBe('image');
      expect(meta!.mimeType).toBe(mime);
    }
  });

  it('rejects executable/script extensions from blacklist', async () => {
    for (const ext of ['.exe', '.dmg', '.msi', '.pkg', '.app', '.sh', '.bat', '.cmd', '.ps1', '.jar']) {
      const src = await makeFile(sourceDir, `evil${ext}`, 'x');
      await expect(addAttachments('sess-1', workDir, [src])).rejects.toThrow(/不允许上传/);
    }
  });

  it('rejects files larger than 50MB', async () => {
    const big = path.join(sourceDir, 'big.bin');
    const handle = await fs.open(big, 'w');
    await handle.truncate(51 * 1024 * 1024);
    await handle.close();
    await expect(addAttachments('sess-1', workDir, [big])).rejects.toThrow(/50MB/);
  });

  it('renames conflicting names with timestamp suffix', async () => {
    const a = await makeFile(sourceDir, 'same.txt', 'aaa');
    const b = await makeFile(sourceDir, 'same.txt', 'bbb');
    const metas = await addAttachments('sess-1', workDir, [a, b]);

    expect(metas).toHaveLength(2);
    expect(metas[0]!.name).toBe('same.txt');
    expect(metas[1]!.name).toMatch(/^same-\d+\.txt$/);
    expect(metas[1]!.id).toBe(metas[1]!.name);
    expect(metas[1]!.relPath).toBe(`sess-1/${metas[1]!.name}`);

    const files = await fs.readdir(attachmentDir());
    expect(files.sort()).toEqual([`${metas[1]!.name}`, 'same.txt'].sort());
    await expect(fs.readFile(path.join(attachmentDir(), metas[1]!.name), 'utf8')).resolves.toBe('bbb');
  });

  it('sanitizes sessionId illegal characters to dash', async () => {
    const src = await makeFile(sourceDir, 'notes.txt', 'hi');
    const [meta] = await addAttachments('a/b c', workDir, [src]);
    expect(meta!.relPath).toBe('a-b-c/notes.txt');
    await expect(fs.access(path.join(workDir, '.stellara-attachments', 'a-b-c', 'notes.txt'))).resolves.toBeUndefined();
  });

  it('stores source file basename only', async () => {
    const sub = path.join(sourceDir, 'sub');
    await fs.mkdir(sub, { recursive: true });
    const src = await makeFile(sub, 'notes.txt', 'hi');
    const [meta] = await addAttachments('sess-1', workDir, [src]);
    expect(meta!.name).toBe('notes.txt');
    expect(meta!.relPath).toBe('sess-1/notes.txt');
  });

  it('rejects non-existent source paths', async () => {
    await expect(addAttachments('sess-1', workDir, [path.join(sourceDir, 'missing.txt')])).rejects.toThrow(/不存在/);
    await expect(addAttachments('sess-1', workDir, ['../relative-nope.txt'])).rejects.toThrow(/不存在/);
  });

  it('rejects directory paths', async () => {
    await expect(addAttachments('sess-1', workDir, [sourceDir])).rejects.toThrow(/文件/);
  });

  it('fails atomically when a later file is invalid', async () => {
    const ok = await makeFile(sourceDir, 'ok.txt', 'fine');
    const bad = await makeFile(sourceDir, 'evil.exe', 'x');
    await expect(addAttachments('sess-1', workDir, [ok, bad])).rejects.toThrow(/不允许上传/);
    await expect(fs.readdir(attachmentDir())).rejects.toThrow();
  });
});

describe('sanitizeFileName', () => {
  it('replaces path separators with dash', () => {
    expect(sanitizeFileName('a/b.txt')).toBe('a-b.txt');
    expect(sanitizeFileName('a\\b.txt')).toBe('a-b.txt');
  });

  it('rejects empty or dot-only names', () => {
    expect(() => sanitizeFileName('')).toThrow(/文件名/);
    expect(() => sanitizeFileName('.')).toThrow(/文件名/);
    expect(() => sanitizeFileName('..')).toThrow(/文件名/);
  });
});

describe('readAttachmentImage', () => {
  it('reads stored image as data url', async () => {
    const src = await makeFile(sourceDir, 'pic.png', PNG_BYTES);
    const [meta] = await addAttachments('sess-1', workDir, [src]);
    const { dataUrl } = await readAttachmentImage('sess-1', workDir, meta!.id);
    expect(dataUrl).toContain('data:image/png;base64,');
  });

  it('rejects symlink pointing outside workDir', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-outside-'));
    try {
      const secret = await makeFile(outside, 'secret.txt', 'top secret');
      await fs.mkdir(attachmentDir(), { recursive: true });
      await fs.symlink(secret, path.join(attachmentDir(), 'leak.txt'));
      await expect(readAttachmentImage('sess-1', workDir, 'leak.txt')).rejects.toThrow(/工作目录|越界/);
      await expect(openAttachment('sess-1', workDir, 'leak.txt')).rejects.toThrow(/工作目录|越界/);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects non-image attachment', async () => {
    const src = await makeFile(sourceDir, 'doc.txt', 'hello');
    const [meta] = await addAttachments('sess-1', workDir, [src]);
    await expect(readAttachmentImage('sess-1', workDir, meta!.id)).rejects.toThrow(/仅支持.*图片|图片/);
  });

  it('rejects image larger than 5MB', async () => {
    const big = path.join(sourceDir, 'big.png');
    const handle = await fs.open(big, 'w');
    await handle.truncate(6 * 1024 * 1024);
    await handle.close();
    const [meta] = await addAttachments('sess-1', workDir, [big]);
    await expect(readAttachmentImage('sess-1', workDir, meta!.id)).rejects.toThrow(/5MB/);
  });

  it('rejects traversal id', async () => {
    await expect(readAttachmentImage('sess-1', workDir, '../notes.txt')).rejects.toThrow(/不存在|越界/);
  });
});

describe('openAttachment', () => {
  it('returns absolute path within attachment dir', async () => {
    const src = await makeFile(sourceDir, 'notes.txt', 'hi');
    const [meta] = await addAttachments('sess-1', workDir, [src]);
    const abs = await openAttachment('sess-1', workDir, meta!.id);
    const expected = await fs.realpath(path.join(attachmentDir(), 'notes.txt'));
    expect(abs).toBe(expected);
  });

  it('rejects traversal id', async () => {
    await expect(openAttachment('sess-1', workDir, '../../outside.txt')).rejects.toThrow(/不存在|越界/);
  });

  it('rejects non-existent id', async () => {
    await expect(openAttachment('sess-1', workDir, 'nope.txt')).rejects.toThrow(/不存在/);
  });
});
