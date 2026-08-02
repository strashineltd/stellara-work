import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, saveConfig, addModel, migrateFromV1, _setConfigDir } from './config-v2';
import { _setSecretsDir, getKey } from './secrets';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-cfg-'));
  _setConfigDir(tmpDir);
  _setSecretsDir(tmpDir);
});
afterEach(async () => {
  _setConfigDir(null);
  _setSecretsDir(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('config-v2', () => {
  it('loadConfig returns empty defaults if no file', async () => {
    const cfg = await loadConfig();
    expect(cfg).toEqual({
      activeModelId: null,
      models: [],
      app: {},
      schemaVersion: 1,
    });
  });

  it('saveConfig + loadConfig round-trips', async () => {
    await saveConfig({
      activeModelId: 'm1',
      models: [{ id: 'm1', label: 'M1', baseUrl: 'https://x', model: 'm', createdAt: '2026-01-01' }],
      app: {},
      schemaVersion: 1,
    });
    const cfg = await loadConfig();
    expect(cfg.activeModelId).toBe('m1');
    expect(cfg.models[0]?.id).toBe('m1');
  });

  it('addModel appends and returns new config', async () => {
    const cfg1 = await addModel({ id: 'a', label: 'A', baseUrl: 'x', model: 'a', createdAt: 't' });
    expect(cfg1.models).toHaveLength(1);
    const cfg2 = await addModel({ id: 'b', label: 'B', baseUrl: 'x', model: 'b', createdAt: 't' });
    expect(cfg2.models).toHaveLength(2);
  });

  it('addModel throws on duplicate id', async () => {
    const cfg0 = await loadConfig();
    await addModel({ id: 'a', label: 'A', baseUrl: 'x', model: 'a', createdAt: 't' });
    let threw = false;
    try {
      await addModel({ id: 'a', label: 'A2', baseUrl: 'x', model: 'a', createdAt: 't' });
    } catch (e) {
      threw = true;
      expect((e as Error).message).toContain('已存在');
    }
    expect(threw).toBe(true);
  });

  it('migrateFromV1 converts old config.json to new format', async () => {
    // _setConfigDir(tmpDir) 意味着 configPath = tmpDir/config.json（生产是 ~/.stellara/config.json）
    // 测试时直接把 config.json 写到 tmpDir 下
    const old = {
      id: 'deepseek-v4-pro',
      label: 'DeepSeek-v4-Pro',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-old-key',
      workDir: 'D:\\work',
      isCustom: false,
    };
    await fs.writeFile(path.join(tmpDir, 'config.json'), JSON.stringify(old, null, 2));
    const migrated = await migrateFromV1();
    expect(migrated).toBe(true);
    const cfg = await loadConfig();
    expect(cfg.activeModelId).toBe('deepseek-v4-pro');
    expect(cfg.models[0]).toMatchObject({
      id: 'deepseek-v4-pro',
      label: 'DeepSeek-v4-Pro',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      workDir: 'D:\\work',
    });
    expect((cfg.models[0] as unknown as Record<string, unknown>).apiKey).toBeUndefined();
    // .env 应该有 key
    expect(getKey('deepseek-v4-pro')).toBe('sk-old-key');
    // 旧文件备份
    const backup = await fs.readFile(path.join(tmpDir, 'config.json.bak'), 'utf-8');
    expect(backup).toContain('sk-old-key');
  });

  it('migrateFromV1 returns false if no old config', async () => {
    const migrated = await migrateFromV1();
    expect(migrated).toBe(false);
  });

  it('migrateFromV1 returns false if no apiKey (already v2)', async () => {
    await fs.writeFile(path.join(tmpDir, 'config.json'), JSON.stringify({
      activeModelId: 'm1',
      models: [],
      app: {},
      schemaVersion: 1,
    }));
    const migrated = await migrateFromV1();
    expect(migrated).toBe(false);
  });
});

