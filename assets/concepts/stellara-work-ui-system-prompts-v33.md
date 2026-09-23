# Stellara Work UI system — final ImageGen prompt set

Built-in ImageGen was used. The accepted v24 workbench image was supplied as a style and shell reference for each additional screen.

## Shared prompt

Image 1 is a STYLE AND SHELL REFERENCE only. Generate a new page in exactly the same Stellara Work product family; do not edit its inner content.
Use case: ui-mockup
Asset type: high-fidelity desktop application screen, 1586x992 landscape.
Shared shell invariants: reproduce the reference's warm off-white main canvas, pale warm-gray 296px sidebar, charcoal text, thin light-gray borders, restrained green status accent, SF Pro / PingFang SC-like typography, flat surfaces, generous whitespace, sharp one-pixel rules, crisp readable Simplified Chinese. Reproduce its macOS traffic lights, sidebar dimensions, top project tabs, and spacing system. At top, exactly two connected zero-gap project tabs “桌面端产品” and “核心引擎”, project icons and close controls, followed by a plus segment. No colored line above the tabs. No logo or wordmark.
Rendering: edge-to-edge straight-on app screenshot, 1586x992, extremely sharp raster UI, accurate Chinese characters, no surrounding device or desktop.
Avoid: sci-fi, gradients, glass, glow, bright blue decoration, dashboard tile wall, heavy shadows, large illustrations, oversized empty title, tiny text, blurry type.

## Home / new task

Page: 首页 / 新建任务.
Sidebar: keep “新建任务” and “搜索” at top. Under small heading “最近任务”, show “重新设计工作台”, “优化构建性能”, “修复设置样式” as quiet flat rows, none selected. Bottom stays “自动化” and “设置”.
Top project tabs: make “桌面端产品” active.
Main content: no task header toolbar. Create a calm centered start view beginning around y=210. Small plain heading “开始一个新任务” and one understated line “选择项目并描述你想完成的工作”. Directly below, a wide composer about 760px by 150px. Placeholder “描述任务，或输入 / 使用技能”. Inside the composer footer: plus attachment icon; compact project selector “桌面端产品”; model selector “GPT-5”; execution selector “自动执行”; at far right a 32px charcoal circular send button with white up arrow.
Below the composer show a small text label “最近使用” and exactly three plain unboxed suggestion rows with simple line icons: “优化首屏加载性能”, “检查未提交的代码变更”, “为核心模块补充测试”. Use hairline separators, no large capability cards.
Top right of the content area has only a quiet “本地” environment control and an ellipsis. Keep ample breathing room.

## Change review

Page: 变更审阅 / 查看更改.
Sidebar: same accepted shell, with task list under “任务”; “重新设计工作台” selected. Bottom stays “自动化” and “设置”.
Top tabs: “桌面端产品” active, “核心引擎” inactive.
Task header below tabs: left has back chevron, title “查看更改”; quiet summary “3 个文件 · +138 −36”. Right contains compact neutral buttons “全部保留” and “全部撤销”, then ellipsis. One fine divider.
Main area uses a practical two-column review layout from x≈390 to x≈1510, leaving the main sidebar intact. A narrow internal file list about 250px wide on the left, separated by one hairline divider. Heading “已修改 3”. Rows: “Sidebar.tsx” selected, “Workspace.tsx”, “theme.css”; each shows small green plus and red minus counts aligned right. No card around the list.
Right diff viewer has a compact file header: small file icon, “src/components/Sidebar.tsx”, “打开文件”. Below show one crisp unified code diff with line numbers 118–134. Use very pale green added-line backgrounds, very pale red removed-line backgrounds and plenty of neutral unchanged lines. Include readable TypeScript/CSS-like code but keep the Chinese UI labels exact. Do not make it a dark code editor. At bottom right place two modest actions “撤销此文件” and a charcoal primary “保留此文件”.
No conversation composer on this page.

## Memory center

Page: 记忆中心.
Use the shared app shell. Sidebar top retains “新建任务” and “搜索”. Replace the task list portion with a compact primary navigation group: “任务”, “记忆” selected, “文件”, “自动化”. Bottom remains “设置”. Do not show duplicate project/session items on this page.
Top project tabs remain visible and connected, with “桌面端产品” active.
Under tabs, page header: title “记忆”; secondary line “自动沉淀任务要点，并在后续工作中调用”. Right side quiet text button “导出全部” and charcoal compact button “新建记忆”. One hairline divider below.
Main content maximum width about 980px. First row: a wide search field with search icon and placeholder “搜索记忆内容、标签…”, followed by two compact outlined selectors “全部类型” and “全部作用域”. Under it a plain text-filter row: “全部 24”, “个人 6”, “项目 15”, “企业 3”; active “全部 24” uses a subtle warm-gray background, no bright color.
Below, section label “重要记忆 3”. Show three clean list rows, separated by hairlines, not floating cards. Each row has a small pin icon, a semibold concise memory sentence, one-line muted metadata beneath, and an ellipsis at right:
1. “工作台界面采用极简浅色样式” — “偏好 · 桌面端产品 · 2 天前”
2. “项目使用 React、TypeScript 与 Electron” — “代码库 · 桌面端产品 · 5 天前”
3. “发布前必须通过全部单元测试” — “决策 · 核心引擎 · 1 周前”
Then section “最近记忆” with three more compact rows. Do not use multicolumn card grid.

## File browser

Page: 文件浏览.
Use the shared app shell. Sidebar top retains “新建任务” and “搜索”. Replace the task list portion with a compact primary navigation group: “任务”, “记忆”, “文件” selected, “自动化”. Bottom remains “设置”. Top project tabs remain connected with “桌面端产品” active.
Under tabs, page header title “文件”; quiet project path “桌面端产品 / src”. Right side contains three unboxed icon actions for refresh, new item, and more. One divider below.
Main content is a crisp two-pane file browser starting immediately below the header. Internal left pane width about 300px with heading “桌面端产品”, a compact file tree: folders “src”, “components”, “styles”, “shared”; expanded src/components contains “Sidebar.tsx” selected, “Workspace.tsx”, “InputArea.tsx”; also show “package.json” and “README.md”. Use disclosure chevrons, 16px monochrome file/folder icons, tight rows and one subtle selection background. No outer card.
Right pane has a file header with “Sidebar.tsx”, muted “TypeScript · 8.4 KB”, and plain actions “打开” and ellipsis. Below show a bright white read-only source preview with clear line numbers 1–26 and restrained syntax colors. Highlight one current line in very pale gray. Add a thin bottom status line “UTF-8 · LF · TypeScript React”. No dark editor chrome, no terminal, no oversized empty state.

## Automation

Page: 自动化 / 已安排.
Use the shared app shell. Sidebar top remains “新建任务” and “搜索”. In primary navigation show “任务”, “记忆”, “文件”, “自动化” selected. Bottom remains “设置”. Top project tabs stay visible and connected.
Page header below tabs: title “自动化”; muted subtitle “按计划运行重复任务”. Right side charcoal compact button “新建自动化”. One divider.
Main content maximum width about 1050px. Directly under header show a quiet segmented filter “全部 3”, “运行中 2”, “已暂停 1”, with “全部 3” subtly selected. To the right a small outlined selector “所有项目”.
Use a clean list/table, no card grid. Column headings: “名称”, “计划”, “项目”, “下次运行”, “状态”, blank actions. Three spacious rows separated by hairlines:
1. “每日检查依赖更新” / “每天 09:00” / “桌面端产品” / “明天 09:00” / green dot “启用”
2. “每周生成项目摘要” / “每周一 10:00” / “核心引擎” / “下周一 10:00” / green dot “启用”
3. “测试失败时分析原因” / “每 30 分钟” / “桌面端产品” / “—” / gray dot “已暂停”
Each row has a subtle toggle and ellipsis on right. Below table, section “最近运行” showing three compact rows with check/error icons, task name, time, duration, and “查看任务” link. Use one small pale-red error status only for a failed historical run.

## Settings

Page/state: 设置中心 open as a large modal overlay.
Use the shared app shell behind it, but softly mute the underlying content with a light translucent white veil, keeping the same sidebar and tabs barely visible. Center a large settings dialog about 1120px wide and 780px high with white background, 12px corners, thin border and a very restrained shadow. Do not use a dark backdrop.
Dialog header across top: “设置” left, small close x right, one hairline divider.
Inside, left settings navigation about 220px wide with exact rows and small monochrome icons: “模型” selected, “会话”, “应用”, “服务器”, “AI 浏览器”, “技能与 MCP”, “快捷键”, “账号”. Selection is a subtle warm-gray row, no blue stripe.
Right settings content uses a clean 680px reading column. Header “模型”, subtitle “配置默认模型与执行方式”. First section “默认模型”: horizontal setting row with label and helper copy on left, outlined selector “GPT-5” right. Next row “推理强度” with segmented choices “低  中  高”, medium selected in gray. Next row “默认执行方式” with selector “自动执行”. Next section “已配置模型”: two plain bordered list rows, “GPT-5 · OpenAI” with green “可用” and “Claude Sonnet · Anthropic” with green “可用”; each has ellipsis. Small outlined “添加模型” below. Final section “上下文” has row “自动压缩长对话” with switch on and muted helper text. Use generous vertical spacing, clear labels, no form card wall, no bright primary color.

## Task running

Page/state: active task currently running.
Use the exact same workbench shell as the reference, with sidebar task “优化构建性能” selected and “桌面端产品” active in the connected project tabs.
Task header below tabs: title “优化构建性能”; right side branch “main”, quiet button “查看更改 2”, and ellipsis. One divider.
Main reading column about 800px wide centered to the right of sidebar. User message pale gray and right-aligned: “分析首屏加载瓶颈，并完成可以安全落地的优化。”
Assistant label “Stellara”, response “我会先检查构建配置与入口依赖，再验证修改结果。”
Below, display a minimal vertical sequence of work steps with no large cards:
- green check “分析项目结构”
- green check “读取构建配置”
- green check “修改 2 个文件”
- small neutral spinner and semibold “正在运行测试”
Use short gray connector lines between status icons. Under the active step show one modest expanded terminal region, warm light-gray background, exact title “npm test”, and 5 concise monospaced output lines ending “Tests: 126 passed, 2 running”. The terminal is light, not black.
At bottom of the reading column, composer is disabled/quiet with placeholder “任务执行中…”. Footer controls remain, and far right has two compact controls: pause icon and a dark circular stop-square button. Add tiny status text below “已运行 42 秒 · 本地”. No completion summary or file-change list yet.

## First launch

Page: first-launch onboarding, model selection step.
Generate a standalone first-run Stellara Work window in the same visual system, without the normal sidebar or project tabs. Keep macOS traffic lights at top left and a tiny “跳过” text action at top right. Warm off-white full canvas.
Centered content column 720px wide. At top show a quiet three-step indicator with thin line: “1 欢迎” completed with a check, “2 选择模型” active with dark circle, “3 配置密钥” inactive gray. No bright accent color.
Main heading “选择默认模型”; subtitle “你可以稍后在设置中随时更改”. Below show a single clean list with three bordered rows:
- “GPT-5” with helper “适合复杂开发任务” selected using a dark radio dot
- “Claude Sonnet” with helper “快速、平衡”
- “本地模型” with helper “通过 OpenAI 兼容接口连接”
Each row has simple neutral geometric icon, model name, helper text and radio control. No brand logos.
Below, a subtle note with small lock icon: “密钥仅保存在本机”.
Bottom navigation: quiet text button “上一步” left, charcoal compact button “继续” right. Below that, a small progress caption “第 2 步，共 3 步”. Use balanced vertical spacing, no illustration, no logo, no marketing slogan, no cards beyond the option rows.

## Pull Request

Page: Pull Request review center.
Use the shared app shell. Sidebar top retains “新建任务” and “搜索”. Primary navigation shows “任务”, “Pull Request” selected, “记忆”, “文件”, “自动化”. Bottom “设置”. Top connected project tabs remain, “桌面端产品” active.
Page header below tabs: title “Pull Request”; muted subtitle “查看并审阅当前项目的代码变更”. Right side outlined filter “全部状态” and charcoal compact button “在 GitHub 中打开”. One divider.
Main layout uses a 390px left list and flexible right detail, separated by one hairline.
Left heading “打开的请求 3”. Three flat rows with no floating cards:
1 selected “#42 简化工作台布局”, branch “ui/minimal-workbench”, author “林和宇”, status small green dot “检查通过”
2 “#41 优化构建缓存”, branch “perf/build-cache”, status amber dot “检查中”
3 “#39 修复设置样式”, branch “fix/settings-style”, status red dot “1 项失败”
Right detail header: “#42 简化工作台布局”, secondary “ui/minimal-workbench → main”; right actions quiet “关闭” and charcoal “审阅变更”. Under header a compact summary row “3 个文件 · +138 −36 · 12 条评论”.
Then a single clean activity feed: author avatar circle with “调整导航、标签栏和任务输入区的视觉层级。”; a small check section with two rows “单元测试 128 项” green “通过”, “类型检查” green “通过”; and a “文件变更” section listing Sidebar.tsx, Workspace.tsx, theme.css with line counts. Use spacing and hairlines, no dashboard cards, no large colored banner.

