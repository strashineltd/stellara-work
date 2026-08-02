/**
 * 模型上下文窗口选项（共享类型，主/渲染进程都用）
 *
 * 4 个内置 + 1 个自定义都从这个列表选；不在列表里的也算合法但没预设档位。
 */
export const CONTEXT_WINDOW_OPTIONS = [
  { value: 256_000, label: '256K' },
  { value: 512_000, label: '512K' },
  { value: 1_000_000, label: '1M' },
] as const;

export const DEFAULT_CONTEXT_WINDOW = 256_000;

/** 默认压缩阈值 = contextWindow × 90% */
export function defaultThresholdTokens(contextWindow: number): number {
  return Math.floor(contextWindow * 0.9);
}

export type ContextWindowValue = (typeof CONTEXT_WINDOW_OPTIONS)[number]['value'];