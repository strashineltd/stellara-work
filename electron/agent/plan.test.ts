import { describe, it, expect } from 'vitest';
import { BUILD_MODE_SYSTEM_PROMPT, getSystemPrompt, platformPromptBlock } from './plan';

describe('BUILD_MODE_SYSTEM_PROMPT', () => {
  it('contains core rules', () => {
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('先读后改');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('先搜后读');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('改完必验');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('需求不明先澄清');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('行动先说明');
  });

  it('contains verification guidance', () => {
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('测试/构建/类型检查');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('重新 read_file 通读确认');
  });

  it('lists all tool names', () => {
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('edit_file');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('search_content');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('git_status');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('task_complete');
  });

  it('documents network exit and approval-gated project scripts', () => {
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('web_fetch');
    expect(BUILD_MODE_SYSTEM_PROMPT).toMatch(/审批/);
    expect(BUILD_MODE_SYSTEM_PROMPT).toMatch(/项目代码|项目内代码/);
  });
});

describe('platformPromptBlock', () => {
  it('describes macOS arm64 environment with POSIX conventions', () => {
    const block = platformPromptBlock({ platform: 'darwin', arch: 'arm64' });
    expect(block).toContain('macOS');
    expect(block).toContain('Apple 芯片 arm64');
    expect(block).toContain('POSIX');
    expect(block).toContain('swift');
    expect(block).toContain('osascript');
  });

  it('does not advertise removed executables (corepack/rustup/open)', () => {
    const block = platformPromptBlock({ platform: 'darwin', arch: 'arm64' });
    const available = block.match(/可用 macOS 开发工具：[^\n]*/)?.[0] ?? '';
    expect(available).toContain('swift');
    expect(available).not.toContain('open');
    expect(available).not.toContain('rustup');
    expect(available).not.toContain('corepack');
  });

  it('describes macOS Intel with x64', () => {
    const block = platformPromptBlock({ platform: 'darwin', arch: 'x64' });
    expect(block).toContain('Intel x64');
  });

  it('describes Windows environment', () => {
    const block = platformPromptBlock({ platform: 'win32', arch: 'x64' });
    expect(block).toContain('Windows');
    expect(block).toContain('npm');
  });

  it('injects platform block into system prompt', () => {
    const prompt = getSystemPrompt(false, { platform: 'darwin', arch: 'arm64' });
    expect(prompt).toContain('当前运行环境');
    expect(prompt).toContain('Apple 芯片 arm64');
    expect(prompt).toContain(BUILD_MODE_SYSTEM_PROMPT);
  });

  it('keeps skill prompt after platform block', () => {
    const prompt = getSystemPrompt(false, { platform: 'darwin', arch: 'arm64' }, undefined, {
      name: 'test-skill',
      prompt: 'do the thing',
    } as never);
    expect(prompt).toContain('test-skill');
    expect(prompt.indexOf('当前运行环境')).toBeLessThan(prompt.indexOf('test-skill'));
  });
});
