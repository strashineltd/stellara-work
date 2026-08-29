import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SkillDef, SkillDetailedItem, SkillLoadError } from '../../shared/ipc';

/**
 * 扫描项目 workDir 下的 skills/ 目录，加载所有 .json 文件。
 * 无效文件不再静默跳过 —— loadSkillsWithErrors 返回错误列表（界面标注「格式错误」）。
 */

export function formatSkillsForPrompt(skills: SkillDef[]): string {
  if (skills.length === 0) return '';
  const lines = ['', '可用技能（skills/ 目录）：'];
  for (const s of skills) {
    lines.push(`- ${s.name}: ${s.description}`);
  }
  lines.push(
    '',
    '使用技能的步骤：先用 read_file 读取 skills/ 目录下对应技能文件（文件名与技能名一致，.md 或 .json 格式；' +
      '不确定文件名时先用 list_files 查看 skills/ 目录），完整阅读正文后再按其规则执行。',
    '技能正文不会出现在本提示中——只有读取对应文件后才能获得完整的执行规则。',
  );
  return lines.join('\n');
}

type ParseResult = { skill: SkillDef } | { reason: string };

/**
 * 解析 Claude 风格 markdown 技能文件。
 * 提取 frontmatter 中的 name / description（可选 fallbackName）/ enabled，正文作为 prompt。
 * 失败时返回区分字段的错误 reason（缺 name / 缺 description / 缺 prompt / 格式解析失败）。
 */
function parseSkillMarkdownDetailed(text: string, fallbackName: string): ParseResult {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { reason: '格式解析失败' };
  const block = m[1];
  const nameMatch = /^name:\s*(.+)$/m.exec(block);
  const descMatch = /^description:\s*(.+)$/m.exec(block);
  const enabledMatch = /^enabled:\s*(\S+)$/m.exec(block);
  const name = (nameMatch ? nameMatch[1].trim() : '') || fallbackName.trim();
  if (!name) return { reason: '缺少 name' };
  const description = descMatch ? descMatch[1].trim() : '';
  if (!description) return { reason: '缺少 description' };
  const prompt = text.slice(m[0].length).trim();
  if (!prompt) return { reason: '缺少 prompt' };
  const skill: SkillDef = { name, description, prompt, format: 'md' };
  if (enabledMatch && enabledMatch[1].toLowerCase() === 'false') skill.enabled = false;
  return { skill };
}

/** 兼容旧 API：解析失败返回 null */
export function parseSkillMarkdown(text: string, fallbackName: string): SkillDef | null {
  const r = parseSkillMarkdownDetailed(text, fallbackName);
  return 'skill' in r ? r.skill : null;
}

async function loadMarkdownSkills(
  skillsDir: string,
  dirName: string,
  skills: SkillDetailedItem[],
  errors: SkillLoadError[],
  useFileFallback: boolean,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(path.join(skillsDir, dirName));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const rel = dirName ? `${dirName}/${entry}` : entry;
    const fullPath = path.join(skillsDir, dirName, entry);
    try {
      const text = await fs.readFile(fullPath, 'utf-8');
      const parsed = parseSkillMarkdownDetailed(text, useFileFallback ? entry.replace(/\.md$/, '') : '');
      if ('skill' in parsed) {
        skills.push({ ...parsed.skill, file: rel });
      } else {
        errors.push({ file: rel, reason: parsed.reason });
      }
    } catch {
      errors.push({ file: rel, reason: '读取失败' });
    }
  }
}

export async function loadSkillsWithErrors(
  workDir: string,
): Promise<{ items: SkillDetailedItem[]; errors: SkillLoadError[] }> {
  const skillsDir = path.join(workDir, 'skills');
  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    // 目录不存在 → 静默
    return { items: [], errors: [] };
  }

  const skills: SkillDetailedItem[] = [];
  const errors: SkillLoadError[] = [];
  await loadMarkdownSkills(skillsDir, '', skills, errors, false);
  for (const entry of entries) {
    const fullPath = path.join(skillsDir, entry);
    if (entry.endsWith('.md')) continue;
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) await loadMarkdownSkills(skillsDir, entry, skills, errors, true);
    } catch {
      // 忽略无法 stat 的条目
    }
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const fullPath = path.join(skillsDir, entry);
    let parsed: Record<string, unknown>;
    try {
      const text = await fs.readFile(fullPath, 'utf-8');
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      errors.push({
        file: entry,
        reason: err instanceof SyntaxError ? '格式解析失败' : '读取失败',
      });
      continue;
    }
    if (typeof parsed.name !== 'string' || !parsed.name) {
      errors.push({ file: entry, reason: '缺少 name' });
      continue;
    }
    if (typeof parsed.description !== 'string' || !parsed.description) {
      errors.push({ file: entry, reason: '缺少 description' });
      continue;
    }
    if (typeof parsed.prompt !== 'string' || !parsed.prompt) {
      errors.push({ file: entry, reason: '缺少 prompt' });
      continue;
    }
    skills.push({
      name: parsed.name as string,
      description: parsed.description as string,
      prompt: parsed.prompt as string,
      format: 'json',
      file: entry,
    });
  }
  return { items: skills, errors: errors.sort((a, b) => a.file.localeCompare(b.file)) };
}

export async function loadSkills(workDir: string): Promise<SkillDef[]> {
  const { items } = await loadSkillsWithErrors(workDir);
  return items.filter((s) => s.enabled !== false);
}

/**
 * 按引用查找技能（/skill 精确调用用）。
 * 优先精确匹配 frontmatter name；其次按文件名（含/不含 .md/.json 后缀，
 * 子目录技能取 basename）匹配。返回 null 表示未找到。
 */
export function findSkill(items: SkillDetailedItem[], ref: string): SkillDetailedItem | null {
  if (!ref.trim()) return null;
  const nameMatch = items.find((s) => s.name === ref);
  if (nameMatch) return nameMatch;
  const bare = ref.replace(/\.(md|json)$/, '');
  const fileMatch = items.find((s) => {
    if (s.file === ref || s.file === `${bare}.md` || s.file === `${bare}.json`) return true;
    const base = s.file.split('/').pop() ?? '';
    return base === ref || base === `${bare}.md` || base === `${bare}.json`;
  });
  return fileMatch ?? null;
}

/**
 * 生成技能 markdown 文件内容（frontmatter + 正文）。
 * enabled 缺省为 true，仅当显式 false 时写入 `enabled: false` 行。
 */
export function buildSkillMarkdown(skill: {
  name: string;
  description: string;
  prompt: string;
  enabled?: boolean;
}): string {
  const lines = ['---', `name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.enabled === false) lines.push('enabled: false');
  lines.push('---');
  const prompt = skill.prompt.trim();
  return prompt ? `${lines.join('\n')}\n\n${prompt}` : lines.join('\n');
}

/** 技能文件字段补丁（用于编辑回填） */
export interface SkillPatch {
  name?: string;
  description?: string;
  prompt?: string;
  enabled?: boolean;
}

/**
 * 合并技能文件内容：解析原 frontmatter（保留未知字段如 tags 等）+ patch 字段更新 + 正文不变。
 * 无 frontmatter 时按 buildSkillMarkdown 生成。
 */
export function mergeSkillFrontmatter(original: string, patch: SkillPatch): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(original);
  if (!m) {
    return buildSkillMarkdown({
      name: patch.name ?? '',
      description: patch.description ?? '',
      prompt: patch.prompt ?? original.trim(),
      enabled: patch.enabled,
    });
  }
  const body = (patch.prompt !== undefined ? patch.prompt : original.slice(m[0].length)).trim();
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const raw of m[1].split('\n')) {
    const fm = /^([^:\n]+):/.exec(raw);
    if (!fm) {
      lines.push(raw);
      continue;
    }
    const key = fm[1].trim();
    if (seen.has(key)) continue;
    seen.add(key);
    if (key === 'name' && patch.name !== undefined) {
      lines.push(`name: ${patch.name}`);
      continue;
    }
    if (key === 'description' && patch.description !== undefined) {
      lines.push(`description: ${patch.description}`);
      continue;
    }
    if (key === 'enabled') {
      if (patch.enabled === undefined) lines.push(raw);
      else if (patch.enabled === false) lines.push('enabled: false');
      continue;
    }
    lines.push(raw);
  }
  if (patch.name !== undefined && !seen.has('name')) {
    lines.push(`name: ${patch.name}`);
    seen.add('name');
  }
  if (patch.description !== undefined && !seen.has('description')) {
    lines.push(`description: ${patch.description}`);
    seen.add('description');
  }
  if (patch.enabled === false && !seen.has('enabled')) lines.push('enabled: false');
  const frontmatter = `---\n${lines.join('\n')}\n---`;
  return body ? `${frontmatter}\n\n${body}` : frontmatter;
}

/** 将技能名称中的文件系统非法字符替换为 '-'，并 trim；空返回空串 */
export function sanitizeSkillName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim();
}

// ============================================
// 内置技能模板
// ============================================

/** 内置技能规格（新建项目时自动初始化到 workDir/skills/，可删除或禁用） */
export interface BuiltinSkillSpec {
  name: string;
  description: string;
  prompt: string;
}

export const BUILTIN_SKILLS: BuiltinSkillSpec[] = [
  {
    name: 'code-review',
    description: '审查代码变更，输出按严重程度排序的问题清单与修复建议',
    prompt: `你是资深代码审查专家。审查流程：
1. 用 git_status 查看当前变更，git_diff 查看具体改动
2. 逐个文件检查：正确性、边界条件、错误处理、安全（路径/命令注入）、性能
3. 用 search_content 追溯相关符号的使用方式，确认改动与既有约定一致
4. 输出审查报告：问题按严重程度排序（严重/建议/风格），每条附文件与行号、问题描述、修复建议

只读审查，不修改文件。`,
  },
  {
    name: 'test-writer',
    description: '为目标代码编写单元测试并确保全部通过',
    prompt: `你是测试工程师。流程：
1. 用 read_file 读取目标文件，理解函数接口与依赖
2. 用 list_files + read_file 查看项目现有测试，遵循既有测试约定（框架、目录结构、命名）
3. 编写测试：正常路径 + 边界条件 + 错误分支；用 mock 隔离外部依赖
4. 运行测试命令确认全部通过；失败则修复测试或代码后重跑
5. 汇报：新增测试文件/用例数、覆盖率变化、测试结果`,
  },
  {
    name: 'debug-issue',
    description: '定位并修复程序 bug，最小改动验证后总结根因',
    prompt: `你是调试专家。流程：
1. 复现：阅读报错信息与复现步骤，用 read_file 定位相关代码
2. 假设驱动：列出可能原因，用 search_content 追溯数据流，用 run_command 运行最小复现
3. 最小改动修复，运行相关测试验证
4. 总结根因与修复方案，指出同类风险点`,
  },
];

/**
 * 初始化内置技能到 workDir/skills/（幂等）。
 * 已存在同名文件时跳过；返回实际创建的文件名列表。
 */
export async function initBuiltinSkills(workDir: string): Promise<string[]> {
  const skillsDir = path.join(workDir, 'skills');
  await fs.mkdir(skillsDir, { recursive: true });
  const created: string[] = [];
  for (const spec of BUILTIN_SKILLS) {
    const file = `${spec.name}.md`;
    try {
      // wx 独占创建：已存在抛 EEXIST，跳过不覆盖用户修改
      await fs.writeFile(path.join(skillsDir, file), buildSkillMarkdown(spec), { encoding: 'utf-8', flag: 'wx' });
      created.push(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'EEXIST') continue;
      throw e;
    }
  }
  return created;
}
