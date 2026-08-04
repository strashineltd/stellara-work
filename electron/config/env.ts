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
 * 注意：STELLARA_KEY_* 条目在 Windows 上经 safeStorage（DPAPI）加密存储
 * （见 secrets.ts），此处仅做 dotenv 载入，真实密钥一律通过 secrets 模块
 * 解密读取，不要从 process.env 取密钥。
 */
/** 重置 env 缓存（clearAllData 后调用，清除 process.env 中残留的旧 key） */
export function resetEnvCache(): void {
  loaded = false;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('STELLARA_KEY_')) {
      delete process.env[key];
    }
  }
}

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
