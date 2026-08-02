import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadSkills, formatSkillsForPrompt } from './skills';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-skills-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadSkills', () => {
  it('目录不存在 → 返回空数组', async () => {
    const skills = await loadSkills(path.join(tmpDir, 'no-skills'));
    expect(skills).toEqual([]);
  });

  it('空目录 → 返回空数组', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    const skills = await loadSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it('加载 1 个有效 JSON', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(
      path.join(skillsDir, 'code-review.json'),
      JSON.stringify({
        name: 'code-review',
        description: '审查代码',
        prompt: '你是审查专家。',
      }),
    );
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('code-review');
    expect(skills[0]!.description).toBe('审查代码');
    expect(skills[0]!.prompt).toBe('你是审查专家。');
  });

  it('过滤缺少 name 的文件', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'bad.json'), JSON.stringify({ description: 'x', prompt: 'y' }));
    await fs.writeFile(path.join(skillsDir, 'good.json'), JSON.stringify({ name: 'good', description: 'x', prompt: 'y' }));
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('good');
  });

  it('过滤缺少 description 的文件', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'bad.json'), JSON.stringify({ name: 'x', prompt: 'y' }));
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(0);
  });

  it('过滤缺少 prompt 的文件', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'bad.json'), JSON.stringify({ name: 'x', description: 'y' }));
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(0);
  });

  it('JSON 解析失败 → 跳过', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'broken.json'), 'not json{');
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(0);
  });

  it('忽略非 .json 文件', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'README.md'), '# docs');
    await fs.writeFile(path.join(skillsDir, 'ok.json'), JSON.stringify({ name: 'ok', description: 'x', prompt: 'y' }));
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('ok');
  });

  it('加载多个有效 JSON', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'a.json'), JSON.stringify({ name: 'a', description: 'a-desc', prompt: 'a-prompt' }));
    await fs.writeFile(path.join(skillsDir, 'b.json'), JSON.stringify({ name: 'b', description: 'b-desc', prompt: 'b-prompt' }));
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(['a', 'b']);
  });
});

describe('formatSkillsForPrompt', () => {
  it('空 → 空字符串', () => {
    expect(formatSkillsForPrompt([])).toBe('');
  });

  it('生成格式化文本', () => {
    const text = formatSkillsForPrompt([
      { name: 'code-review', description: '审查代码', prompt: '...' },
      { name: 'doc-writer', description: '写文档', prompt: '...' },
    ]);
    expect(text).toContain('可用技能');
    expect(text).toContain('code-review');
    expect(text).toContain('doc-writer');
    expect(text).toContain('审查代码');
    expect(text).toContain('写文档');
  });
});