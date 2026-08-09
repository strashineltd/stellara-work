import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadSkills, loadSkillsWithErrors, formatSkillsForPrompt } from './skills';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-skills-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeSkill(rel: string, text: string) {
  const p = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, 'utf-8');
}

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

describe('loadSkillsWithErrors', () => {
  it('目录不存在 → 空 skills + 空 errors', async () => {
    const res = await loadSkillsWithErrors(path.join(tmpDir, 'no-skills'));
    expect(res).toEqual({ skills: [], errors: [] });
  });

  it('区分字段的格式错误列表（json）', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'noname.json'), JSON.stringify({ description: 'x', prompt: 'y' }));
    await fs.writeFile(path.join(skillsDir, 'nodesc.json'), JSON.stringify({ name: 'x', prompt: 'y' }));
    await fs.writeFile(path.join(skillsDir, 'noprompt.json'), JSON.stringify({ name: 'x', description: 'y' }));
    await fs.writeFile(path.join(skillsDir, 'broken.json'), 'not json{');
    await fs.writeFile(path.join(skillsDir, 'good.json'), JSON.stringify({ name: 'good', description: 'x', prompt: 'y' }));
    const res = await loadSkillsWithErrors(tmpDir);
    expect(res.skills.map((s) => s.name)).toEqual(['good']);
    expect(res.errors).toEqual([
      { file: 'broken.json', reason: '格式解析失败' },
      { file: 'nodesc.json', reason: '缺少 description' },
      { file: 'noname.json', reason: '缺少 name' },
      { file: 'noprompt.json', reason: '缺少 prompt' },
    ]);
  });

  it('区分字段的格式错误列表（markdown）', async () => {
    await writeSkill('skills/bad.md', '# 没有 frontmatter');
    await writeSkill('skills/noname.md', '---\ndescription: 缺 name\n---\n正文');
    await writeSkill('skills/nodesc.md', '---\nname: x\n---\n正文');
    await writeSkill('skills/ok.md', '---\nname: ok\ndescription: 好\n---\n正文');
    const res = await loadSkillsWithErrors(tmpDir);
    expect(res.skills.map((s) => s.name)).toEqual(['ok']);
    expect(res.errors).toEqual([
      { file: 'bad.md', reason: '格式解析失败' },
      { file: 'nodesc.md', reason: '缺少 description' },
      { file: 'noname.md', reason: '缺少 name' },
    ]);
  });

  it('loadSkills 只返回 skills（错误列表被丢弃）', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'bad.json'), JSON.stringify({ description: 'x', prompt: 'y' }));
    await fs.writeFile(path.join(skillsDir, 'good.json'), JSON.stringify({ name: 'good', description: 'x', prompt: 'y' }));
    expect(await loadSkills(tmpDir)).toEqual([{ name: 'good', description: 'x', prompt: 'y', format: 'json' }]);
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

describe('loadSkills markdown format', () => {
  it('loads .md skill with frontmatter name/description and body as prompt', async () => {
    await writeSkill('skills/review.md', `---\nname: review\n描述行: 忽略\ndescription: 代码审查技能\n---\n\n审查当前变更并输出发现清单。`);
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toEqual({ name: 'review', description: '代码审查技能', prompt: '审查当前变更并输出发现清单。', format: 'md' });
  });

  it('skips .md without required frontmatter fields', async () => {
    await writeSkill('skills/bad.md', '# 没有 frontmatter');
    await writeSkill('skills/noname.md', '---\ndescription: 缺 name\n---\n正文');
    await writeSkill('skills/nodesc.md', '---\nname: x\n---\n正文');
    expect(await loadSkills(tmpDir)).toHaveLength(0);
  });

  it('loads subdirectory skills with filename fallback name', async () => {
    await writeSkill('skills/review/code.md', `---\ndescription: 子目录技能\n---\n正文`);
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('code');
  });

  it('keeps legacy .json skills working', async () => {
    await writeSkill('skills/old.json', JSON.stringify({ name: 'old', description: '旧格式', prompt: 'p' }));
    expect(await loadSkills(tmpDir)).toHaveLength(1);
  });
});
