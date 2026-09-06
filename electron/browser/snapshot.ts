export interface SnapLink { id: string; text: string; href: string; }
export interface SnapForm { id: string; kind: string; name: string; }
export function htmlToSnapshot(html: string, baseUrl: string, maxChars = 30000): { markdown: string; links: SnapLink[]; forms: SnapForm[] } {
  const links: SnapLink[] = [];
  const linkRe = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let n = 1;
  let md = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  md = md.replace(linkRe, (_s, href: string, text: string) => {
    let abs = href;
    try { abs = new URL(href, baseUrl).href; } catch { /* keep */ }
    const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || abs;
    const id = `r${n++}`;
    links.push({ id, text: clean, href: abs });
    return ` [${clean}][${id}] `;
  });
  const forms: SnapForm[] = [];
  const tagRe = /<(input|button|select|textarea)[^>]*>/gi;
  let f = 1; let fm: RegExpExecArray | null;
  while ((fm = tagRe.exec(html)) && forms.length < 50) {
    const nm = /name=["']([^"']*)["']/i.exec(fm[0]);
    forms.push({ id: `f${f++}`, kind: fm[1]!.toLowerCase(), name: nm?.[1] ?? '' });
  }
  md = md.replace(/<[^>]*>/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
  const linkTable = links.slice(0, 50).map(l => `[${l.id}] ${l.text} -> ${l.href}`).join('\n');
  return { markdown: linkTable ? `${md}\n\n[links]\n${linkTable}` : md, links, forms };
}

/** 解析 <table> 为 Markdown 表格（regex 实现，无新依赖） */
export function htmlToTables(html: string, maxChars = 20000): string {
  const tables: string[] = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(html)) && tables.length < 10) {
    const rows = parseTableRows(tm[0]!);
    if (rows.length > 0) tables.push(rowsToMarkdown(rows));
  }
  return tables.join('\n\n').slice(0, maxChars);
}

function parseTableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(tableHtml)) && rows.length < 50) {
    const cells: string[] = [];
    const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(m[1]!))) cells.push(cm[1]!);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function cleanCell(cell: string): string {
  const text = cell.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
  return text.slice(0, 200) || ' ';
}

function rowsToMarkdown(rows: string[][]): string {
  const header = rows[0]!;
  const lines = [
    `| ${header.map(cleanCell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows.slice(1)) {
    lines.push(`| ${row.map(cleanCell).join(' | ')} |`);
  }
  return lines.join('\n');
}
