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
});
