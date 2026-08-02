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
      });
    } catch (err) {
      console.warn(`[skills] 跳过 ${entry}：JSON 解析失败 —`, err instanceof Error ? err.message : err);
    }
  }
  return skills;
}