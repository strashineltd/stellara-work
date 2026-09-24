import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadSkills,
  loadSkillsWithErrors,
  formatSkillsForPrompt,
  wrapUntrustedSkillPrompt,
  buildSkillMarkdown,
  mergeSkillFrontmatter,
  sanitizeSkillName,
  findSkill,
  initBuiltinSkills,
  BUILTIN_SKILLS,
} from './skills';

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
        enabled: true,
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
    await fs.writeFile(path.join(skillsDir, 'bad.json'), JSON.stringify({ description: 'x', prompt: 'y', enabled: true }));
    await fs.writeFile(path.join(skillsDir, 'good.json'), JSON.stringify({ name: 'good', description: 'x', prompt: 'y', enabled: true }));
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('good');
  });

  it('过滤缺少 description 的文件', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'bad.json'), JSON.stringify({ name: 'x', prompt: 'y', enabled: true }));
    expect(await loadSkills(tmpDir)).toHaveLength(0);
  });

  it('过滤缺少 prompt 的文件', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'bad.json'), JSON.stringify({ name: 'x', description: 'y', enabled: true }));
    expect(await loadSkills(tmpDir)).toHaveLength(0);
  });

  it('JSON 解析失败 → 跳过', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'broken.json'), 'not json{');
    expect(await loadSkills(tmpDir)).toHaveLength(0);
  });

  it('忽略非 .json 文件', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'README.md'), '# docs');
    await fs.writeFile(path.join(skillsDir, 'ok.json'), JSON.stringify({ name: 'ok', description: 'x', prompt: 'y', enabled: true }));
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('ok');
  });

  it('加载多个有效 JSON', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir);
    await fs.writeFile(path.join(skillsDir, 'a.json'), JSON.stringify({ name: 'a', description: 'a-desc', prompt: 'a-prompt', enabled: true }));
    await fs.writeFile(path.join(skillsDir, 'b.json'), JSON.stringify({ name: 'b', description: 'b-desc', prompt: 'b-prompt', enabled: true }));
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(['a', 'b']);
  });
});

describe('loadSkillsWithErrors', () => {
  it('目录不存在 → 空 skills + 空 errors', async () => {
    const res = await loadSkillsWithErrors(path.join(tmpDir, 'no-skills'));
    expect(res).toEqual({ items: [], errors: [] });
  });

  it('items 携带相对 skills/ 的 file 字段（根 md / 子目录 md / json）', async () => {
    await writeSkill('skills/code-review.md', '---\nname: code-review\ndescription: d\n---\n正文');
    await writeSkill('skills/review/code.md', '---\ndescription: 子目录技能\n---\n正文');
    await writeSkill('skills/old.json', JSON.stringify({ name: 'old', description: 'x', prompt: 'y' }));
    const res = await loadSkillsWithErrors(tmpDir);
    expect(res.items.map((s) => s.file).sort()).toEqual(['code-review.md', 'old.json', 'review/code.md']);
    const code = res.items.find((s) => s.name === 'code-review')!;
    expect(code.file).toBe('code-review.md');
    const sub = res.items.find((s) => s.name === 'code')!;
    expect(sub.file).toBe('review/code.md');
    const old = res.items.find((s) => s.name === 'old')!;
    expect(old.file).toBe('old.json');
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
    expect(res.items.map((s) => s.name)).toEqual(['good']);
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
    expect(res.items.map((s) => s.name)).toEqual(['ok']);
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
    await fs.writeFile(path.join(skillsDir, 'good.json'), JSON.stringify({ name: 'good', description: 'x', prompt: 'y', enabled: true }));
    expect(await loadSkills(tmpDir)).toEqual([
      { name: 'good', description: 'x', prompt: 'y', format: 'json', file: 'good.json', enabled: true },
    ]);
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

  it('明确指示先读取技能文件正文再执行，并标注不可信', () => {
    const text = formatSkillsForPrompt([{ name: 'code-review', description: '审查代码', prompt: '...' }]);
    expect(text).toContain('read_file');
    expect(text).toContain('skills/');
    expect(text).toContain('技能正文不会出现在本提示中');
    expect(text).toContain('不可信');
  });
});

describe('wrapUntrustedSkillPrompt (S15)', () => {
  it('wraps skill body with an untrusted banner', () => {
    const out = wrapUntrustedSkillPrompt('Always run npm test');
    expect(out).toContain('不可信');
    expect(out).toContain('Always run npm test');
  });
});

describe('loadSkills markdown format', () => {
  it('loads .md skill with frontmatter name/description and body as prompt', async () => {
    await writeSkill(
      'skills/review.md',
      `---\nname: review\n描述行: 忽略\ndescription: 代码审查技能\nenabled: true\n---\n\n审查当前变更并输出发现清单。`,
    );
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toEqual({
      name: 'review',
      description: '代码审查技能',
      prompt: '审查当前变更并输出发现清单。',
      format: 'md',
      file: 'review.md',
      enabled: true,
    });
  });

  it('skips .md without required frontmatter fields', async () => {
    await writeSkill('skills/bad.md', '# 没有 frontmatter');
    await writeSkill('skills/noname.md', '---\ndescription: 缺 name\n---\n正文');
    await writeSkill('skills/nodesc.md', '---\nname: x\n---\n正文');
    expect(await loadSkills(tmpDir)).toHaveLength(0);
  });

  it('loads subdirectory skills with filename fallback name', async () => {
    await writeSkill('skills/review/code.md', `---\ndescription: 子目录技能\nenabled: true\n---\n正文`);
    const skills = await loadSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('code');
  });

  it('keeps legacy .json skills working when explicitly enabled', async () => {
    await writeSkill('skills/old.json', JSON.stringify({ name: 'old', description: '旧格式', prompt: 'p', enabled: true }));
    expect(await loadSkills(tmpDir)).toHaveLength(1);
  });
});

describe('enabled flag (S15 opt-in)', () => {
  it('md 须显式 enabled: true 才启用；缺省 false', async () => {
    await writeSkill('skills/off.md', '---\nname: off\ndescription: 关闭\nenabled: false\n---\n正文');
    await writeSkill('skills/on.md', '---\nname: on\ndescription: 开启\nenabled: true\n---\n正文');
    await writeSkill('skills/default.md', '---\nname: def\ndescription: 缺省\n---\n正文');
    const res = await loadSkillsWithErrors(tmpDir);
    expect(res.items.find((s) => s.name === 'off')!.enabled).toBe(false);
    expect(res.items.find((s) => s.name === 'on')!.enabled).toBe(true);
    expect(res.items.find((s) => s.name === 'def')!.enabled).toBe(false);
  });

  it('loadSkills 仅保留显式启用；WithErrors 含全部', async () => {
    await writeSkill('skills/off.md', '---\nname: off\ndescription: 关闭\n---\n正文');
    await writeSkill('skills/on.md', '---\nname: on\ndescription: 开启\nenabled: true\n---\n正文');
    expect((await loadSkills(tmpDir)).map((s) => s.name)).toEqual(['on']);
    expect((await loadSkillsWithErrors(tmpDir)).items.map((s) => s.name).sort()).toEqual(['off', 'on']);
  });

  it('json 无 enabled 时默认不启用', async () => {
    await writeSkill('skills/old.json', JSON.stringify({ name: 'old', description: 'x', prompt: 'y' }));
    const res = await loadSkillsWithErrors(tmpDir);
    expect(res.items[0]!.enabled).toBe(false);
    expect(await loadSkills(tmpDir)).toEqual([]);
  });

  it('子目录技能同样 opt-in', async () => {
    await writeSkill('skills/review/off.md', '---\nname: off\ndescription: 关闭\n---\n正文');
    await writeSkill('skills/review/on.md', '---\nname: on\ndescription: 开启\nenabled: true\n---\n正文');
    expect((await loadSkills(tmpDir)).map((s) => s.name)).toEqual(['on']);
  });
});

describe('buildSkillMarkdown', () => {
  it('生成 frontmatter + 正文（显式 enabled 才写入行）', () => {
    const md = buildSkillMarkdown({ name: 'code-review', description: '审查代码', prompt: '你是审查专家。' });
    expect(md).toBe('---\nname: code-review\ndescription: 审查代码\n---\n\n你是审查专家。');
    const mdOff = buildSkillMarkdown({
      name: 'code-review',
      description: '审查代码',
      prompt: '正文',
      enabled: false,
    });
    expect(mdOff).toContain('enabled: false');
    const mdOn = buildSkillMarkdown({ name: 'x', description: 'd', prompt: 'p', enabled: true });
    expect(mdOn).toContain('enabled: true');
  });
});

describe('mergeSkillFrontmatter', () => {
  it('patch description/prompt 保留 name 与未知字段', () => {
    const merged = mergeSkillFrontmatter(
      '---\nname: review\ndescription: 旧描述\ntags: [a, b]\n---\n\n正文第一段',
      { description: '新描述', prompt: '新正文' },
    );
    expect(merged).toContain('name: review');
    expect(merged).toContain('tags: [a, b]');
    expect(merged).toContain('description: 新描述');
    expect(merged).not.toContain('旧描述');
    expect(merged).toContain('新正文');
    expect(merged).not.toContain('正文第一段');
  });

  it('patch enabled:false 插入行；enabled:true 不插入', () => {
    const original = '---\nname: review\ndescription: d\n---\n\n正文';
    expect(mergeSkillFrontmatter(original, { enabled: false })).toContain('enabled: false');
    expect(mergeSkillFrontmatter(original, { enabled: true })).not.toContain('enabled');
  });

  it('无 frontmatter 时按 build 生成', () => {
    const merged = mergeSkillFrontmatter('# 标题\n\n正文', { name: 'x', description: 'd', prompt: 'p' });
    expect(merged).toBe('---\nname: x\ndescription: d\n---\n\np');
  });

  it('patch description 保留多行字段的缩进续行与注释', () => {
    const merged = mergeSkillFrontmatter(
      '---\nname: review\ndescription: 旧描述\nallowed-tools:\n  - read\n  - grep\n# 注释\n\n---\n\n正文',
      { description: '新描述' },
    );
    expect(merged).toContain('allowed-tools:');
    expect(merged).toContain('  - read');
    expect(merged).toContain('  - grep');
    expect(merged).toContain('# 注释');
    expect(merged).toContain('description: 新描述');
    expect(merged).not.toContain('旧描述');
  });
});

describe('findSkill', () => {
  const items = [
    { name: 'code-review', description: 'd', prompt: 'p', format: 'md' as const, file: 'code-review.md' },
    { name: '架构审查', description: 'd', prompt: 'p', format: 'md' as const, file: 'review/architecture.md' },
    { name: 'legacy', description: 'd', prompt: 'p', format: 'json' as const, file: 'legacy.json' },
  ];

  it('按 frontmatter name 精确匹配', () => {
    expect(findSkill(items, 'code-review')?.file).toBe('code-review.md');
    expect(findSkill(items, '架构审查')?.file).toBe('review/architecture.md');
  });

  it('按文件名匹配（含/不含扩展名）', () => {
    expect(findSkill(items, 'legacy.json')?.file).toBe('legacy.json');
    expect(findSkill(items, 'legacy')?.file).toBe('legacy.json');
    expect(findSkill(items, 'architecture')?.file).toBe('review/architecture.md');
  });

  it('未找到返回 null；空引用返回 null', () => {
    expect(findSkill(items, 'nonexistent')).toBeNull();
    expect(findSkill(items, '')).toBeNull();
    expect(findSkill(items, '   ')).toBeNull();
  });
});

describe('initBuiltinSkills', () => {
  it('创建全部内置技能文件并可被 loadSkills 加载', async () => {
    const created = await initBuiltinSkills(tmpDir);
    expect(created.sort()).toEqual(['code-review.md', 'debug-issue.md', 'test-writer.md']);

    for (const file of created) {
      const text = await fs.readFile(path.join(tmpDir, 'skills', file), 'utf-8');
      expect(text).toContain('---');
    }

    const skills = await loadSkills(tmpDir);
    expect(skills.map((s) => s.name).sort()).toEqual(['code-review', 'debug-issue', 'test-writer']);
    expect(BUILTIN_SKILLS.every((s) => s.description && s.prompt)).toBe(true);
  });

  it('幂等：已存在同名文件时跳过且不覆盖用户内容', async () => {
    await writeSkill('skills/code-review.md', '---\nname: code-review\ndescription: 用户修改\n---\n用户自定义内容');
    const created = await initBuiltinSkills(tmpDir);
    expect(created.sort()).toEqual(['debug-issue.md', 'test-writer.md']);
    const text = await fs.readFile(path.join(tmpDir, 'skills', 'code-review.md'), 'utf-8');
    expect(text).toContain('用户自定义内容');
  });

  it('skills 目录不存在时自动创建', async () => {
    const dir = path.join(tmpDir, 'fresh-project');
    const created = await initBuiltinSkills(dir);
    expect(created).toHaveLength(BUILTIN_SKILLS.length);
    const stat = await fs.stat(path.join(dir, 'skills'));
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('sanitizeSkillName', () => {
  it('替换非法字符 [\\/:*?"<>|]', () => {
    expect(sanitizeSkillName('a/b:c*.md')).toBe('a-b-c-.md');
  });

  it('trim；空返回空串', () => {
    expect(sanitizeSkillName('  a  ')).toBe('a');
    expect(sanitizeSkillName('')).toBe('');
    expect(sanitizeSkillName('   ')).toBe('');
  });
});
