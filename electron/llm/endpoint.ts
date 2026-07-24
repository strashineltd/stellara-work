/**
 * Chat Completions endpoint 拼接规则
 *
 * 不同厂商的 base_url 形式不统一：
 * - GLM 智谱：https://open.bigmodel.cn/api/paas/v4（自带 /v4）
 * - DeepSeek：https://api.deepseek.com（不带 /v1）
 * - Kimi (Moonshot)：https://api.moonshot.cn（不带 /v1）
 * - MiniMax：https://api.minimaxi.com/v1（带 /v1）
 *
 * 这个函数统一处理这三种情况。
 */
export function buildChatCompletionsUrl(baseUrl: string): string {
  if (!baseUrl) {
    throw new Error('base_url 不能为空');
  }
  const base = baseUrl.replace(/\/+$/, ''); // 去掉末尾斜杠

  // GLM 智谱：已经包含 /v4 路径前缀，直接拼 chat/completions
  if (base.includes('/paas/')) {
    return `${base}/chat/completions`;
  }

  // 已经在 /v1 结尾的（OpenAI / MiniMax）：直接拼 chat/completions
  if (base.endsWith('/v1')) {
    return `${base}/chat/completions`;
  }

  // DeepSeek / Kimi 等：需要补 /v1
  return `${base}/v1/chat/completions`;
}

/**
 * 列出某个 base_url 下的可用 models endpoint（用于"自定义模型"槽位的 model 选择）
 * 大多数 OpenAI 兼容厂商都支持 GET {base}/models
 */
export function buildModelsUrl(baseUrl: string): string {
  if (!baseUrl) {
    throw new Error('base_url 不能为空');
  }
  const base = baseUrl.replace(/\/+$/, '');
  if (base.includes('/paas/')) {
    return `${base}/models`;
  }
  if (base.endsWith('/v1')) {
    return `${base}/models`;
  }
  return `${base}/v1/models`;
}
