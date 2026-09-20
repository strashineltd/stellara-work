import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextHub } from '../../context/context-hub';
import { executeToolCall } from './tool-pipeline';
import type { ToolExecutionContext } from '../../../shared/ipc';

let workDir = '';
const baseContext: ToolExecutionContext = {
  sessionId: 'pipe-session',
  agentId: 'main',
  contextRevision: 0,
  workspaceRevision: 0,
  toolCallId: 'tc-1',
};

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-pipe-'));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

function makeHub(): ContextHub {
  return new ContextHub('pipe-session', workDir, 256_000, 16_384, { persist: false });
}

describe('executeToolCall', () => {
  it('超大文件读取：hub 存截断 stub，raw 返回完整输出', async () => {
    const content = Array.from({ length: 120_000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 95))).join('');
    await fs.writeFile(path.join(workDir, 'big.txt'), content);
    const hub = makeHub();

    const { outputText, raw } = await executeToolCall({
      hub, cwd: workDir, name: 'read_file', args: { path: 'big.txt' }, context: baseContext,
    });

    expect(raw.ok).toBe(true);
    expect(raw.output.length).toBe(content.length);
    const capped = JSON.parse(outputText) as { truncation?: { kind?: string } };
    expect(capped.truncation?.kind).toBe('read_file');
  });

  it('编辑文件：记录 modified/unverified 与完成事件', async () => {
    const hub = makeHub();
    const { raw } = await executeToolCall({
      hub, cwd: workDir, name: 'write_file', args: { path: 'a.txt', content: 'hello' },
      context: { ...baseContext, toolCallId: 'tc-2' },
    });

    expect(raw.ok).toBe(true);
    expect(hub.getContext().workspace.modifiedFiles.size).toBe(1);
    expect(hub.getUnverifiedFiles()).toHaveLength(1);
    expect(hub.getContext().tools.completed.some((t) => t.id === 'tc-2' && t.status === 'completed')).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('非验证命令成功：不清理未验证标记', async () => {
    const hub = makeHub();
    await executeToolCall({
      hub, cwd: workDir, name: 'write_file', args: { path: 'a.txt', content: 'x' },
      context: { ...baseContext, toolCallId: 'tc-a' },
    });
    expect(hub.getUnverifiedFiles()).toHaveLength(1);

    const { raw } = await executeToolCall({
      hub, cwd: workDir, name: 'run_command', args: { command: 'true' },
      context: { ...baseContext, toolCallId: 'tc-b' },
    });

    expect(raw.meta?.kind).toBe('command');
    expect(hub.getUnverifiedFiles()).toHaveLength(1);
  });

  it('read_file 成功：提交 file_read 事件（读后复核通道）', async () => {
    await fs.writeFile(path.join(workDir, 'note.txt'), 'hello');
    const hub = makeHub();
    const seen: string[] = [];
    hub.onEvent((event) => seen.push(event.event));

    await executeToolCall({
      hub, cwd: workDir, name: 'read_file', args: { path: 'note.txt' }, context: baseContext,
    });

    expect(seen).toContain('file_read');
  });

  it('匹配到计划步骤且工具成功时推进为 completed', async () => {
    const hub = makeHub();
    await hub.commitEvent('plan_created', {
      objective: 'o', constraints: [],
      steps: [{ id: 'step-1', description: '修改 a.txt', status: 'in_progress', relatedFiles: [], requiredVerification: [], evidenceIds: [] }],
    });

    await executeToolCall({
      hub, cwd: workDir, name: 'write_file', args: { path: 'a.txt', content: 'x' },
      matchedPlanStepId: 'step-1', context: { ...baseContext, toolCallId: 'tc-c' },
    });

    expect(hub.getContext().plan.steps[0]!.status).toBe('completed');
  });
});
