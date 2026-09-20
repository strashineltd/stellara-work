import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextHub } from '../../context/context-hub';
import { executeToolCall } from './tool-pipeline';
import type { ToolExecutionContext } from '../../../shared/ipc';

const { mockInvokeTool } = vi.hoisted(() => ({ mockInvokeTool: vi.fn() }));
vi.mock('../tools', () => ({ invokeTool: mockInvokeTool }));

const context: ToolExecutionContext = {
  sessionId: 'vp-1',
  agentId: 'main',
  contextRevision: 0,
  workspaceRevision: 0,
  toolCallId: 'tc-1',
};

function commandResult(command: string, exitCode: number): unknown {
  return {
    ok: exitCode === 0,
    output: exitCode === 0 ? 'ok' : 'boom',
    error: exitCode === 0 ? undefined : 'Exit code 1',
    meta: { kind: 'command', command, stdout: exitCode === 0 ? 'ok' : '', stderr: '', exitCode, durationMs: 5 },
  };
}

async function hubWithUnverifiedFile(): Promise<ContextHub> {
  const hub = new ContextHub('vp-1', '/tmp', 100_000, 16_384, { persist: false });
  await hub.commitEvent('file_modified', { filePath: 'a.txt', agentId: 'main' });
  return hub;
}

describe('executeToolCall 命令验证分级', () => {
  beforeEach(() => {
    mockInvokeTool.mockReset();
  });

  it('验证类命令成功：按分类清理未验证文件并记录对应证据', async () => {
    mockInvokeTool.mockResolvedValue(commandResult('npm test', 0));
    const hub = await hubWithUnverifiedFile();
    expect(hub.getUnverifiedFiles()).toEqual(['a.txt']);

    await executeToolCall({
      hub, cwd: '/tmp', name: 'run_command', args: { command: 'npm test' }, context,
    });

    expect(hub.getUnverifiedFiles()).toEqual([]);
    expect(hub.getVerificationEvidence().some((e) => e.kind === 'test' && e.ok)).toBe(true);
  });

  it('非验证命令成功：不清理未验证文件，也不产生验证类证据', async () => {
    mockInvokeTool.mockResolvedValue(commandResult('git status', 0));
    const hub = await hubWithUnverifiedFile();

    await executeToolCall({
      hub, cwd: '/tmp', name: 'run_command', args: { command: 'git status' }, context,
    });

    expect(hub.getUnverifiedFiles()).toEqual(['a.txt']);
    const verificationKinds = hub.getVerificationEvidence().map((e) => e.kind);
    expect(verificationKinds).not.toContain('test');
    expect(verificationKinds).not.toContain('build');
    expect(verificationKinds).not.toContain('typecheck');
  });

  it('验证类命令失败：不清理未验证文件', async () => {
    mockInvokeTool.mockResolvedValue(commandResult('npm test', 1));
    const hub = await hubWithUnverifiedFile();

    await executeToolCall({
      hub, cwd: '/tmp', name: 'run_command', args: { command: 'npm test' }, context,
    });

    expect(hub.getUnverifiedFiles()).toEqual(['a.txt']);
  });
});
