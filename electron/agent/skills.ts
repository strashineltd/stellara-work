import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SkillDef, SkillLoadError } from '../../shared/ipc';

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
  return lines.join('\n');
}

type ParseResult = { skill: SkillDef } | { reason: string };

/**
 * 解析 Claude 风格 markdown 技能文件。
 * 提取 frontmatter 中的 name / description（可选 fallbackName），正文作为 prompt。
 * 失败时返回区分字段的错误 reason（缺 name / 缺 description / 缺 prompt / 格式解析失败）。
 */
function parseSkillMarkdownDetailed(text: string, fallbackName: string): ParseResult {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { reason: '格式解析失败' };
  const block = m[1];
  const nameMatch = /^name:\s*(.+)$/m.exec(block);
  const descMatch = /^description:\s*(.+)$/m.exec(block);
  const name = (nameMatch ? nameMatch[1].trim() : '') || fallbackName.trim();
  if (!name) return { reason: '缺少 name' };
  const description = descMatch ? descMatch[1].trim() : '';
  if (!description) return { reason: '缺少 description' };
  const prompt = text.slice(m[0].length).trim();
  if (!prompt) return { reason: '缺少 prompt' };
  return { skill: { name, description, prompt, format: 'md' } };
}

/** 兼容旧 API：解析失败返回 null */
export function parseSkillMarkdown(text: string, fallbackName: string): SkillDef | null {
  const r = parseSkillMarkdownDetailed(text, fallbackName);
  return 'skill' in r ? r.skill : null;
}

async function loadMarkdownSkills(
  skillsDir: string,
  dirName: string,
  skills: SkillDef[],
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
        skills.push(parsed.skill);
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
): Promise<{ skills: SkillDef[]; errors: SkillLoadError[] }> {
  const skillsDir = path.join(workDir, 'skills');
  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    // 目录不存在 → 静默
    return { skills: [], errors: [] };
  }

  const skills: SkillDef[] = [];
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
    });
  }
  return { skills, errors: errors.sort((a, b) => a.file.localeCompare(b.file)) };
}

export async function loadSkills(workDir: string): Promise<SkillDef[]> {
  const { skills } = await loadSkillsWithErrors(workDir);
  return skills;
}
