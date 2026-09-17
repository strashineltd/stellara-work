# Stellara Work 安全审查待完成事项清单（2026-09-14）

本文档汇总了在 2026-09-14 安全审查与首批漏洞修复后，仍需后续规划、评估或落地实施的进阶加固任务。

---

## 待完成事项（Pending Tasks）

### 1. [P1] `web_fetch` 传输层 IP 绑定（IP Pinning）防护 DNS Rebinding (TOCTOU)
* **涉及文件**：`electron/agent/tools/web-fetch.ts`、`electron/security/net-policy.ts`
* **现状与风险**：
  * 当前 `web_fetch` 实现了二阶段安全校验：先通过 `validateUrl` 调用 `checkUrlDestination` 解析并拦截私网、保留 IP 及受限域名；校验通过后再调用全局 `fetch(currentUrl)` 发送请求。
  * 由于 `fetch` 会在底层再次发起系统 DNS 解析，若外部目标域名配置了极短 TTL（如 0 秒）并在第二次解析时指向 `127.0.0.1` 或 `169.254.169.254`，存在通过 DNS Rebinding 绕过预检并访问本地或云元数据服务的理论时间窗口（TOCTOU）。
* **加固建议**：
  * **传输层拦截**：利用 Node.js / Undici 的连接调度器（如自定义 `undici.Agent` 或自定义 `connect.lookup`），将 DNS 校验逻辑下沉至 TCP 握手建立连接的即时时刻，若实际连接的 Socket IP 为私网地址则立即中断连接。
  * **直接 IP 请求模式**：或将请求直接发往已验证的 IP 地址，同时保留原始 `Host` 请求头与 TLS SNI，彻底消除二次 DNS 查询。

---

### 2. [P2] `safeStorage` 降级明文存储的用户感知与替代加密机制
* **涉及文件**：`electron/config/secrets.ts`、`electron/security/safe-storage.ts`
* **现状与风险**：
  * 当运行于无系统凭据环（如特定无桌面 Linux 环境、未启动 Secret Service）时，`decideSafeStorage` 会判定为不可用，`secrets.ts` 会静默以明文模式将 API Key 写入落盘文件（结合 `0o600` 文件权限控制）。
  * 用户在界面上缺乏明确感知，可能在不安全环境下认为凭据已加密保存。
* **加固建议**：
  * **UI 状态感知**：在前端设置界面中，当检测到当前系统安全存储不可用时，显示明确的安全提示横幅（如“当前运行环境缺少系统加密服务，凭据以受限权限明文存储”）。
  * **主密码方案（可选）**：为无平台加密支持的环境提供基于主密码（Master Password）和 PBKDF2/Argon2 派生密钥的本地加密方案。

---

### 3. [P2] Shell 白名单中 `sed` 命令的就地写操作（`-i`）拦截
* **涉及文件**：`electron/agent/tools/shell.ts`
* **现状与风险**：
  * 本次修复已彻底移除了具备图灵完备命令执行与任意文件读写的 `awk`。
  * 白名单中保留的 `sed` 目前被定位为“只读文本流处理”，虽已对 `-f`/`--file` 进行了工作区路径约束，但部分平台的 `sed` 支持 `-i` / `--in-place`（直接覆写源文件）或特定脚本指令 `w <file>`。
* **加固建议**：
  * 在 `shell.ts` 的参数校验中，显式拦截 `-i` 与 `--in-place` 参数，确保 `sed` 仅能作为从 `stdin` 读取并输出到 `stdout` 的纯只读管道工具。

---

### 4. [P2] macOS 生产分发 Entitlements 与公证（Notarization）配置
* **涉及文件**：`package.json`、`assets/` 或项目构建脚本
* **现状与风险**：
  * 本次已在 `package.json` 的 `build.mac` 配置中将 `hardenedRuntime` 开启为 `true`。
  * 开启硬化运行时后，macOS 要求应用配合适当的权限授权列表（`entitlements.mac.plist`）以保证合法功能正常运行（如网络连接、JIT 编译支持），否则在开启公证分发时可能会遭遇签名异常。
* **加固建议**：
  * 配置标准的 `entitlements.mac.plist` 文件并在 `package.json` 中关联 `entitlements` 与 `entitlementsInherit` 路径；
  * 验证并集成 Apple Notarization（公证）凭据流。

---

### 5. [测试] 全量回归与类型检查验证
* **涉及文件**：全代码库
* **待办项**：
  * 在本地开发环境中运行完整测试套件：
    ```bash
    npm run typecheck
    npm test
    ```
  * 重点观察 `electron/agent/tools/shell.test.ts`、`electron/mcp/mcp.test.ts`、`electron/security/net-policy.test.ts` 的通过情况。

---

## 附录：已完成修复清单（2026-09-14 本轮已合并）

1. **Shell 工具白名单收敛**：移除 `awk` 命令与参数配置，防止利用 AWK 的 `system()` 和文件重定向绕过沙箱，并补充阻断测试。
2. **MCP HTTP 云元数据防护**：在 `net-policy.ts` 中实现 `checkMcpHttpUrl`，阻止 MCP 注册或连接至 `169.254.169.254` 等云凭据元数据服务，全流程接入管理器并补充单元测试。
3. **WebContents 会话加固**：在主进程 `app.on('web-contents-created')` 中显式添加 `contents.on('will-attach-webview', (e) => e.preventDefault())`，防御 `<webview>` 注入。
4. **macOS 构建加固**：在 `package.json` 中配置启用 `build.mac.hardenedRuntime: true`。
