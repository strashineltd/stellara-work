import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('tokens.css', () => {
  const tokens = readFileSync(resolve(__dirname, 'tokens.css'), 'utf-8');

  const REQUIRED = [
    '--color-bg-app', '--color-bg-sidebar', '--color-bg-content',
    '--color-bg-elevated', '--color-bg-input',
    '--color-text', '--color-text-soft',
    '--color-border', '--color-border-strong',
    '--color-primary', '--color-accent', '--color-accent-soft',
    '--color-success', '--color-warning', '--color-danger', '--color-info',
    '--font-sans', '--font-mono',
    '--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-lg', '--fs-xl',
    '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6',
    '--radius-sm', '--radius-md', '--radius-lg',
  ];

  it.each(REQUIRED)(`defines %s`, (token) => {
    const re = new RegExp(`${token}\\s*:`, 'm');
    expect(tokens, `missing token ${token}`).toMatch(re);
  });

  it('defines a [data-theme="dark"] block with overrides', () => {
    expect(tokens).toMatch(/\[data-theme="dark"\]\s*\{/);
  });
});