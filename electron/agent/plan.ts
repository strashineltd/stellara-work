/**
 * Plan 模式
 *
 * 进入 plan 模式后，agent：
 * 1. 只能调用只读工具（read_file, search_files）
 * 2. 不会修改任何文件
 * 3. 给出明确的执行计划（步骤列表）
 * 4. 等用户批准 → 切到 build 模式
 *
 * 这样在动文件前给用户一个"审核窗口"。
 */

export const PLAN_MODE_SYSTEM_PROMPT = `你现在处于 PLAN MODE（只读模式）。

规则：
1. 你只能调用只读工具：read_file、search_files
2. 禁止调用任何修改文件或执行命令的工具
3. 你的任务：分析用户的需求，输出一个清晰的执行计划
4. 执行计划用有序列表，每一步说明：要做什么、为什么、涉及哪些文件
5. 计划末尾用 "READY TO EXECUTE" 标记表示你已经准备好

示例输出：
1. 读取 src/index.ts 了解入口结构
2. 读取 package.json 了解依赖
3. 在 src/utils/ 新增 helper.ts 实现 X 功能
4. 在 src/index.ts 引入新 helper
5. 运行 npm test 验证

READY TO EXECUTE

用户批准后会自动切到 BUILD MODE 执行。
`;

export const BUILD_MODE_SYSTEM_PROMPT = `你现在处于 BUILD MODE（执行模式）。

规则：
1. 你可以调用所有工具：read_file、write_file、edit_file、run_command、search_files
2. 危险操作（写文件、shell）会走用户批准流程
3. 完成任务后简洁汇报：做了什么、改了哪些文件、跑过哪些测试
4. 如果遇到错误，自己尝试修复（最多 retry 2 次），不要无脑重试

工作目录是你的工作目录，所有相对路径都基于此。
`;

export function getSystemPrompt(planMode: boolean): string {
  return planMode ? PLAN_MODE_SYSTEM_PROMPT : BUILD_MODE_SYSTEM_PROMPT;
}
