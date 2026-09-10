import { promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_LEVELS = 10;

async function readHead(gitDir: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(gitDir, 'HEAD'), 'utf-8');
  } catch {
    return null;
  }
}

/** 读取 workDir 所在仓库的当前分支；detached HEAD 返回 7 位短 hash；非 git 目录返回 null。 */
export async function readGitBranch(workDir: string): Promise<string | null> {
  let current = path.resolve(workDir);
  for (let i = 0; i < MAX_LEVELS; i++) {
    const dotGit = path.join(current, '.git');
    const head = await readHead(dotGit);
    if (head !== null) {
      const text = head.trim();
      if (text.startsWith('ref: refs/heads/')) return text.slice('ref: refs/heads/'.length);
      if (/^[0-9a-f]{40}$/i.test(text)) return text.slice(0, 7);
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
