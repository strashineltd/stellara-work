// tabs.test.ts
import { describe, it, expect } from 'vitest';
import { TabPool } from './tabs';
describe('TabPool', () => {
  it('LRU evicts oldest beyond 5', () => {
    const p = new TabPool(5);
    for (let i = 0; i < 6; i++) p.create('s1', `https://ex.com/${i}`);
    expect(p.list('s1')).toHaveLength(5);
    expect(p.list('s1')[0]!.url).toBe('https://ex.com/1');
  });

  it('create returns the evicted tab when over capacity', () => {
    const p = new TabPool(2);
    const a = p.create('s1', 'https://a.com/');
    const b = p.create('s1', 'https://b.com/');
    const c = p.create('s1', 'https://c.com/');
    expect(a.tab.url).toBe('https://a.com/');
    expect(b.tab.url).toBe('https://b.com/');
    expect(c.evicted?.url).toBe('https://a.com/');
    expect(p.list('s1')).toHaveLength(2);
  });
});
