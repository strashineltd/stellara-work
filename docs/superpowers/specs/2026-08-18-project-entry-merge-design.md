# 项目入口选择合并 + 内部文件管理新建

> 日期：2026-08-18
> 状态：设计定稿

## 1. 背景与决策（用户确认）

- 项目入口文件区原为三按钮：选择文件夹 / 选择文件 / 新建文件。
- **决策 A**：入口文件区只保留一个按钮，文案改为**"选择文件夹或文件"**；对话框（macOS 原生）同时支持选文件夹或文件。
  - 选中文件 → workDir = 文件所在目录，entryFile = 该文件
  - 选中文件夹 → workDir = 该文件夹，entryFile = 自动探测 README.md（无则留空）
- **决策 B**：移除"新建文件"按钮；**新建文件/文件夹功能移入内部文件管理**（侧栏文件树 + 全屏文件树）。
  - 交互：工具栏"+"按钮展开两个选项（新建文件 / 新建文件夹）
  - 新建后自动刷新文件树

## 2. 变更范围

### 2.1 主进程（electron/main.ts）
- `dialog:selectProjectDir` 改造：`properties: ['openFile', 'openDirectory']`；按选中类型（stat.isFile/isDirectory）分支处理；文件路径需 realpath + 父目录 grantWorkDir
- 删除 `dialog:selectProjectFile`、`dialog:createProjectFile` handlers
- 新增 `fs:mkdir`：workDir + relativePath 校验（assertWorkDirAllowed + 越界防护 + 独占创建 mkdir），返回新目录路径

### 2.2 契约层
- `shared/ipc.ts`：ElectronAPI 移除 `dialog.selectProjectFile/createProjectFile`；`fs` 增加 `mkdir(workDir, relativePath)`
- `electron/preload.ts`：同步调整
- `src/dev-preview.ts`：同步调整

### 2.3 ProjectDialog（src/components/ProjectDialog.tsx）
- 移除"选择文件""新建文件"按钮与对应逻辑；保留单按钮"选择文件夹或文件"（文案改）
- 移除 createProjectFile 调用与 busyAction 分支

### 2.4 内部文件管理（src/components/files/SidebarFileView.tsx + FileTreeModal.tsx）
- 工具栏加"+"下拉：新建文件 / 新建文件夹
- 新建文件：`fs.createFile(workDir, name)`；新建文件夹：`fs.mkdir(workDir, name)`
- 名称输入：内联提示（prompt 式弹层）或行内输入；确认后调用 IPC 并刷新树
- 名称校验：非空、无路径分隔符/..、不冲突（冲突显示错误）

## 3. 验收
1. 入口文件区仅一个"选择文件夹或文件"按钮；选文件与选文件夹两种路径均正确设置 workDir/entryFile
2. 新建按钮不存在于入口文件区；侧栏与全屏文件树均可"+"新建文件/文件夹，成功后树刷新可见
3. 契约测试更新（project-window-contract.test.ts 相关断言）
4. typecheck + 全量测试通过；dmg 重新打包
