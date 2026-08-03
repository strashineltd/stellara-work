import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTestConnection, mockUpsertModel, mockSetKey } = vi.hoisted(() => ({
  mockTestConnection: vi.fn(),
  mockUpsertModel: vi.fn(),
  mockSetKey: vi.fn(),
}));

vi.mock('../llm/openai-compat', () => ({
  OpenAICompatClient: vi.fn(function () {
    return { testConnection: mockTestConnection };
  }),
}));
vi.mock('../llm/presets', () => ({
  findPreset: vi.fn().mockReturnValue({ id: 'custom', label: 'x', baseUrl: 'https://x', model: 'm', isCustom: true }),
}));
vi.mock('./config-v2', () => ({ upsertModel: mockUpsertModel }));
vi.mock('./secrets', () => ({ setKey: mockSetKey }));

import { configureModel } from './model-configure';
import type { ModelConfig } from '../../shared/ipc';

function cfg(over: Partial<ModelConfig> = {}): ModelConfig {
  return { id: 'custom', label: 'Custom', baseUrl: 'https://x', model: 'm', isCustom: true, apiKey: 'sk-new', ...over };
}

describe('configureModel', () => {
  beforeEach(() => {
    mockTestConnection.mockReset();
    mockUpsertModel.mockReset();
    mockSetKey.mockReset();
  });

  it('tests connection first when a new key is provided; rejects without saving on failure', async () => {
    mockTestConnection.mockResolvedValue({ ok: false, error: '401 unauthorized' });
    const r = await configureModel(cfg());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('连接测试未通过');
    expect(mockUpsertModel).not.toHaveBeenCalled();
    expect(mockSetKey).not.toHaveBeenCalled();
  });

  it('saves config and key when the connection test passes', async () => {
    mockTestConnection.mockResolvedValue({ ok: true });
    const r = await configureModel(cfg());
    expect(r.ok).toBe(true);
    expect(mockUpsertModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'custom' }));
    expect(mockSetKey).toHaveBeenCalledWith('custom', 'sk-new');
  });

  it('skips the connection test when no key is provided (preserve existing key)', async () => {
    const r = await configureModel(cfg({ apiKey: '' }));
    expect(mockTestConnection).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(mockUpsertModel).toHaveBeenCalled();
    expect(mockSetKey).not.toHaveBeenCalled();
  });
});
