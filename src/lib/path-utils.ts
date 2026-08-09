const FILE_EXT = 'ts|tsx|js|jsx|py|swift|go|rs|java|json|md|css|html|sh|yaml|yml|txt|sql|toml';
const RELATIVE_PATH_RE = new RegExp(`^(?:\\./)?[A-Za-z0-9_\\-]+(?:/[A-Za-z0-9_.\\-]+)*\\.(?:${FILE_EXT})$`);

export function isRelativePathLike(str: string): boolean {
  if (!str || str.length > 240) return false;
  if (str.startsWith('http://') || str.startsWith('https://')) return false;
  if (str.includes('\\')) return false;
  if (str.endsWith('/')) return false;
  if (!str.includes('/')) return false; // 必须至少一级目录
  return RELATIVE_PATH_RE.test(str);
}

export function extractRelativePaths(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // 以单词边界分割候选 token（保留 ./ 开头与路径字符）
  const tokenRe = /(?:\.\/)?[A-Za-z0-9_\-]+(?:\/[A-Za-z0-9_.\-]+)*\.[A-Za-z0-9]+/g;
  for (const m of text.matchAll(tokenRe)) {
    const token = m[0];
    if (!isRelativePathLike(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}
