# Stellara Work macOS 迁移指南

本文档面向从 Windows 迁移到 macOS（或 Linux）的开发者，涵盖数据迁移、环境搭建、开发、打包与常见问题排查。

## 1. 从 Windows 迁移

迁移分四步：备份 → 克隆 → 初始化 → 首次启动。

1. **备份数据**：在旧 Windows 机器上，将 `%APPDATA%\Stellara Work` 整个目录备份（内含配置、会话数据与加密的 API key）。更早期的版本数据存放在旧目录 `~/.stellara`（`config.json` 与 `.env`），如存在也一并备份。
2. **克隆仓库**：在新 macOS 机器上执行：
   ```bash
   git clone git@github.com:strashineltd/stellara-work.git
   cd stellara-work
   ```
3. **初始化环境**：运行 `bash setup.sh`。脚本会检查 Node.js 20+、安装依赖（better-sqlite3 自带 darwin 预编译产物，无需本地编译）并跑一遍测试。
4. **首次启动**：`npm run dev` 启动应用。首次启动会自动迁移旧数据——将备份文件还原到 macOS 数据目录后，应用会识别旧格式数据并迁移到新位置。

> 提示：API key 加密存储依赖 macOS Keychain（safeStorage），迁移后首次读取 key 时会弹出 Keychain 权限确认，选择「始终允许」即可。

## 2. 数据位置对照表

| 数据 | Windows | macOS / Linux |
|------|---------|---------------|
| 应用数据（配置、会话、加密 key） | `%APPDATA%\Stellara Work` | `~/Library/Application Support/Stellara Work` |
| 旧版数据目录（已废弃） | `~/.stellara` | `~/.stellara`（首次启动自动迁移） |
| 日志文件 | `%APPDATA%\Stellara Work\logs` | `~/Library/Logs/Stellara Work/main.log` |

macOS 下数据目录中的 `.env`（或通过 `STELLARA_KEY_<modelId>` 环境变量注入的 key）仅由主进程读取，渲染进程通过 IPC 调用无法直接获取。密钥文件永远不会被提交到仓库，`.env.example` 中只含占位符。

## 3. 开发

```bash
npm run dev        # 开发模式（Vite HMR + Electron）
npm test           # 跑测试
```

macOS / Linux 上**无需编译原生模块**：better-sqlite3 v13 内置 darwin 预编译产物（prebuilds），`npm install` 直接使用预编译二进制，不需要 Python、Xcode Command Line Tools 或 Visual Studio Build Tools。

## 4. 打包

| 命令 | 目标平台 | 说明 |
|------|----------|------|
| `npm run package:mac` | macOS（x64 + arm64） | 产出 dmg / zip，**只能在 macOS 上构建** |
| `npm run package:win` | Windows（NSIS 安装包） | 在 macOS 上交叉构建，无需 wine |

注意事项：

- `npm run package:mac` 会同时产出 x64 与 arm64 两个架构的 dmg/zip（universal 需求请按需调整 electron-builder 配置）。
- `npm run package:win` 在 macOS 上交叉构建 NSIS 安装包，不需要 wine。
- 没有代码签名证书时，请设置 `CSC_IDENTITY_AUTO_DISCOVERY=false` 跳过签名步骤，否则打包会因找不到签名身份而失败。

## 5. 常见问题

- **首次启动白屏**：先查日志 `~/Library/Logs/Stellara Work/main.log`，定位主进程报错（常见原因：数据目录权限、Keychain 拒绝访问）。
- **红绿灯（交通灯）按钮遮挡 Header**：确认版本包含 78px 安全区修复（macOS 窗口红绿灯与 Header 布局冲突的修复）。若仍遮挡，说明版本过旧，请更新后重试。
- **命令被白名单拒绝**：Agent 的 shell 工具只允许白名单内命令，改用 `ls / cat / grep / find / node` 等允许命令，或通过审批流程执行。
- **Keychain 权限弹窗**：首次访问加密 key 时系统会询问是否允许 Electron 访问钥匙串，选择「允许」即可；误点拒绝后可在「系统设置 → 隐私与安全性 → 钥匙串」中恢复。
