# 项目入口选择合并 + 内部文件管理新建 Implementation Plan

**Goal:** 入口文件区合并为单按钮"选择文件夹或文件"（对话框可同时选文件夹/文件）；新建文件/文件夹移入内部文件管理工具栏"+"下拉。

**Architecture:** 主进程 dialog:selectProjectDir 改造（openFile+openDirectory）+ 删除 selectProjectFile/createProjectFile + 新增 fs:mkdir；契约四层同步；UI 两处改造。

**Spec:** `docs/superpowers/specs/2026-08-18-project-entry-merge-design.md`

**Global Constraints:** 全程 TDD；中文文案；禁 emoji；样式 grounded-tokens；每任务 `npm run typecheck` + 定向 vitest + `git diff --check`；最终全量测试 + dmg。

---

### Task 1: 入口文件区合并（主进程 + 契约 + ProjectDialog）

**Files:**
- Modify: `electron/main.ts`（selectProjectDir 改造；删 selectProjectFile/createProjectFile；注意 grep 全文件确认无其他引用）
- Modify: `shared/ipc.ts`、`electron/preload.ts`、`src/dev-preview.ts`
- Modify: `src/components/ProjectDialog.tsx`、`src/components/ProjectDialog.test.tsx`
- Modify: `src/project-window-contract.test.ts`（断言更新）

**Steps:**
- [ ] **Step 1: 读现状** — main.ts 三个 dialog handlers 全文；ProjectDialog 全文件；契约文件相关段
- [ ] **Step 2: 写失败测试** — ProjectDialog.test.tsx：仅一个按钮"选择文件夹或文件"（文案断言）；选文件/选文件夹两种 mock 路径正确设置状态；无"新建文件"按钮断言。契约测试更新
- [ ] **Step 3: 运行确认失败** — `npx vitest run src/components/ProjectDialog.test.tsx src/project-window-contract.test.ts`
- [ ] **Step 4: 实现** — main.ts 改造（selectProjectDir：properties ['openFile','openDirectory']；selected realpath + stat 分支：isFile → workDir=grantWorkDir(dirname)+entryFile=file；isDirectory → grantWorkDir(dir)+README 探测）；删除两个旧 handler；契约四层删除/改造；ProjectDialog 单按钮
- [ ] **Step 5: 测试 + typecheck + 提交**

Run: `npx vitest run src/components/ProjectDialog.test.tsx src/project-window-contract.test.ts && npm run typecheck && git diff --check`
Commit: `git commit -m "feat(projects): single entry picker supporting file or folder"`

---

### Task 2: 内部文件管理新建（fs:mkdir + 工具栏"+"下拉）

**Files:**
- Modify: `electron/main.ts`（fs:mkdir handler：assertWorkDirAllowed + 相对路径校验（禁 .. / 绝对路径）+ 冲突检测 + mkdir）
- Modify: `shared/ipc.ts`、`electron/preload.ts`、`src/dev-preview.ts`（fs.mkdir）
- Modify: `src/components/files/SidebarFileView.tsx` + `.test.tsx`（工具栏"+"下拉：新建文件/新建文件夹；行内输入名称；成功后刷新）
- Modify: `src/components/FileTreeModal.tsx`（全屏同样入口，复用逻辑）
- Modify: `src/styles/workbench.css`（下拉样式）

**Steps:**
- [ ] **Step 1: 读现状** — SidebarFileView 全文；FileTreeModal 相关；fs:createFile handler 实现
- [ ] **Step 2: 写失败测试** — fs:mkdir 主进程逻辑（相对路径越界/绝对路径/冲突拒绝）；SidebarFileView 工具栏"+"下拉渲染、新建文件调 createFile、新建文件夹调 mkdir、成功后 refresh
- [ ] **Step 3: 运行确认失败** — `npx vitest run src/components/files/SidebarFileView.test.tsx src/components/FileTreeModal.test.tsx`
- [ ] **Step 4: 实现**
- [ ] **Step 5: 测试 + typecheck + 提交**

Run: `npx vitest run src/components/files/SidebarFileView.test.tsx src/components/FileTreeModal.test.tsx && npm run typecheck && git diff --check`
Commit: `git commit -m "feat(files): new file/folder actions in file manager"`

---

### Task 3: 全量回归 + 冒烟 + 打包

- [ ] **Step 1:** `npm test`（全绿）
- [ ] **Step 2:** `npm run typecheck && git diff --check`
- [ ] **Step 3:** 冒烟 `nohup npm run dev`：入口文件区单按钮选文件/选文件夹；侧栏与全屏文件树"+"新建文件/文件夹后树刷新
- [ ] **Step 4:** 提交 + `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac` 验证 dmg
