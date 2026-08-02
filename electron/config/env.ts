import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { getAppDataDir } from './data-dir';

let loaded = false;

export function getEnvPath(): string {
  return path.join(getAppDataDir(), '.env');
}

/**
 * 从标准应用数据目录加载 .env 到 process.env
 *
 * 文件权限 0600，明文（用户决策，v0.9 用 .env 方案）
 */
export async function loadEnv(): Promise<void> {
  if (loaded) return;

  const envDir = getAppDataDir();
  const envPath = getEnvPath();

  try {
    await fs.access(envPath);
    loadDotenv({ path: envPath });
    loaded = true;
  } catch {
    // .env 不存在，初始化一个空文件
    await fs.mkdir(envDir, { recursive: true });
    await fs.writeFile(envPath, '# Stellara Work API keys\n# 0600 权限，不要提交到 git\n', {
      mode: 0o600,
    });
    loaded = true;
  }
}
