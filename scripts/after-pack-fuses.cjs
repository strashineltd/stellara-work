/**
 * electron-builder afterPack：翻转 Electron Fuses（S24 打包加固）。
 * 在签名前写入二进制 fuse 配置。
 */
'use strict';

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const { FUSE_POLICY, resolveElectronBinaryPath } = require('./electron-fuses.cjs');

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function afterPackFuses(context) {
  const productFilename = context.packager.appInfo.productFilename;
  const electronBinaryPath = resolveElectronBinaryPath(
    context.appOutDir,
    context.electronPlatformName,
    productFilename,
  );

  await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: FUSE_POLICY.runAsNode,
    [FuseV1Options.EnableCookieEncryption]: FUSE_POLICY.enableCookieEncryption,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FUSE_POLICY.enableNodeOptionsEnvironmentVariable,
    [FuseV1Options.EnableNodeCliInspectArguments]: FUSE_POLICY.enableNodeCliInspectArguments,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FUSE_POLICY.enableEmbeddedAsarIntegrityValidation,
    [FuseV1Options.OnlyLoadAppFromAsar]: FUSE_POLICY.onlyLoadAppFromAsar,
  });
};
