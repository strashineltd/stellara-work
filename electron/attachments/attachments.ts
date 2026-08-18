/**
 * 附件模块：校验 + 复制 + 读取 + 打开
 *
 * 附件存储在 `workDir/.stellara-attachments/{sessionId}/` 内（Agent 工具边界内可读）。
 * id 即磁盘上的存储文件名（含冲突时间戳后缀），readImage/open 凭 id 解析附件路径。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isWithinDir, verifyExistingPath } from '../fs/path-security';

export interface AttachmentMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: 'image' | 'file';
  /** 相对附件目录（{sessionId}/{name}，正向斜杠） */
  relPath: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_IMAGE_READ_SIZE = 5 * 1024 * 1024;
const ATTACHMENTS_DIR = '.stellara-attachments';

const BLACKLISTED_EXTENSIONS = new Set([
  '.exe', '.dmg', '.msi', '.pkg', '.app', '.sh', '.bat', '.cmd', '.ps1', '.jar',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.yml': 'application/yaml',
  '.yaml': 'application/yaml',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9-_]/g, '-');
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/]/g, '-').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('文件名无效');
  }
  return cleaned;
}

function attachmentRoot(workDir: string): string {
  return path.resolve(workDir, ATTACHMENTS_DIR);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function mimeForExtension(ext: string): string {
  return MIME_BY_EXTENSION[ext.toLowerCase()] ?? 'application/octet-stream';
}

export async function addAttachments(sessionId: string, workDir: string, filePaths: string[]): Promise<AttachmentMeta[]> {
  const root = attachmentRoot(workDir);
  const safeSessionId = sanitizeSessionId(sessionId);
  const targetDir = path.join(root, safeSessionId);

  // 先整体校验（任一文件非法则整体失败，不产生部分复制），通过后才建目录
  const validated: Array<{ filePath: string; stat: import('node:fs').Stats; ext: string }> = [];
  for (const filePath of filePaths) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) throw new Error(`文件不存在：${filePath}`);
    if (!stat.isFile()) throw new Error(`不是文件：${filePath}`);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`文件超过 50MB 限制：${filePath}`);
    }
    const ext = path.extname(filePath).toLowerCase();
    if (BLACKLISTED_EXTENSIONS.has(ext)) {
      throw new Error(`不允许上传可执行/脚本文件：${ext}`);
    }
    validated.push({ filePath, stat, ext });
  }
  await fs.mkdir(targetDir, { recursive: true });

  const results: AttachmentMeta[] = [];
  for (const { filePath, stat, ext } of validated) {
    const name = sanitizeFileName(path.basename(filePath));
    let storedName = name;
    if (await pathExists(path.join(targetDir, storedName))) {
      const base = name.slice(0, name.length - path.extname(name).length);
      let ts = Date.now();
      while (await pathExists(path.join(targetDir, `${base}-${ts}${path.extname(name)}`))) {
        ts += 1;
      }
      storedName = `${base}-${ts}${path.extname(name)}`;
    }
    const target = path.resolve(targetDir, storedName);
    if (!isWithinDir(target, root)) {
      throw new Error(`附件路径越界：${target}`);
    }
    await fs.copyFile(filePath, target);
    results.push({
      id: storedName,
      name: storedName,
      size: stat.size,
      mimeType: mimeForExtension(ext),
      kind: IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file',
      relPath: `${safeSessionId}/${storedName}`,
    });
  }
  return results;
}

/**
 * 解析附件绝对路径：sessionId/id 均经 sanitize，resolve 后必须仍在附件根目录内，
 * 且已存在路径的 realpath 也必须落在根目录内（防 symlink 指向外部文件）。
 * 返回真实路径供后续读取/打开。
 */
async function resolveAttachmentPath(sessionId: string, workDir: string, id: string): Promise<string> {
  const root = attachmentRoot(workDir);
  const safeSessionId = sanitizeSessionId(sessionId);
  const safeName = sanitizeFileName(id);
  const resolved = path.resolve(root, safeSessionId, safeName);
  if (!isWithinDir(resolved, root)) {
    throw new Error(`附件路径越界：${resolved}`);
  }
  const check = await verifyExistingPath(resolved, root);
  if (!check.ok) {
    throw new Error(check.error);
  }
  return check.realPath;
}

export async function readAttachmentImage(sessionId: string, workDir: string, id: string): Promise<{ dataUrl: string }> {
  const filePath = await resolveAttachmentPath(sessionId, workDir, id);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) throw new Error(`附件不存在：${id}`);
  if (stat.size > MAX_IMAGE_READ_SIZE) {
    throw new Error('图片超过 5MB，无法预览');
  }
  const ext = path.extname(id).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error('仅支持读取图片附件');
  }
  const buffer = await fs.readFile(filePath);
  return { dataUrl: `data:${mimeForExtension(ext)};base64,${buffer.toString('base64')}` };
}

/**
 * 返回附件目录内的绝对路径（由 main handler 调用 shell.openPath）。
 */
export async function openAttachment(sessionId: string, workDir: string, id: string): Promise<string> {
  return resolveAttachmentPath(sessionId, workDir, id);
}
