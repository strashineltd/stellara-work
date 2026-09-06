import { describe, it, expect, vi } from 'vitest';
import { DuckHtmlProvider } from '../../browser/search-providers';

describe('DuckHtmlProvider', () => {
  it('parses html results without network', async () => {
    const html = '<a class="result__a" href="https://ex.com/a">T1</a><a class="result-snippet">S1</a>';
    const p = new DuckHtmlProvider(async () => html);
    const res = await p.search('hello', 5);
    expect(res[0]!.url).toContain('ex.com');
    expect(res[0]!.title).toBe('T1');
  });
});
