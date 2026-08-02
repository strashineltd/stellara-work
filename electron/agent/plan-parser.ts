/**
 * 结构化计划解析器
 *
 * Phase 2: 从 LLM 的 plan mode 文本输出中提取编号步骤，
 * 检测 READY TO EXECUTE 标记，格式化进度上下文。
 */
import type { ChatStreamEvent } from '../../shared/ipc';

export interface PlanStep {
  index: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface Plan {
  steps: PlanStep[];
  rawPlan: string;
  readyToExecute: boolean;
}

/**
 * 从 LLM 的 plan mode 输出中提取编号步骤。
 * 匹配格式：1. xxx / 1) xxx / Step 1: xxx
 */
export function parsePlanFromContent(content: string): Plan | null {
  const lines = content.split('\n');
  const steps: PlanStep[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 匹配：1. do something / 1) do something
    let m = trimmed.match(/^\s*(\d+)[.)]\s+(.+)/);
    if (!m) {
      // 匹配：Step 1: do something
      m = trimmed.match(/^Step\s+(\d+)[\s:]+(.+)/i);
    }
    if (!m) continue;

    const index = parseInt(m[1]!, 10);
    const description = m[2]!.trim();
    steps.push({ index, description, status: 'pending' });
  }

  if (steps.length === 0) return null;

  return {
    steps,
    rawPlan: content,
    readyToExecute: detectReadyToExecute(content),
  };
}

/**
 * 检测 LLM 是否输出了 READY TO EXECUTE 标记
 */
export function detectReadyToExecute(content: string): boolean {
  return /READY\s+TO\s+EXECUTE/i.test(content);
}

/**
 * 生成 "执行 Step X of N: description" 上下文，注入到 system message
 */
export function formatPlanProgress(plan: Plan): string {
  const pending = plan.steps.filter((s) => s.status === 'pending');
  const inProgress = plan.steps.filter((s) => s.status === 'in_progress');
  const completed = plan.steps.filter((s) => s.status === 'completed');

  const lines: string[] = [];
  lines.push('当前计划进度：');
  for (const step of plan.steps) {
    const icon = step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '🔄' : '○';
    lines.push(`  ${icon} Step ${step.index}: ${step.description}`);
  }
  const remaining = pending.length + inProgress.length;
  if (remaining > 0) {
    const next = pending[0] ?? inProgress[0];
    if (next) lines.push(`下一个步骤：Step ${next.index} — ${next.description}`);
  } else if (completed.length === plan.steps.length) {
    lines.push('所有步骤已完成。');
  }
  return lines.join('\n');
}

/**
 * 尝试匹配一个工具调用到计划步骤（启发式匹配）。
 * 用于标记步骤状态变化。
 *
 * 匹配策略（按优先级）：
 * 1. 路径精确匹配：工具参数中的路径出现在步骤描述中
 * 2. 命令精确匹配：工具参数中的命令出现在步骤描述中
 * 3. 工具类型 + 关键词语义匹配
 * 4. 回退：仅对写入/执行类工具返回第一个 pending 步骤（只读工具不回退，避免误标）
 */
export function tryMatchToolToPlanStep(
  plan: Plan,
  toolName: string,
  args: Record<string, unknown>,
): PlanStep | null {
  const path = typeof args.path === 'string' ? args.path.toLowerCase() : '';
  const command = typeof args.command === 'string' ? args.command.toLowerCase() : '';

  for (const step of plan.steps) {
    if (step.status !== 'pending') continue; // 只匹配 pending 步骤
    const desc = step.description.toLowerCase();
    // 文件名匹配
    if (path && desc.includes(path)) return step;
    // 命令匹配
    if (command && desc.includes(command)) return step;
    // tool 类型 + 关键词匹配
    if (toolName === 'read_file' && (desc.includes('读') || desc.includes('阅读') || desc.includes('read') || desc.includes('查看') || desc.includes('分析'))) return step;
    if ((toolName === 'write_file' || toolName === 'edit_file') && (desc.includes('写') || desc.includes('改') || desc.includes('修改') || desc.includes('编辑') || desc.includes('创建') || desc.includes('实现') || desc.includes('添加'))) return step;
    if (toolName === 'run_command' && (desc.includes('测试') || desc.includes('运行') || desc.includes('构建') || desc.includes('安装') || desc.includes('test') || desc.includes('build') || desc.includes('run') || desc.includes('install'))) return step;
    if (toolName === 'search_content' && (desc.includes('搜索') || desc.includes('查找') || desc.includes('search'))) return step;
  }

  // 回退：仅对写入/执行类工具返回第一个 pending 步骤
  const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);
  if (WRITE_TOOLS.has(toolName)) {
    return plan.steps.find((s) => s.status === 'pending') ?? null;
  }
  return null;
}

/**
 * 把 plan 步骤转为 ChatStreamEvent（前端用于渲染 workspace panel）
 */
export function planToStreamEvent(plan: Plan): ChatStreamEvent {
  return {
    type: 'plan',
    plan: plan.steps.map((s) => s.description),
  };
}
