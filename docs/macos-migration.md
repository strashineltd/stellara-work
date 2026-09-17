# Stellara Work macOS Migration Guide · macOS 迁移指南

This guide covers migrating from Windows to macOS (or Linux): data migration, environment setup, development, packaging, and troubleshooting.

本文档面向从 Windows 迁移到 macOS（或 Linux）的开发者，涵盖数据迁移、环境搭建、开发、打包与常见问题排查。

## 1. Migrating from Windows · 从 Windows 迁移

Migration has four steps: **back up → clone → set up → first launch**.

1. **Back up your data**: on the old Windows machine, copy the whole `%APPDATA%\Stellara Work` directory (config, sessions, encrypted API keys). Older versions also stored data in `~/.stellara` (`config.json` and `.env`) — back that up too if present.
2. **Clone the repo** on the new macOS machine:
   ```bash
   git clone https://github.com/strashineltd/stellara-work.git
   cd stellara-work
   ```
3. **Initialize**: run `bash setup.sh` — it checks Node.js 20+, installs dependencies (better-sqlite3 ships darwin prebuilds, no compilation needed) and runs the test suite.
4. **First launch**: run `npm run dev`. Restore the backed-up files to `~/.stellara`, and on first launch the app auto-migrates them to the macOS data directory (`~/Library/Application Support/Stellara Work`). Config, sessions, the project database (`stellara.db`) and encrypted API keys are all migrated.

> Tip: encrypted key storage relies on the macOS Keychain (safeStorage). When your key is first read after migration, macOS asks for Keychain permission — choose "Always Allow".

## 2. Data locations · 数据位置对照表

| Data | Windows | macOS / Linux |
|------|---------|---------------|
| App data (config, sessions, encrypted keys) | `%APPDATA%\Stellara Work` | `~/Library/Application Support/Stellara Work` |
| Legacy data directory (deprecated) | `~/.stellara` | `~/.stellara` (auto-migrated on first launch) |
| Logs | `%APPDATA%\Stellara Work\logs` | `~/Library/Logs/Stellara Work/main.log` |

The `.env` in the data directory (or keys injected via `STELLARA_KEY_<modelId>` environment variables) is only read by the main process; the renderer can never obtain keys through IPC. Key files are never committed — `.env.example` only contains placeholders.

## 3. Development · 开发

```bash
npm run dev        # dev mode (Vite HMR + Electron)
npm test           # run tests
npm run typecheck  # type check both processes
```

On macOS / Linux **no native module compilation is needed**: better-sqlite3 v13 ships prebuilt darwin binaries (prebuilds), so `npm install` works without Python, Xcode Command Line Tools, or Visual Studio Build Tools.

## 4. Packaging · 打包

| Command | Target | Notes |
|---------|--------|-------|
| `npm run package:mac` | macOS | Produces dmg / zip; **macOS only** |
| `npm run package:win` | Windows (NSIS) | Cross-built from macOS, no wine needed |

Notes:

- Set `CSC_IDENTITY_AUTO_DISCOVERY=false` when you have no code-signing certificate, or packaging fails looking for a signing identity.
- macOS packages are unsigned by default without a certificate — users right-click → Open to bypass Gatekeeper.
- Windows NSIS installers can be cross-built from macOS; the x64 target requires `electron-builder --win nsis --x64` (prebuilt better-sqlite3 binaries are used automatically).

## 5. Troubleshooting · 常见问题

- **White screen on first launch**: check `~/Library/Logs/Stellara Work/main.log` for main-process errors (common causes: data directory permissions, Keychain access denied).
- **Commands rejected by the allowlist**: the agent's shell tool only permits allowlisted commands — use allowed ones (`ls / cat / grep / find / node`) or go through the approval flow.
- **Keychain permission dialog**: when an encrypted key is first accessed, macOS asks whether Electron may access the keychain — choose "Allow". If you accidentally deny, restore it in System Settings → Privacy & Security → Keychain.

## 6. Signing & Notarization · 签名与公证

### 6.1 本地 / ad-hoc 构建

`package.json` 的 `build.mac` 已启用 `hardenedRuntime`，并显式关联：

- `assets/entitlements.mac.plist`（主进程）
- `assets/entitlements.mac.inherit.plist`（渲染器 / GPU / 工具等子进程）

未配置证书的构建仍用 `"identity": "-"` 做 ad-hoc 签名（Apple Silicon 要求二进制至少有 ad-hoc 签名）。**ad-hoc 签名无法通过公证**，README 中「右键打开 / xattr」的 Gatekeeper 绕过说明依然适用。

### 6.2 发布：Developer ID + 公证（Notarization）

1. **证书**：安装 `Developer ID Application` 证书，并把 `build.mac.identity` 从 `"-"` 改为证书名（如 `Developer ID Application: Your Name (TEAMID)`）。没有证书时不要开启公证。
2. **凭据**（electron-builder 26 读取环境变量，三选一）：
   - `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`
   - `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`（推荐）
   - `APPLE_KEYCHAIN` + `APPLE_KEYCHAIN_PROFILE`
3. **构建**：`npm run package:mac`。凭据齐全时 electron-builder 在签名后自动调用 notarytool 公证；未配置凭据时日志显示 `skipped macOS notarization`。如需显式关闭，设置 `build.mac.notarize: false`。
4. **验证**：

   ```bash
   spctl -a -vvv -t install "release/mac-arm64/Stellara Work.app"
   xcrun stapler validate "release/mac-arm64/Stellara Work.app"
   ```
