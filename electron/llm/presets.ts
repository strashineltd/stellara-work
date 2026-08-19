import type { ModelPreset } from '../../shared/ipc';

/**
 * 内置模型预设（v0.9.2）
 *
 * Responses API 支持状态：
 * - DeepSeek-V4-Pro、DeepSeek-V4-Flash：已验证（7/7 能力）
 * - Qwen3.8-Max：待验证（需 DashScope API Key）
 * - GLM-5.3：待验证（需智谱 API Key）
 * - GLM-5.2、Kimi-K3、MiniMax-M3：不支持 Responses，保留配置但禁用执行
 */

export interface ModelPresetWithCapability extends ModelPreset {
  /** 协议类型：responses 或 anthropic */
  wireApi: 'responses' | 'anthropic';
  /** Responses 兼容状态 */
  compatibility: 'verified' | 'unverified' | 'incompatible';
  /** 是否可执行（verified 时可执行） */
  executable: boolean;
  /** 最大输出 token */
  maxOutputTokens?: number;
  /** reasoning effort */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export const MODEL_PRESETS: ModelPresetWithCapability[] = [
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek-V4-Pro',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    isCustom: false,
    wireApi: 'responses',
    compatibility: 'verified',
    executable: true,
    maxOutputTokens: 16384,
    reasoningEffort: 'medium',
  },
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek-V4-Flash',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    isCustom: false,
    wireApi: 'responses',
    compatibility: 'verified',
    executable: true,
    maxOutputTokens: 16384,
    reasoningEffort: 'low',
  },
  {
    id: 'qwen3.8-max',
    label: 'Qwen3.8-Max (阿里云)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
    isCustom: false,
    wireApi: 'responses',
    compatibility: 'unverified',
    executable: false,
    maxOutputTokens: 16384,
  },
  {
    id: 'glm-5.3',
    label: 'GLM-5.3 (智谱 BigModel)',
    baseUrl: 'https://open.bigmodel.cn/api/v1',
    model: 'glm-5.3',
    isCustom: false,
    wireApi: 'responses',
    compatibility: 'unverified',
    executable: false,
    maxOutputTokens: 65536,
    reasoningEffort: 'max',
  },
  {
    id: 'glm-5.2',
    label: 'GLM-5.2 (智谱 BigModel)',
    baseUrl: 'https://open.bigmodel.cn/api/v1',
    model: 'glm-5.2',
    isCustom: false,
    wireApi: 'responses',
    compatibility: 'unverified',
    executable: false,
    maxOutputTokens: 65536,
  },
  {
    id: 'kimi-k3',
    label: 'Kimi-K3 (月之暗面 Moonshot)',
    baseUrl: 'https://api.moonshot.cn',
    model: 'kimi-k3',
    isCustom: false,
    wireApi: 'responses',
    compatibility: 'incompatible',
    executable: false,
  },
  {
    id: 'minimax-m3',
    label: 'MiniMax-M3',
    baseUrl: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    isCustom: false,
    wireApi: 'responses',
    compatibility: 'unverified',
    executable: false,
    maxOutputTokens: 16384,
  },
  {
    id: 'custom',
    label: '自定义模型（Responses API）',
    baseUrl: '',
    model: '',
    isCustom: true,
    wireApi: 'responses',
    compatibility: 'unverified',
    executable: false,
  },
  {
    id: 'custom-anthropic',
    label: '自定义模型（Anthropic Messages）',
    baseUrl: '',
    model: '',
    isCustom: true,
    wireApi: 'anthropic',
    compatibility: 'unverified',
    executable: false,
  },
];

export function findPreset(id: string): ModelPresetWithCapability | undefined {
  return MODEL_PRESETS.find((p) => p.id === id);
}

/** 获取可执行的预设（已验证的） */
export function getExecutablePresets(): ModelPresetWithCapability[] {
  return MODEL_PRESETS.filter((p) => p.executable);
}
