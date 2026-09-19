/**
 * instructions 拼装（两条协议共用；原先 Responses / Anthropic 格式漂移已收敛）。
 */
import type { TaskContext } from '../../context/context-hub';

export function buildInstructions(systemPrompt: string, context: Readonly<TaskContext>): string {
  let instructions = systemPrompt;

  if (context.objective) {
    instructions += `\n\n## 当前目标\n${context.objective}`;
  }
  if (context.constraints.length > 0) {
    instructions += `\n\n## 约束\n${context.constraints.map((c) => `- ${c}`).join('\n')}`;
  }
  if (context.decisions.length > 0) {
    instructions += `\n\n## 已确认的决策\n${context.decisions.map((d) => `- ${d.description}: ${d.reason}`).join('\n')}`;
  }
  if (context.plan.steps.length > 0) {
    const completedSteps = context.plan.steps.filter((s) => s.status === 'completed');
    const pendingSteps = context.plan.steps.filter((s) => s.status !== 'completed');
    if (completedSteps.length > 0) {
      instructions += `\n\n## 已完成步骤\n${completedSteps.map((s) => `- ${s.description}`).join('\n')}`;
    }
    if (pendingSteps.length > 0) {
      instructions += `\n\n## 待完成步骤\n${pendingSteps.map((s) => `- [${s.status}] ${s.description}`).join('\n')}`;
    }
  }
  if (context.workspace.unverifiedFiles.size > 0) {
    instructions += `\n\n## 未验证文件\n以下文件已修改但未验证：\n${Array.from(context.workspace.unverifiedFiles).map((f) => `- ${f}`).join('\n')}`;
  }
  if (context.compactionSummary) {
    instructions += `\n\n## 早期对话摘要（已压缩）\n${context.compactionSummary}`;
  }

  return instructions;
}
