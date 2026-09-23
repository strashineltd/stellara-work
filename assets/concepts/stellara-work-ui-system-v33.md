# Stellara Work minimal UI system v33

This package extends the accepted minimal workbench into a complete desktop application family. The concept images are visual references; application source code was not changed.

## Visual language

- Canvas: warm white `#FCFCFB`
- Sidebar: warm gray `#F3F3F1`
- Selected row: `#ECECEA`
- Primary text: charcoal `#252525`
- Secondary text: neutral gray `#7A7D82`
- Dividers: `#E5E5E2`
- Semantic accents: green for success, red for errors/removal, amber for pending checks
- Typography: SF Pro / PingFang SC style, 14px controls, 16px body, 19–24px titles
- Radius: 6–10px; shadows reserved for modal overlays
- Icons: monochrome outline, consistent 16–20px size
- No gradients, glass, glow, decorative branding, large illustrations, or sci-fi treatments

## Shared shell

- 296px fixed sidebar
- macOS traffic lights and sidebar toggle at the top
- “新建任务” and “搜索” remain the primary entry actions
- Project tabs are connected with zero gaps and shared dividers
- Tabs contain a project icon, project name, close control, and one adjacent plus segment
- No colored selection line above project tabs
- One page header row below tabs, followed by one hairline divider
- Main content uses a clear reading column or a simple two-pane layout
- Controls use charcoal as the primary action color

## Page coverage

| Screen | Asset | Purpose |
|---|---|---|
| Workbench complete state | `stellara-work-minimal-fresh-v24.png` | Conversation, completion summary, changed files, composer |
| Home / new task | `stellara-work-page-home-v25.png` | Project-aware task entry and recent actions |
| Task running | `stellara-work-page-running-v31.png` | Execution steps, light terminal output, pause/stop |
| Change review | `stellara-work-page-changes-v26.png` | File list, readable diff, keep/revert actions |
| Pull Request | `stellara-work-page-pull-request-v33.png` | Request list, checks, activity and changed files |
| Memory center | `stellara-work-page-memory-v27.png` | Search, filters, pinned and recent memories |
| File browser | `stellara-work-page-files-v28.png` | File tree and read-only code preview |
| Automation | `stellara-work-page-automation-v29.png` | Schedules, status switches and recent runs |
| Settings | `stellara-work-page-settings-v30.png` | Fixed modal, category navigation and form rows |
| First launch | `stellara-work-page-onboarding-v32.png` | Three-step onboarding and model choice |
| Overview | `stellara-work-ui-system-overview-v33.png` | Contact sheet for visual comparison |

## Additional settings panels

All settings panels reuse the same two-column modal and horizontal setting rows.

- 模型: default model, reasoning strength, execution mode, configured models, context policy
- 会话: recent sessions, individual deletion and clear-all danger zone
- 应用: theme, workspace mode, summaries, background scheduler, data and logs
- 服务器: connection status, add/edit server and connection tests
- AI 浏览器: JavaScript permission, search provider, API key and retained login sites
- 技能与 MCP: search, enable/disable, create/edit, MCP tools and approval policy
- 快捷键: grouped shortcut recording, conflict feedback and reset
- 账号: local identity, display name, identity switch and cloud sign-in

## Dialog and state rules

- New project, memory editor, automation editor and server editor use a 560–720px centered modal.
- Command palette uses a 620px search-first dialog with grouped results and keyboard hints.
- Approval requests appear inside the task stream with a concise command summary and two actions.
- Destructive confirmation uses one sentence, a neutral cancel action and one red confirmation action.
- Empty states use a small monochrome icon, a short title and one action.
- Loading states use skeleton lines or a small spinner without taking over the whole page.
- Errors remain in context as pale red rows; retry is a text action.
- Keyboard focus uses a 1px charcoal ring with 2px offset.
- Hover uses warm gray; selection uses a slightly darker warm gray.

