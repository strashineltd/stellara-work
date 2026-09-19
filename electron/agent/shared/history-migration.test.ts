import { describe, expect, it } from 'vitest';
import { ContextHub } from '../../context/context-hub';
import { migrateHistoryToHub } from './history-migration';

describe('migrateHistoryToHub', () => {
  it('迁移 user/assistant/tool_calls/tool 输出', () => {
    const hub = new ContextHub('mig-1', '/tmp', 100_000, 16_384, { persist: false });

    migrateHistoryToHub(hub, [
      { role: 'user', content: '问题' },
      {
        role: 'assistant',
        content: '我来跑命令',
        tool_calls: [{ id: 'call-1', function: { name: 'run_command', arguments: '{"command":"true"}' } }],
      },
      { role: 'tool', content: 'exit 0', tool_call_id: 'call-1' },
    ]);

    expect(hub.getResponseItems().map((item) => item.type)).toEqual([
      'message',
      'message',
      'function_call',
      'function_call_output',
    ]);
    const output = hub.getResponseItems()[3]!;
    expect(output.type === 'function_call_output' && output.call_id).toBe('call-1');
  });

  it('hub 非空时不迁移', () => {
    const hub = new ContextHub('mig-2', '/tmp', 100_000, 16_384, { persist: false });
    hub.addResponseItem({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '已有' }], status: 'completed' });

    migrateHistoryToHub(hub, [{ role: 'user', content: '旧历史' }]);

    expect(hub.getResponseItems()).toHaveLength(1);
  });

  it('空历史是 no-op', () => {
    const hub = new ContextHub('mig-3', '/tmp', 100_000, 16_384, { persist: false });
    migrateHistoryToHub(hub, undefined);
    expect(hub.getResponseItems()).toHaveLength(0);
  });
});
