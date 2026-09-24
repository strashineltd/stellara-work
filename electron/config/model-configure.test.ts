import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTestConnection, mockUpsertModel, mockSetKey, mockGetKey, mockLoadConfig, mockSaveConfig } = vi.hoisted(() => ({
  mockTestConnection: vi.fn(),
  mockUpsertModel: vi.fn(),
  mockSetKey: vi.fn(),
  mockGetKey: vi.fn(),
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
vi.mock('./secrets', () => ({ setKey: mockSetKey, getKey: mockGetKey }));

import { configureModel, normalizeBaseUrl, updateModelWorkDir } from './model-configure';
import { grantWorkDir, _resetGrantedForTests } from '../security/workdir-grants';
import type { ModelConfig } from '../../shared/ipc';

const GRANTED_DIR = '/granted/work';
const UNGRANTED_DIR = '/ungranted/work';

function cfg(over: Partial<ModelConfig> = {}): ModelConfig {
  return { id: 'custom', label: 'Custom', baseUrl: 'https://x', model: 'm', wireApi: 'responses', isCustom: true, apiKey: 'sk-new', ...over };
}

function storedConfig(baseUrl: string) {
  return {
    activeModelId: 'custom',
    models: [{ id: 'custom', label: 'Custom', baseUrl, model: 'm', createdAt: 't' }],
    app: {},
    mcpServers: [],
    schemaVersion: 1,
  };
}

describe('configureModel', () => {
  beforeEach(() => {
    mockTestConnection.mockReset();
    mockUpsertModel.mockReset();
    mockSetKey.mockReset();
    mockGetKey.mockReset().mockReturnValue(null);
    mockLoadConfig.mockReset().mockResolvedValue(storedConfig(''));
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

  it('rejects a baseUrl change without a new apiKey (stored key must not be re-pointed)', async () => {
    mockGetKey.mockReturnValue('sk-old');
    mockLoadConfig.mockResolvedValue(storedConfig('https://api.deepseek.com'));
    const r = await configureModel(cfg({ apiKey: '', baseUrl: 'https://evil.example' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('更改服务器地址需要重新输入 API Key');
    expect(r.errorKind).toBe('key_required');
    expect(mockUpsertModel).not.toHaveBeenCalled();
    expect(mockSetKey).not.toHaveBeenCalled();
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  it('accepts a baseUrl change when a new apiKey is provided', async () => {
    mockGetKey.mockReturnValue('sk-old');
    mockLoadConfig.mockResolvedValue(storedConfig('https://api.deepseek.com'));
    mockTestConnection.mockResolvedValue({ ok: true });
    const r = await configureModel(cfg({ apiKey: 'sk-new', baseUrl: 'https://new.example' }));
    expect(r.ok).toBe(true);
    expect(mockSetKey).toHaveBeenCalledWith('custom', 'sk-new');
    expect(mockUpsertModel).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://new.example' }));
  });

  it('writes the key before persisting the new baseUrl (H8 ordering)', async () => {
    mockGetKey.mockReturnValue(null);
    mockTestConnection.mockResolvedValue({ ok: true });
    const r = await configureModel(cfg({ apiKey: 'sk-new', baseUrl: 'https://new.example' }));
    expect(r.ok).toBe(true);
    expect(mockSetKey).toHaveBeenCalledWith('custom', 'sk-new');
    expect(mockUpsertModel).toHaveBeenCalled();
    expect(mockSetKey.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpsertModel.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps key/baseUrl consistent when the key write fails (H8 ordering)', async () => {
    mockGetKey.mockReturnValue('sk-old');
    mockLoadConfig.mockResolvedValue(storedConfig('https://old.example'));
    mockTestConnection.mockResolvedValue({ ok: true });
    mockSetKey.mockRejectedValue(new Error('env 写入失败'));
    await expect(
      configureModel(cfg({ apiKey: 'sk-new', baseUrl: 'https://new.example' })),
    ).rejects.toThrow('env 写入失败');
    expect(mockUpsertModel).not.toHaveBeenCalled();
  });

  it('allows same-baseUrl edits without a key (normalized comparison)', async () => {
    mockGetKey.mockReturnValue('sk-old');
    mockLoadConfig.mockResolvedValue(storedConfig('https://API.deepseek.com/v1/'));
    const r = await configureModel(cfg({ apiKey: '', baseUrl: 'https://api.deepseek.com/v1' }));
    expect(r.ok).toBe(true);
    expect(mockTestConnection).not.toHaveBeenCalled();
    expect(mockSetKey).not.toHaveBeenCalled();
    expect(mockUpsertModel).toHaveBeenCalled();
  });

  it('normalizeBaseUrl ignores case, trailing slashes and default ports', () => {
    expect(normalizeBaseUrl('https://API.Example.com/v1/')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('https://api.example.com:443/v1')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('  https://api.example.com/v1  ')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('')).toBe('');
    expect(normalizeBaseUrl(undefined)).toBe('');
    expect(normalizeBaseUrl('not a url/')).toBe('not a url');
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

  it('rejects unsafe baseUrl before testing or saving (S10)', async () => {
    mockTestConnection.mockResolvedValue({ ok: true });
    const meta = await configureModel(cfg({ baseUrl: 'http://169.254.169.254/', apiKey: 'sk-new' }));
    expect(meta.ok).toBe(false);
    expect(meta.error).toMatch(/元数据|https|协议/);
    const cleartext = await configureModel(cfg({ baseUrl: 'http://192.168.1.10/v1', apiKey: 'sk-new' }));
    expect(cleartext.ok).toBe(false);
    expect(cleartext.error).toContain('https');
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
