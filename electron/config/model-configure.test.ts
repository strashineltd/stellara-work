import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTestConnection, mockUpsertModel, mockSetKey, mockLoadConfig, mockSaveConfig } = vi.hoisted(() => ({
  mockTestConnection: vi.fn(),
  mockUpsertModel: vi.fn(),
  mockSetKey: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
}));

vi.mock('../llm/client-factory', () => ({ testModelConnection: mockTestConnection }));
vi.mock('../llm/presets', () => ({
  findPreset: vi.fn().mockReturnValue({ id: 'custom', label: 'x', baseUrl: 'https://x', model: 'm', isCustom: true }),
}));
vi.mock('./config-v2', () => ({
  upsertModel: mockUpsertModel,
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
}));
vi.mock('./secrets', () => ({ setKey: mockSetKey }));

import { configureModel, updateModelWorkDir } from './model-configure';
import { grantWorkDir, _resetGrantedForTests } from '../security/workdir-grants';
import type { ModelConfig } from '../../shared/ipc';

const GRANTED_DIR = '/granted/work';
const UNGRANTED_DIR = '/ungranted/work';

function cfg(over: Partial<ModelConfig> = {}): ModelConfig {
  return { id: 'custom', label: 'Custom', baseUrl: 'https://x', model: 'm', wireApi: 'responses', isCustom: true, apiKey: 'sk-new', ...over };
}

describe('configureModel', () => {
  beforeEach(() => {
    mockTestConnection.mockReset();
    mockUpsertModel.mockReset();
    mockSetKey.mockReset();
    mockLoadConfig.mockReset();
    mockSaveConfig.mockReset();
    _resetGrantedForTests();
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

  it('rejects an ungranted workDir without testing or saving', async () => {
    mockTestConnection.mockResolvedValue({ ok: true });
    const r = await configureModel(cfg({ workDir: UNGRANTED_DIR }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('工作目录未经选择器授权，请重新选择');
    expect(mockTestConnection).not.toHaveBeenCalled();
    expect(mockUpsertModel).not.toHaveBeenCalled();
    expect(mockSetKey).not.toHaveBeenCalled();
  });

  it('rejects a non-string workDir before checking grants or persisting', async () => {
    mockTestConnection.mockResolvedValue({ ok: true });
    const r = await configureModel(cfg({ workDir: { evil: true } as unknown as string }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('workDir');
    expect(mockTestConnection).not.toHaveBeenCalled();
    expect(mockUpsertModel).not.toHaveBeenCalled();
    expect(mockSetKey).not.toHaveBeenCalled();
  });

  it('accepts a workDir granted by the native picker', async () => {
    await grantWorkDir(GRANTED_DIR);
    mockTestConnection.mockResolvedValue({ ok: true });
    const r = await configureModel(cfg({ workDir: GRANTED_DIR }));
    expect(r.ok).toBe(true);
    expect(mockUpsertModel).toHaveBeenCalledWith(expect.objectContaining({ workDir: GRANTED_DIR }));
  });
});

describe('updateModelWorkDir', () => {
  beforeEach(() => {
    mockLoadConfig.mockReset();
    mockSaveConfig.mockReset();
    _resetGrantedForTests();
  });

  it('rejects an ungranted workDir and does not persist', async () => {
    await expect(updateModelWorkDir('custom', UNGRANTED_DIR)).rejects.toThrow('工作目录未经选择器授权，请重新选择');
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('persists a granted workDir on the target model', async () => {
    await grantWorkDir(GRANTED_DIR);
    mockLoadConfig.mockResolvedValue({
      activeModelId: 'custom',
      models: [{ id: 'custom', label: 'x', baseUrl: 'https://x', model: 'm', createdAt: 't', workDir: '/old' }],
      app: {},
      mcpServers: [],
      schemaVersion: 1,
    });
    await updateModelWorkDir('custom', GRANTED_DIR);
    expect(mockSaveConfig).toHaveBeenCalledOnce();
    const saved = mockSaveConfig.mock.calls[0]![0] as { models: Array<{ workDir?: string }> };
    expect(saved.models[0]!.workDir).toBe(GRANTED_DIR);
  });

  it('rejects unknown model ids even for a granted path', async () => {
    await grantWorkDir(GRANTED_DIR);
    mockLoadConfig.mockResolvedValue({ activeModelId: null, models: [], app: {}, mcpServers: [], schemaVersion: 1 });
    await expect(updateModelWorkDir('missing', GRANTED_DIR)).rejects.toThrow('Model 不存在');
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
});
