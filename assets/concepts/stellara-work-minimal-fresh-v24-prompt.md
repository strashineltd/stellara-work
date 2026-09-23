# Stellara Work — minimal redesign v24

Mode: built-in ImageGen. New image generated from scratch, with no previous mockup supplied as an image reference.

Output: `stellara-work-minimal-fresh-v24.png`

This is a UI concept image; no application source code was changed.

## Final generation prompt

Use case: ui-mockup
Asset type: one polished desktop application UI design, full-screen flat screenshot.

Primary request: Design Stellara Work completely from scratch as an exceptionally clean, minimal desktop AI coding workspace, inspired by the visual restraint and conversation-centered workflow of Codex. Create a genuinely fresh composition. The result must look like elegant shipping software with thoughtfully designed controls.

Output: one 2560 x 1600 landscape raster screenshot, 16:10, straight-on, edge-to-edge app interface, no surrounding mockup. Render at retina clarity with perfectly legible Simplified Chinese, sharp thin lines, carefully drawn icons and clean antialiasing. Aim for a 1600 x 1000 logical-pixel layout at higher pixel density.

Visual system: warm white main canvas #FCFCFB, very pale warm gray sidebar #F3F3F1, charcoal #252525 text, neutral gray secondary labels, fine #E5E5E2 borders. Predominantly monochrome. Only small muted green completion checkmarks use accent color. Flat surfaces, subtle 6–10px corners. Typography resembles SF Pro with PingFang SC: ordinary UI text 14px, body 16px, title 19px logical size. Moderate weight, generous line-height. This is a refined working application, not an empty wireframe.

Layout:
- Left sidebar occupies 244 logical pixels. At the top are small macOS traffic lights and a sidebar toggle icon. Below, two simple unboxed icon-and-text actions “新建任务” and “搜索”. A small gray “任务” section heading introduces a flat list of three task titles: “重新设计工作台” (selected in a low-contrast warm gray rounded row), “优化构建性能”, and “修复设置样式”. No tree connectors, project subheadings, timestamps, large document icons, blue selection stripes or badges. Compact “自动化” above bottom-aligned “设置”, each with a small monochrome outline icon. No brand logo or app wordmark.
- Across the top of the main workspace, a 42px-high quiet browser-style PROJECT tab strip with exactly two adjoining tabs, each with a monochrome project icon, project name and small close control. Labels “桌面端产品” and “核心引擎”. Zero gaps between tabs; a single thin shared divider. Active tab white, inactive tab pale gray. Gentle rounded outer contour, no colored selection line anywhere on this tab strip. A small plus sits immediately after the tabs. These are project tabs, not duplicate task titles.
- Under the tab strip, one 50px-high compact task header. Left title “重新设计工作台”. On the right, subtle unboxed branch icon and “main”, then the one small quiet outlined action “查看更改 3” and an ellipsis. One fine divider under the header. No extra secondary navigation row, no giant repeated project title, no repository path.
- Main reading column about 800 logical pixels wide, horizontally centered in the space to the right of the sidebar. Start conversation around y=178. The content column and bottom composer share exactly the same left and right edges.
- User message is a compact pale warm-gray rounded block aligned toward the right edge of the reading column, about 550px wide. It contains just “帮我重新设计工作台，让界面更清晰、更专注。”
- Assistant response below, aligned left, with a tiny quiet label “Stellara” and a single paragraph: “我会整理导航与对话区域，让常用操作更直接。”
- Next, one compact collapsed execution summary with a small muted-green check, exact text “已完成 4 项操作” and a small chevron. No large tool cards, no expanded log, no code diff, no activity timeline. Below it, a very small muted line “修改 3 个文件 · 测试通过”.
- Then the result: a modest semibold “界面已更新”, and two short neutral bullet lines: “统一导航与标签样式” and “简化任务信息与操作入口”.
- A clean unboxed change list underneath, separated only by spacing: three small file icons, filenames “Sidebar.tsx”, “Workspace.tsx”, “theme.css”, and quiet + / - line counts right-aligned. This gives concrete work context without a large colored diff. Do not place it in a card.
- Small gray copy and retry icons below the result.
- The bottom composer is a restrained rounded rectangle at y≈810, aligned to the reading column, height approximately 116px with a fine neutral border and white fill. Placeholder “描述任务，或输入 / 使用技能”. The bottom row has a small plus, unboxed selectors “GPT-5” and “自动执行”, and on the far right a 30px charcoal circle containing a white up-arrow send icon. Beneath it, tiny muted environment text “本地” with a small status dot.
- Use the remaining vertical space naturally as breathing room. The conversation should occupy the upper-middle area, not center like a welcome landing page.

Constraints: render the supplied Chinese text accurately, with correct spacing and alignment. Only one active task and one active project tab. No sci-fi, neon, gradients, glass, glow, wallpaper, illustrations, decorative branding, giant titles, dashboard tiles, excessive borders, dramatic shadows, floating outer app window, bright-blue interface accents, dense tool logs, extra navigation levels, or tiny blurry text. Preserve calm visual rhythm and sharp readable typography.

