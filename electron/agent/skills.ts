import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SkillDef } from '../../shared/ipc';

/**
 * 扫描项目 workDir 下的 skills/ 目录，加载所有 .json 文件。
 * 缺少字段的跳过 + console.warn；目录不存在则返回空数组（静默）。
 */

export function formatSkillsForPrompt(skills: SkillDef[]): string {
  if (skills.length === 0) return '';
  const lines = ['', '可用技能（skills/ 目录）：'];
  for (const s of skills) {
    lines.push(`- ${s.name}: ${s.description}`);
  }
  return lines.join('\n');
}

/**
 * 解析 Claude 风格 markdown 技能文件。
 * 提取 frontmatter 中的 name / description（可选 fallbackName），正文作为 prompt。
 * 缺 name（且无 fallback）或缺 description 时返回 null。
 */
export function parseSkillMarkdown(text: string, fallbackName: string): SkillDef | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return null;
  const block = m[1];
  const nameMatch = /^name:\s*(.+)$/m.exec(block);
  const descMatch = /^description:\s*(.+)$/m.exec(block);
  const name = (nameMatch ? nameMatch[1].trim() : '') || fallbackName.trim();
  if (!name) return null;
  const description = descMatch ? descMatch[1].trim() : '';
  if (!description) return null;
  const prompt = text.slice(m[0].length).trim();
  if (!prompt) return null;
  return { name, description, prompt, format: 'md' };
}

async function loadMarkdownSkills(skillsDir: string, dirName: string, skills: SkillDef[], useFileFallback: boolean): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(path.join(skillsDir, dirName));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const fullPath = path.join(skillsDir, dirName, entry);
    try {
      const text = await fs.readFile(fullPath, 'utf-8');
      const parsed = parseSkillMarkdown(text, useFileFallback ? entry.replace(/\.md$/, '') : '');
      if (!parsed) {
        console.warn(`[skills] 跳过 ${entry}：缺少 name/description/prompt 字段`);
        continue;
      }
      skills.push(parsed);
    } catch (err) {
      console.warn(`[skills] 跳过 ${entry}：读取失败 —`, err instanceof Error ? err.message : err);
    }
  }
}

export async function loadSkills(workDir: string): Promise<SkillDef[]> {
  const skillsDir = path.join(workDir, 'skills');
  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    // 目录不存在 → 静默
    return [];
  }

  const skills: SkillDef[] = [];
  await loadMarkdownSkills(skillsDir, '', skills, false);
  for (const entry of entries) {
    const fullPath = path.join(skillsDir, entry);
    if (entry.endsWith('.md')) continue;
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) await loadMarkdownSkills(skillsDir, entry, skills, true);
    } catch {
      // 忽略无法 stat 的条目
    }
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const fullPath = path.join(skillsDir, entry);
    try {
      const text = await fs.readFile(fullPath, 'utf-8');
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.name !== 'string' || !parsed.name) {
        console.warn(`[skills] 跳过 ${entry}：缺少 "name" 字段`);
        continue;
      }
      if (typeof parsed.description !== 'string' || !parsed.description) {
        console.warn(`[skills] 跳过 ${entry}：缺少 "description" 字段`);
        continue;
      }
      if (typeof parsed.prompt !== 'string' || !parsed.prompt) {
        console.warn(`[skills] 跳过 ${entry}：缺少 "prompt" 字段`);
        continue;
      }
      skills.push({
        name: parsed.name as string,
        description: parsed.description as string,
        prompt: parsed.prompt as string,
        format: 'json',
      });
    } catch (err) {
      console.warn(`[skills] 跳过 ${entry}：JSON 解析失败 —`, err instanceof Error ? err.message : err);
    }
  }
  return skills;
}