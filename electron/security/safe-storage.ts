/**
 * safeStorage 可用性决策（M3）。
 *
 * Linux 上 Electron 可能选中 `basic_text` 后端——它不做任何加密，等同明文。
 * 此时不能对外宣称「已加密落盘」，应与 safeStorage 不可用走同一条降级路径。
 *
 * 抽成纯函数便于测试；平台与 backend 由调用方注入，避免模块级 process 依赖。
 */

export interface SafeStorageStatus {
  /** process.platform */
  platform: string;
  /** safeStorage.isEncryptionAvailable() */
  encryptionAvailable: boolean;
  /** safeStorage.getSelectedStorageBackend()（仅 Linux 有意义，可能不存在） */
  backend?: string | null;
}

export type SafeStorageDecision =
  | { usable: true }
  | { usable: false; reason: 'unavailable' | 'linux-basic-text' };

export function decideSafeStorage(status: SafeStorageStatus): SafeStorageDecision {
  if (!status.encryptionAvailable) return { usable: false, reason: 'unavailable' };
  if (status.platform === 'linux' && status.backend === 'basic_text') {
    return { usable: false, reason: 'linux-basic-text' };
  }
  return { usable: true };
}
