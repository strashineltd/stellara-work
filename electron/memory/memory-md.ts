import type { Memory } from '../../shared/ipc';

const KIND_ORDER = ['fact', 'preference', 'decision', 'codebase', 'requirement', 'meeting'] as const;
const KIND_LABELS: Record<Memory['kind'], string> = {
  fact: '事实',
  preference: '偏好',
  decision: '决策',
  codebase: '代码库',
  requirement: '需求',
  meeting: '会议',
};

function frontmatter(m: Memory): string {
  const lines: string[] = ['---'];
  lines.push(`kind: ${m.kind}`);
  lines.push(`scope: ${m.scope}`);
  if (m.scopeId) lines.push(`scopeId: ${m.scopeId}`);
  if (m.tags && m.tags.length > 0) lines.push(`tags: [${m.tags.join(', ')}]`);
  if (m.source) lines.push(`source: ${m.source}`);
  lines.push(`importance: ${m.importance}`);
  lines.push(`confidence: ${m.confidence}`);
  lines.push(`created: ${new Date(m.createdAt).toISOString()}`);
  lines.push(`updated: ${new Date(m.updatedAt).toISOString()}`);
  lines.push(`accessCount: ${m.accessCount}`);
  lines.push('---');
  return lines.join('\n');
}

export function memoryToMarkdown(m: Memory): string {
  return `${frontmatter(m)}\n\n${m.content}\n`;
}

export function memoriesToExport(memories: Memory[]): string {
  const pinned = memories.filter((m) => m.importance >= 0.8);
  const rest = memories.filter((m) => m.importance < 0.8);
  const parts: string[] = [`# Stellara Work 记忆导出\n\n共 ${memories.length} 条记忆\n`];
  if (pinned.length > 0) {
    parts.push(`## 重要记忆\n`);
    for (const m of pinned) parts.push(memoryToMarkdown(m));
  }
  for (const kind of KIND_ORDER) {
    const group = rest.filter((m) => m.kind === kind);
    if (group.length === 0) continue;
    parts.push(`## ${KIND_LABELS[kind]}\n`);
    for (const m of group) parts.push(memoryToMarkdown(m));
  }
  return parts.join('\n');
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 24) || 'memory';
}

export function exportFileName(m: Memory, now: Date = new Date()): string {
  const y = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `记忆-${y}-${m.kind}-${sanitize(m.content)}.md`;
}

export function exportAllFileName(now: Date = new Date()): string {
  const y = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `Stellara-Memories-${y}.md`;
}
