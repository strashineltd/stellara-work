import { describe, expect, it, vi } from 'vitest';
import { resolveSessionModel, type SessionContextDependencies } from './session-context';

function createDependencies(overrides: Partial<SessionContextDependencies> = {}): SessionContextDependencies {
  return {
    getSession: () => ({
      id: 'session-1', title: 'Test', modelId: 'model-a', workDir: 'D:/session',
      createdAt: 0, updatedAt: 0, messageCount: 0,
    }),
    getProject: () => ({ id: 'project-1', name: 'Project', workDir: 'D:/project', createdAt: 0, updatedAt: 0 }),
    loadConfig: async () => ({
      schemaVersion: 1,
      activeModelId: 'model-b',
      app: {},
      models: [
        { id: 'model-a', label: 'A', baseUrl: 'https://a.example', model: 'a', workDir: 'D:/model-a', createdAt: '' },
        { id: 'model-b', label: 'B', baseUrl: 'https://b.example', model: 'b', workDir: 'D:/model-b', createdAt: '' },
      ],
    }),
    getKey: () => 'test-key',
    isDirectory: async () => true,
    ...overrides,
  };
}

describe('resolveSessionModel', () => {
  it('uses the session model and work directory instead of the global active model', async () => {
    const context = await resolveSessionModel('session-1', createDependencies());
    expect(context.id).toBe('model-a');
    expect(context.workDir).toBe('D:/session');
  });

  it('uses project then model work directory as controlled fallbacks', async () => {
    const projectFallback = await resolveSessionModel('session-1', createDependencies({
      getSession: () => ({ id: 'session-1', title: 'Test', modelId: 'model-a', workDir: 'D:/stale-session', projectId: 'project-1', createdAt: 0, updatedAt: 0, messageCount: 0 }),
    }));
    expect(projectFallback.workDir).toBe('D:/project');

    const modelFallback = await resolveSessionModel('session-1', createDependencies({
      getSession: () => ({ id: 'session-1', title: 'Test', modelId: 'model-a', createdAt: 0, updatedAt: 0, messageCount: 0 }),
    }));
    expect(modelFallback.workDir).toBe('D:/model-a');
  });

  it('rejects an invalid work directory before calling the provider', async () => {
    const isDirectory = vi.fn(async () => false);
    await expect(resolveSessionModel('session-1', createDependencies({ isDirectory })))
      .rejects.toThrow('工作目录不存在或无法访问');
    expect(isDirectory).toHaveBeenCalledWith('D:/session');
  });

  it('rejects a missing session model key', async () => {
    await expect(resolveSessionModel('session-1', createDependencies({ getKey: () => null })))
      .rejects.toThrow('没有 API key');
  });
});
