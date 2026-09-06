import { describe, it, expect } from 'vitest';
import { htmlToSnapshot, htmlToTables } from './snapshot';
describe('htmlToSnapshot', () => {
  it('assigns stable ref ids and extracts forms', () => {
    const s = htmlToSnapshot('<h1>Hi</h1><a href="/x">Go</a><input name="q">', 'https://ex.com', 30000);
    expect(s.markdown).toContain('Hi');
    expect(s.links[0]).toMatchObject({ id: 'r1' });
    expect(s.links[0]!.href).toBe('https://ex.com/x');
    expect(s.forms[0]!.name).toBe('q');
  });
});

describe('htmlToTables', () => {
  it('extracts tables as markdown with header separator', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    const md = htmlToTables(html);
    expect(md).toContain('| A | B |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| 1 | 2 |');
  });

  it('strips nested tags and escapes pipes in cells', () => {
    const html = '<table><tr><td><b>a|b</b></td><td><i>c</i></td></tr></table>';
    const md = htmlToTables(html);
    expect(md).toContain('| a\\|b | c |');
  });

  it('returns empty string when no tables', () => {
    expect(htmlToTables('<p>no table</p>')).toBe('');
  });
});
