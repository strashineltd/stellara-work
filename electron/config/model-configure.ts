import type { ModelConfig } from '../../shared/ipc';
import { assertWorkDirGranted } from '../security/workdir-grants';

export interface ConfigureResult {
  ok: boolean;
  error?: string;
  errorKind?: string;
}

/**
 * baseUrl 规范化比较：交由 URL 解析统一大小写与尾斜杠差异，失败时退化为 trim+去尾斜杠。
 * H8：只要规范化后指向同一端点，就仍视为"同一服务器地址"（可留空 apiKey）。
 */
export function normalizeBaseUrl(raw: string | undefined | null): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return '';
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return value;
  }
}

/**
 * 配置一个模型（models:configure 处理器）。
 *
 * - 提供新 apiKey 时：先做连接测试，不通过则不写入（与 UI 文案一致）。
 * - 留空 apiKey：仅当 baseUrl 未变时保留旧 key —— 不测试、不覆盖（models:list 只下发
 *   hasKey，渲染进程拿不到旧 key，重配置留空即表示"用原来的"）。H8：baseUrl 变更时
 *   必须同时提供新 key，否则旧 key 会在下一次请求中被发往新主机。
 * - 提供 workDir 时：必须已由原生选择器授权，防止渲染层借配置种子化工作区白名单。
 */
export async function configureModel(config: ModelConfig): Promise<ConfigureResult> {
  // C2+：非字符串 workDir（如对象/数字）会绕过 typeof 授权检查并被原样落库，先拒绝。
  if (config.workDir !== undefined && typeof config.workDir !== 'string') {
    return { ok: false, error: 'workDir 必须是字符串路径' };
  }
  if (typeof config.workDir === 'string' && config.workDir.trim()) {
    try {
      await assertWorkDirGranted(config.workDir);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const { findPreset } = await import('../llm/presets');
  const { loadConfig, upsertModel } = await import('./config-v2');
  const { getKey, setKey } = await import('./secrets');
  const { checkLlmBaseUrl } = await import('../security/net-policy');

  const preset = findPreset(config.id);
  const nextBaseUrl = config.baseUrl || preset?.baseUrl || '';
  // S10：配置期拒绝元数据 / 非回环明文 http，避免 API Key 被引到内网或元数据
  if (nextBaseUrl) {
    const netCheck = checkLlmBaseUrl(nextBaseUrl);
    if (!netCheck.ok) {
      return { ok: false, error: netCheck.error ?? 'baseUrl 不合法', errorKind: 'invalid_base_url' };
    }
  }

  // H8：已有存储 key 且 baseUrl 发生变化 → 拒绝省略 apiKey 的更新，
  // 防止旧 key 被重定向到攻击者控制的新主机。
  if (!config.apiKey && getKey(config.id)) {
    const { models } = await loadConfig();
    const storedBaseUrl = models.find((m) => m.id === config.id)?.baseUrl;
    if (normalizeBaseUrl(nextBaseUrl) !== normalizeBaseUrl(storedBaseUrl)) {
      return { ok: false, error: '更改服务器地址需要重新输入 API Key', errorKind: 'key_required' };
    }
  }

  if (config.apiKey) {
    const { testModelConnection } = await import('../llm/client-factory');
    const test = await testModelConnection(config);
    if (!test.ok) {
      return { ok: false, error: `连接测试未通过，配置未写入：${test.error ?? '未知错误'}` };
    }
  }

  const entry = {
    id: config.id,
    label: config.label,
    baseUrl: config.baseUrl || preset?.baseUrl || '',
    model: config.model || preset?.model || '',
    workDir: config.workDir,
    contextWindow: config.contextWindow,
    wireApi: config.wireApi ?? preset?.wireApi ?? 'responses',
    maxOutputTokens: config.maxOutputTokens ?? preset?.maxOutputTokens,
    reasoningEffort: config.reasoningEffort === 'max' ? 'high' : config.reasoningEffort,
    compatibility: 'verified' as const,
    verifiedAt: config.apiKey ? new Date().toISOString() : undefined,
    createdAt: new Date().toISOString(),
  };
  // H8 顺序：先写 key 再落 baseUrl。若 key 写入失败，旧 key/baseUrl 组合保持不变，
  // 不会出现"新 baseUrl + 旧 key"把旧密钥发往新主机的状态。
  if (config.apiKey) {
    await setKey(config.id, config.apiKey);
  }
  await upsertModel(entry);
  return { ok: true };
}

/**
 * 更新某个模型的工作目录（models:updateWorkDir 处理器）。
 * 路径必须已由原生选择器授权，防止渲染层任意读写。
 */
export async function updateModelWorkDir(modelId: string, workDir: string): Promise<void> {
  await assertWorkDirGranted(workDir);
  const { loadConfig, saveConfig } = await import('./config-v2');
  const cfg = await loadConfig();
  const idx = cfg.models.findIndex((m) => m.id === modelId);
  if (idx < 0) throw new Error(`Model 不存在: ${modelId}`);
  cfg.models[idx] = { ...cfg.models[idx]!, workDir };
  await saveConfig(cfg);
}
