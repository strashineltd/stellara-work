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
