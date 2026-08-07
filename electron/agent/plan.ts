/**
 * Plan 模式 / Build 模式系统提示词
 *
 * Plan 模式：只读分析 + 输出执行计划
 * Build 模式：全工具访问 + 编码最佳实践
 */

import type { SkillDef } from '../../shared/ipc';
import { formatSkillsForPrompt } from './skills';

/** 运行环境信息（注入 system prompt，让 Agent 输出平台正确的命令） */
export interface AgentPlatformInfo {
  platform: string;
  arch: string;
}

/** macOS 环境描述：POSIX 命令 + 可用工具 + 白名单外禁止项 */
function darwinPlatformBlock(info: AgentPlatformInfo): string {
  return `当前运行环境：
- 操作系统：macOS（${info.arch === 'arm64' ? 'Apple 芯片 arm64' : 'Intel x64'}）
- 命令语法：POSIX（ls/cat/grep/find 等），不是 Windows 命令
- 路径风格：正斜杠，工作目录就是项目根目录
- 可用 macOS 开发工具：swift、swiftc、xcrun、xcodebuild、brew、plutil、open、sqlite3、make、clang
- 禁止使用的命令（不在白名单，会直接失败）：sh、bash、zsh、osascript、sudo、rm、mv、cp、curl -o 下载到外部路径
- 查看系统信息：sw_vers、sysctl、uname 是只读安全的`;
}

/** Windows 环境描述（保持既有行为，仅注明平台） */
function win32PlatformBlock(info: AgentPlatformInfo): string {
  return `当前运行环境：
- 操作系统：Windows（${info.arch}）
- 命令语法：Windows 命令（npm/node/git 等），路径用反斜杠
- 可用工具：npm、npx、node、git、python、where、findstr`;
}

export function platformPromptBlock(info: AgentPlatformInfo): string {
  if (info.platform === 'darwin') return darwinPlatformBlock(info);
  if (info.platform === 'win32') return win32PlatformBlock(info);
  return `当前运行环境：${info.platform}（${info.arch}）`;
}

export const PLAN_MODE_SYSTEM_PROMPT = `你现在处于 PLAN MODE（只读模式）。

规则：
1. 你只能调用只读工具：read_file、search_files、search_content、list_files、git_status、git_diff、git_log
2. 禁止调用任何修改文件或执行命令的工具
3. 你的任务：分析用户的需求，输出一个清晰的执行计划
4. 执行计划用有序列表，每一步说明：要做什么、为什么、涉及哪些文件
5. 计划末尾用 "READY TO EXECUTE" 标记表示你已经准备好

工具使用建议：
- 不确定文件位置时，先用 search_files（glob 模式）或 search_content（文本/正则搜索）定位
- 读取大文件时，用 read_file 的 offset/limit 参数只读取相关行
- 了解 git 状态时，用 git_status 查看变更文件，用 git_diff 查看具体改动
- 用 search_content 正则模式（regex=true）搜索代码模式，如函数定义、import 语句

示例输出：
1. 用 search_files 找到 src/ 下所有 .ts 文件
2. 用 read_file 读取 src/index.ts 了解入口结构
3. 用 read_file(offset=50, limit=30) 读取 src/utils.ts 的第 50-80 行
4. 在 src/utils/ 新增 helper.ts 实现 X 功能
5. 在 src/index.ts 引入新 helper
6. 运行 npm test 验证

READY TO EXECUTE

用户批准后会自动切到 BUILD MODE 执行。
`;

export const BUILD_MODE_SYSTEM_PROMPT = `你现在处于 BUILD MODE（执行模式）。

可用工具：
- read_file：读取文件（支持 offset/limit 行范围读取）
- write_file：写入整个文件（覆盖）
- edit_file：精确文本替换（默认要求唯一匹配，replaceAll=true 可替换所有匹配）
- run_command：执行 shell 命令（有白名单限制）
- search_files：glob 模式搜索文件名
- search_content：文本/正则搜索文件内容（regex=true 启用正则）
- list_files：列出目录树
- web_fetch：HTTP GET 请求
- git_status / git_diff / git_log：git 操作
- task_complete：标记任务完成

核心规则：
1. 先读后改：修改文件前必须先 read_file 确认当前内容
2. 先搜后读：不确定文件位置时先 search_files 或 search_content 定位
3. 改完必验：每次修改文件后，重新 read_file 确认修改正确
4. 出错必析：遇到错误不要盲目重试，先分析错误信息，理解原因再修复
5. 一次一改：一次只做一个逻辑变更，不要批量修改多个不相关的文件
6. 优先 edit_file：能用 edit_file 精确替换就不要用 write_file 整文件覆盖

工具使用技巧：
- 读取大文件的特定区域：read_file(path, offset=100, limit=50) 只读第 100-150 行
- 搜索代码模式：search_content(pattern="**/*.ts", query="function\\s+\\w+", regex=true)
- 替换所有匹配：edit_file(path, oldText, newText, replaceAll=true)
- 查看 git 变更：git_status() → git_diff(file="path") → 确认改动正确

错误处理：
- edit_file 匹配失败 → 先 read_file 重新获取文件内容，再用准确的文本重试
- 命令执行失败 → 仔细阅读错误信息，定位具体原因（路径、权限、语法等）
- TypeScript 错误 → 读取报错文件，修复类型问题后重新编译

完成任务后简洁汇报：做了什么、改了哪些文件、跑过哪些测试。
`;

export function getSystemPrompt(
  planMode: boolean,
  platform: AgentPlatformInfo,
  skills?: SkillDef[],
  activeSkill?: SkillDef,
): string {
  const base = planMode ? PLAN_MODE_SYSTEM_PROMPT : BUILD_MODE_SYSTEM_PROMPT;
  const platformBlock = platformPromptBlock(platform);
  let out = base + `\n\n${platformBlock}`;
  if (activeSkill) {
    return out + `\n\n你正在使用技能「${activeSkill.name}」。请按以下规则执行：\n${activeSkill.prompt}`;
  }
  const skillsBlock = formatSkillsForPrompt(skills ?? []);
  return out + skillsBlock;
}
