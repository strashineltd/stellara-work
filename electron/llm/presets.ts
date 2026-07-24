import type { ModelPreset } from '../../shared/ipc';

/**
 * 4 个内置模型预设 + 1 个自定义槽位
 *
 * base_url 是精确值（用户给的）：
 * - GLM：https://open.bigmodel.cn/api/paas/v4（带 /v4）
 * - DeepSeek：https://api.deepseek.com（不带 /v1）
 * - Kimi：https://api.moonshot.cn（不带 /v1）
 * - MiniMax：https://api.minimaxi.com/v1（带 /v1）
 * - Custom：用户填任意 OpenAI 兼容 base_url
 */
export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'glm-5.2',
    label: 'GLM-5.2 (智谱 BigModel)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.2',
    isCustom: false,
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek-v4-Pro',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    isCustom: false,
  },
  {
    id: 'kimi-k3',
    label: 'Kimi-K3 (月之暗面 Moonshot)',
    baseUrl: 'https://api.moonshot.cn',
    model: 'kimi-k3',
    isCustom: false,
  },
  {
    id: 'minimax-m3',
    label: 'MiniMax-M3',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M3',
    isCustom: false,
  },
  {
    id: 'custom',
    label: '自定义模型（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    isCustom: true,
  },
];

export function findPreset(id: string): ModelPreset | undefined {
  return MODEL_PRESETS.find((p) => p.id === id);
}
