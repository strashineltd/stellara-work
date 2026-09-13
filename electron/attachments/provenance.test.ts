import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addAttachments } from './attachments';
import { addAttachmentsWithProvenance, type AttachmentProvenanceDeps } from './provenance';
import {
  findUngrantedAttachmentSources,
  grantAttachmentSources,
  _resetGrantedForTests,
} from '../security/workdir-grants';

let tmpRoot: string;
let workDir: string;
let outsideDir: string;

beforeEach(async () => {
  _resetGrantedForTests();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-prov-'));
  workDir = path.join(tmpRoot, 'work');
  outsideDir = path.join(tmpRoot, 'outside');
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });
});

afterEach(async () => {
  _resetGrantedForTests();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function deps(confirmOutside: (paths: string[]) => Promise<boolean>): AttachmentProvenanceDeps {
  return { findUngranted: findUngrantedAttachmentSources, confirmOutside, add: addAttachments };
}

function storedPath(name: string): string {
  return path.join(workDir, '.stellara-attachments', 'sess-1', name);
}

describe('addAttachmentsWithProvenance', () => {
  it('copies a same-workspace file without asking', async () => {
    const src = path.join(workDir, 'notes.txt');
    await fs.writeFile(src, 'hi');
    const confirmOutside = vi.fn();
    const metas = await addAttachmentsWithProvenance('sess-1', workDir, [src], deps(confirmOutside));
    expect(confirmOutside).not.toHaveBeenCalled();
    expect(metas[0]!.name).toBe('notes.txt');
    await expect(fs.readFile(storedPath('notes.txt'), 'utf8')).resolves.toBe('hi');
  });

  it('asks before copying an outside-workspace file and aborts on cancel', async () => {
    const secret = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(secret, 'top secret');
    const confirmOutside = vi.fn().mockResolvedValue(false);
    await expect(
      addAttachmentsWithProvenance('sess-1', workDir, [secret], deps(confirmOutside)),
    ).rejects.toThrow('已取消添加工作区外的附件');
    expect(confirmOutside).toHaveBeenCalledWith([path.resolve(secret)]);
    await expect(fs.readdir(path.join(workDir, '.stellara-attachments'))).rejects.toThrow();
  });

  it('copies an outside-workspace file after the user confirms', async () => {
    const secret = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(secret, 'top secret');
    const confirmOutside = vi.fn().mockResolvedValue(true);
    const metas = await addAttachmentsWithProvenance('sess-1', workDir, [secret], deps(confirmOutside));
    expect(confirmOutside).toHaveBeenCalledOnce();
    expect(metas).toHaveLength(1);
    await expect(fs.readFile(storedPath('secret.txt'), 'utf8')).resolves.toBe('top secret');
  });

  it('does not ask for dialog-picked sources outside the workspace', async () => {
    const picked = path.join(outsideDir, 'picked.png');
    await fs.writeFile(picked, PNG_BYTES);
    await grantAttachmentSources([picked]);
    const confirmOutside = vi.fn();
    const metas = await addAttachmentsWithProvenance('sess-1', workDir, [picked], deps(confirmOutside));
    expect(confirmOutside).not.toHaveBeenCalled();
    expect(metas[0]!.kind).toBe('image');
  });

  it('asks when at least one path is outside, listing only the outside paths', async () => {
    const inside = path.join(workDir, 'inside.txt');
    const outside = path.join(outsideDir, 'outside.txt');
    await fs.writeFile(inside, 'a');
    await fs.writeFile(outside, 'b');
    const confirmOutside = vi.fn().mockResolvedValue(true);
    await addAttachmentsWithProvenance('sess-1', workDir, [inside, outside], deps(confirmOutside));
    expect(confirmOutside).toHaveBeenCalledWith([path.resolve(outside)]);
  });
});
