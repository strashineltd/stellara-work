/**
 * 验证 + 修复引导（Phase 2b）
 *
 * 在 Agent 修改文件/执行命令后注入验证提示，提高任务完成质量。
 */
import type { ChatMessage, ToolCall } from '../../shared/ipc';

/**
 * 写/编辑文件后注入重读验证 prompt。
 * 把修改过的文件路径附在消息里，提示 LLM 确认修改正确。
 */
export function injectVerificationPrompt(
  messages: ChatMessage[],
  toolCall: ToolCall,
): ChatMessage[] {
  try {
    const args = JSON.parse(toolCall.function.arguments) as { path?: string };
    if (!args.path) return messages;

    const prompt = `已修改文件 ${args.path}。请用 read_file 重新读取该文件确认修改正确。如果内容不符合预期，请立即修复。如果正确，继续下一步。`;

    return [
      ...messages,
      { role: 'system', content: prompt },
    ];
  } catch {
    return messages;
  }
}

/**
 * 命令执行失败后注入诊断引导。
 * 分析常见失败原因，给 LLM 一条 actionable 的建议。
 */
export function generateFailureGuidance(
  toolName: string,
  result: { ok: boolean; error?: string; output?: string },
): string | null {
  if (!result.error) return null;

  const error = result.error.toLowerCase();
  const output = (result.output || '').toLowerCase();
  const combined = `${error} ${output}`;

  // TypeScript 编译错误
  if (combined.includes('tsc') || combined.includes('typescript') || combined.includes('error ts')) {
    return '上次命令出现 TypeScript 编译错误。请用 read_file 查看报错涉及的文件，修复类型错误后重新测试。';
  }

  // 测试失败
  if (toolName === 'run_command' && error.includes('exit code') && !error.includes('exit code 0')) {
    return '上次命令执行失败（非零退出码）。请检查输出中的错误信息，修复后再运行。';
  }

  // 文件不存在
  if (combined.includes('enoent') || combined.includes('not found') || combined.includes('不存在')) {
    return '上次操作的目标文件不存在。请用 search_files 或 list_files 确认正确的文件路径。';
  }

  // JSON 解析失败
  if (combined.includes('json') && (combined.includes('解析') || combined.includes('parse') || combined.includes('unexpected token'))) {
    return 'JSON 解析失败。请检查文件中的引号、逗号、括号是否匹配，或用 read_file 重新读取文件确认内容。';
  }

  // 权限不足
  if (combined.includes('eacces') || combined.includes('permission denied') || combined.includes('权限')) {
    return '权限不足。请检查文件是否被其他程序占用，或以管理员身份运行。';
  }

  // 磁盘空间不足
  if (combined.includes('enospc') || combined.includes('disk full') || combined.includes('磁盘')) {
    return '磁盘空间不足。请清理磁盘空间后重试。';
  }

  // npm 错误
  if (combined.includes('npm err')) {
    return 'npm 命令执行失败。请检查 package.json 是否正确，尝试运行 npm install 安装依赖。';
  }

  // 模块未找到
  if (combined.includes('cannot find module') || combined.includes('module not found')) {
    return '找不到模块。请检查 import/require 路径是否正确，以及 node_modules 是否已安装。';
  }

  // 语法错误
  if (combined.includes('syntaxerror') || combined.includes('unexpected token') || combined.includes('语法')) {
    return '代码语法错误。请用 read_file 读取文件，检查括号、引号、分号是否匹配。';
  }

  // 端口占用
  if (combined.includes('eaddrinuse') || combined.includes('address already in use') || combined.includes('端口')) {
    return '端口被占用。请换一个端口，或用 run_command 执行 netstat/findstr 找到并关闭占用端口的进程。';
  }

  // git 错误
  if (combined.includes('git') && (combined.includes('error') || combined.includes('fatal') || combined.includes('failed'))) {
    return 'git 操作失败。请用 git_status 查看当前状态，确认分支、暂存区、工作区是否正确。';
  }

  // 匹配失败（edit_file）
  if (combined.includes('未找到要替换的文本') || combined.includes('匹配到')) {
    return 'edit_file 匹配失败。请先用 read_file 读取文件获取准确内容，确保 oldText 精确匹配（含缩进和换行）。如果有多处匹配，可用 replaceAll=true。';
  }

  // 通用兜底：提取错误前 200 字符
  if (result.error.length > 10) {
    return `上次操作失败：${result.error.slice(0, 200)}。请分析错误原因，尝试修复后重试。`;
  }

  return null;
}
