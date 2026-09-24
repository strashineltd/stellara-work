/**
 * Shared Electron Fuse policy (S24).
 * Used by after-pack hook and unit tests.
 */
'use strict';

/** @type {Record<string, boolean>} */
const FUSE_POLICY = {
  // 禁止 ELECTRON_RUN_AS_NODE=1 把应用二进制当 Node 用
  runAsNode: false,
  // Cookie 落盘加密
  enableCookieEncryption: true,
  // 禁止 NODE_OPTIONS 注入
  enableNodeOptionsEnvironmentVariable: false,
  // 禁止 --inspect / --inspect-brk 远程调试端口
  enableNodeCliInspectArguments: false,
  // ASAR 内嵌完整性校验
  enableEmbeddedAsarIntegrityValidation: true,
  // 只从 asar 加载应用代码
  onlyLoadAppFromAsar: true,
};

/**
 * @param {string} appOutDir
 * @param {string} electronPlatformName darwin | win32 | linux
 * @param {string} productFilename e.g. "Stellara Work"
 * @returns {string}
 */
function resolveElectronBinaryPath(appOutDir, electronPlatformName, productFilename) {
  const path = require('node:path');
  if (electronPlatformName === 'darwin') {
    return path.join(appOutDir, `${productFilename}.app`, 'Contents', 'MacOS', productFilename);
  }
  if (electronPlatformName === 'win32') {
    return path.join(appOutDir, `${productFilename}.exe`);
  }
  return path.join(appOutDir, productFilename);
}

module.exports = { FUSE_POLICY, resolveElectronBinaryPath };
