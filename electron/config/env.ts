import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { getAppDataDir } from './data-dir';

let loaded = false;

/**
 * 视为密钥的 STELLARA 前缀：这些值由 secrets.ts 直接从 .env 解密读取，
 * 不需要进入 process.env。
 * 注意 `STELLARA_CLOUDBASE_PUBLISHABLE_KEY` 不匹配 `STELLARA_CLOUD_`
 * （CLOUD 后是 B 而非下划线），它是官方定位可暴露的 Publishable Key，
 * 且 cloudbase-client 依赖从 process.env 读取，故不受影响。
 */
const SECRET_ENV_PREFIXES = ['STELLARA_KEY_', 'STELLARA_SERVER_', 'STELLARA_CLOUD_'];

/** 明显的密钥型键名模式 */
const SECRET_ENV_PATTERNS = [/_TOKEN$/i, /_SECRET$/i, /_PASSWORD$/i, /_API_KEY$/i];

/** 判定键名是否携带密钥/凭据（与 shell 子进程清洗口径一致） */
export function isSecretEnvKey(key: string): boolean {
  if (SECRET_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  return SECRET_ENV_PATTERNS.some((re) => re.test(key));
}

export function getEnvPath(): string {
  return path.join(getAppDataDir(), '.env');
}

/**
 * 从标准应用数据目录加载 .env 到 process.env
 *
 * 安全：密钥型键（STELLARA_KEY_* / STELLARA_SERVER_* / STELLARA_CLOUD_* 及
 * *_TOKEN/_SECRET/_PASSWORD/_API_KEY）只解析、不并入 process.env（H5），
 * 避免被环境转储类命令读出。
 */
/** 重置 env 缓存（clearAllData 后调用，清除 process.env 中残留的旧 key） */
export function resetEnvCache(): void {
  loaded = false;
  for (const key of Object.keys(process.env)) {
    if (isSecretEnvKey(key)) {
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
    // 先解析到独立对象，再手动并入非密钥键（保持 dotenv 默认的「不覆盖已有值」语义）
    const parsed = loadDotenv({ path: envPath, processEnv: {}, quiet: true }).parsed ?? {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isSecretEnvKey(key)) continue;
      if (process.env[key] === undefined) process.env[key] = value;
    }
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
