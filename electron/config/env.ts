import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config as loadDotenv } from 'dotenv';

const ENV_DIR = path.join(os.homedir(), '.stellara');
const ENV_PATH = path.join(ENV_DIR, '.env');

let loaded = false;

export function getEnvPath(): string {
  return ENV_PATH;
}

/**
 * 加载 ~/.stellara/.env 到 process.env
 *
 * 文件权限 0600，明文（用户决策，v0.9 用 .env 方案）
 */
export async function loadEnv(): Promise<void> {
  if (loaded) return;

  try {
    await fs.access(ENV_PATH);
    loadDotenv({ path: ENV_PATH });
    loaded = true;
  } catch {
    // .env 不存在，初始化一个空文件
    await fs.mkdir(ENV_DIR, { recursive: true });
    await fs.writeFile(ENV_PATH, '# Stellara Work API keys\n# 0600 权限，不要提交到 git\n', {
      mode: 0o600,
    });
    loaded = true;
  }
}
