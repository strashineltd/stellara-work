import { describe, expect, it, vi } from 'vitest';
import { ServerChatBridge } from './chat-bridge';

function makeBridge(opts: { client?: Record<string, unknown> } = {}) {
  const emitted: Array<{ streamId: string; type: string; payload: unknown }> = [];
  const client = {
    promptAsync: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    respondPermission: vi.fn(async () => {}),
    ...opts.client,
  };
  const sessions: Record<string, Record<string, unknown>> = {
    s1: { runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' },
  };
  const bridge = new ServerChatBridge({
    getSession: (id) => sessions[id],
    getClient: () => client as never,
    emit: (streamId, event) => emitted.push({ streamId, type: event.type, payload: event }),
    newStreamId: () => 'stream-1',
  });
  return { bridge, client, emitted };
}

const idle = (sessionID = 'ses_1') => ({ type: 'session.idle', properties: { sessionID } }) as never;
const textPart = (text: string, sessionID = 'ses_1') =>
  ({
    type: 'message.part.updated',
    properties: { part: { type: 'text', id: 'p1', sessionID, messageID: 'm1', text } },
  }) as never;
const permission = (sessionID = 'ses_1') =>
  ({
    type: 'permission.updated',
    properties: { id: 'perm_1', sessionID, title: 'Bash', metadata: {} },
  }) as never;

describe('ServerChatBridge', () => {
  it('starts a prompt and routes events to the stream', async () => {
    const { bridge, client, emitted } = makeBridge();
    const { streamId } = await bridge.start('s1', '你好', { providerID: 'anthropic', modelID: 'claude' }, 'build');
    expect(streamId).toBe('stream-1');
    expect(client.promptAsync).toHaveBeenCalledWith('ses_1', {
      parts: [{ type: 'text', text: '你好' }],
      model: { providerID: 'anthropic', modelID: 'claude' },
      agent: 'build',
    });
    bridge.handleEvent('srv-1', {
      type: 'message.part.updated',
      properties: { part: { type: 'text', id: 'p1', sessionID: 'ses_1', messageID: 'm1', text: '你' } },
    } as never);
    expect(emitted).toEqual([{ streamId: 'stream-1', type: 'content', payload: { type: 'content', content: '你' } }]);
  });

  it('ends the stream on session.idle', async () => {
    const { bridge, emitted } = makeBridge();
    await bridge.start('s1', 'hi');
    bridge.handleEvent('srv-1', { type: 'session.idle', properties: { sessionID: 'ses_1' } } as never);
    expect(emitted.at(-1)).toMatchObject({ streamId: 'stream-1', type: 'done' });
  });

  it('registers permission approvals and responds once', async () => {
    const { bridge, emitted, client } = makeBridge();
    await bridge.start('s1', 'hi');
    bridge.handleEvent('srv-1', {
      type: 'permission.updated',
      properties: { id: 'perm_1', sessionID: 'ses_1', title: 'Bash', metadata: {} },
    } as never);
    const approval = emitted.find((e) => e.type === 'approval_required');
    expect(approval).toBeTruthy();
    const approvalId = (approval!.payload as { approval: { id: string } }).approval.id;
    await expect(bridge.respondApproval(approvalId, true)).resolves.toBe(true);
    expect(client.respondPermission).toHaveBeenCalledWith('ses_1', 'perm_1', 'once');
    // 已响应的 approval 再次响应：未命中，不转发远端
    await expect(bridge.respondApproval(approvalId, false)).resolves.toBe(false);
    expect(client.respondPermission).toHaveBeenCalledTimes(1);
    // 同一 permissionID 重新挂起（用户拒绝）：转发 reject
    bridge.handleEvent('srv-1', permission());
    await expect(bridge.respondApproval(approvalId, false)).resolves.toBe(true);
    expect(client.respondPermission).toHaveBeenLastCalledWith('ses_1', 'perm_1', 'reject');
  });

  it('aborts the remote session by stream id', async () => {
    const { bridge, client } = makeBridge();
    await bridge.start('s1', 'hi');
    await bridge.abort('stream-1');
    expect(client.abort).toHaveBeenCalledWith('ses_1');
  });

  it('rejects unknown or local sessions', async () => {
    const { bridge, client } = makeBridge();
    await expect(bridge.start('missing', 'hi')).rejects.toThrow('不是远端会话');
    await expect(
      new ServerChatBridge({
        getSession: () => ({ runtime: 'local' }),
        getClient: () => client as never,
        emit: vi.fn(),
        newStreamId: () => 'stream-1',
      }).start('s1', 'hi'),
    ).rejects.toThrow('不是远端会话');
  });

  it('rejects when the server client is unavailable', async () => {
    const bridge = new ServerChatBridge({
      getSession: () => ({ runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' }),
      getClient: () => null,
      emit: vi.fn(),
      newStreamId: () => 'stream-1',
    });
    await expect(bridge.start('s1', 'hi')).rejects.toThrow('服务器未连接');
  });

  it('cleans up the stream when promptAsync fails', async () => {
    const { bridge, emitted } = makeBridge({
      client: {
        promptAsync: vi.fn(async () => {
          throw new Error('prompt boom');
        }),
      },
    });
    await expect(bridge.start('s1', 'hi')).rejects.toThrow('prompt boom');
    bridge.handleEvent('srv-1', idle());
    expect(emitted).toEqual([]);
  });

  it('ignores events with no active stream or a foreign session', async () => {
    const { bridge, emitted } = makeBridge();
    bridge.handleEvent('srv-1', textPart('你'));
    expect(emitted).toEqual([]);
    await bridge.start('s1', 'hi');
    bridge.handleEvent('srv-1', textPart('你', 'ses_other'));
    expect(emitted).toEqual([]);
  });

  it('stops emitting after the stream ends', async () => {
    const { bridge, emitted } = makeBridge();
    await bridge.start('s1', 'hi');
    bridge.handleEvent('srv-1', idle());
    const count = emitted.length;
    bridge.handleEvent('srv-1', textPart('好'));
    expect(emitted).toHaveLength(count);
  });

  it('drops approvals when the stream terminates', async () => {
    const { bridge, emitted } = makeBridge();
    await bridge.start('s1', 'hi');
    bridge.handleEvent('srv-1', permission());
    const approvalId = (emitted.find((e) => e.type === 'approval_required')!.payload as { approval: { id: string } })
      .approval.id;
    bridge.handleEvent('srv-1', idle());
    await expect(bridge.respondApproval(approvalId, true)).resolves.toBe(false);
  });

  it('responds false for unknown approvals and no-ops unknown aborts', async () => {
    const { bridge, client } = makeBridge();
    await expect(bridge.respondApproval('nope', true)).resolves.toBe(false);
    await expect(bridge.abort('nope')).resolves.toBeUndefined();
    expect(client.abort).not.toHaveBeenCalled();
  });
});
