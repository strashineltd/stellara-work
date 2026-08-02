/**
 * LLM 错误分类器单元测试
 *
 * 用户报「API key 错误时给清晰引导」—— 分类器决定前端怎么渲染。
 */
import { describe, it, expect } from 'vitest';
import { classifyHttpError, classifyThrownError } from './error-classifier';

describe('classifyHttpError', () => {
  it('401 → auth', () => {
    const m = classifyHttpError(401, JSON.stringify({ error: { message: 'Invalid API key' } }));
    expect(m.kind).toBe('auth');
    expect(m.action).toBe('open_settings');
    expect(m.retryable).toBe(false);
    expect(m.hint).toContain('API key');
  });

  it('403 → auth', () => {
    expect(classifyHttpError(403, '{}').kind).toBe('auth');
  });

  it('429 → rate_limit (retryable)', () => {
    const m = classifyHttpError(429, '{"error":{"message":"Too many requests"}}');
    expect(m.kind).toBe('rate_limit');
    expect(m.retryable).toBe(true);
  });

  it('402 / quota text → quota', () => {
    const m = classifyHttpError(402, '{"error":{"message":"insufficient_quota"}}');
    expect(m.kind).toBe('quota');
    expect(m.action).toBe('switch_model');
  });

  it('404 → model_not_found', () => {
    const m = classifyHttpError(404, '{"error":{"message":"model_not_found"}}');
    expect(m.kind).toBe('model_not_found');
  });

  it('400 with context_length_exceeded → context_too_long', () => {
    const m = classifyHttpError(400, JSON.stringify({
      error: { message: 'context_length_exceeded: too many tokens', type: 'invalid_request_error' },
    }));
    expect(m.kind).toBe('context_too_long');
  });

  it('400 invalid_request_error → invalid_request', () => {
    const m = classifyHttpError(400, JSON.stringify({
      error: { message: 'messages with role tool must precede tool_calls', type: 'invalid_request_error' },
    }));
    expect(m.kind).toBe('invalid_request');
    expect(m.retryable).toBe(true);
  });

  it('500 → server', () => {
    expect(classifyHttpError(500, 'Internal Server Error').kind).toBe('server');
    expect(classifyHttpError(502, '').kind).toBe('server');
  });

  it('504 → network (gateway timeout, 用户体感是网络问题)', () => {
    expect(classifyHttpError(504, '').kind).toBe('network');
  });

  it('non-JSON body → 仍按 status 分类', () => {
    const m = classifyHttpError(401, '<html>Unauthorized</html>');
    expect(m.kind).toBe('auth');
  });

  it('unknown status → unknown', () => {
    const m = classifyHttpError(418, 'I am a teapot');
    expect(m.kind).toBe('unknown');
  });
});

describe('classifyThrownError', () => {
  it('idle abort reason → idle_timeout', () => {
    const m = classifyThrownError(new Error('流空闲超过 120s 未收到新数据'));
    expect(m.kind).toBe('idle_timeout');
  });

  it('first-chunk abort reason → idle_timeout', () => {
    const m = classifyThrownError(new Error('等待首块响应超过 30s'));
    expect(m.kind).toBe('idle_timeout');
  });

  it('user aborted → user_aborted', () => {
    expect(classifyThrownError(new Error('用户中断')).kind).toBe('user_aborted');
    expect(classifyThrownError(new Error('aborted')).kind).toBe('user_aborted');
  });

  it('fetch failed → network', () => {
    expect(classifyThrownError(new Error('fetch failed')).kind).toBe('network');
  });

  it('DNS failure → network', () => {
    expect(classifyThrownError(new Error('getaddrinfo ENOTFOUND api.deepseek.com')).kind).toBe('network');
    expect(classifyThrownError(new Error('connect ECONNREFUSED 127.0.0.1:443')).kind).toBe('network');
  });

  it('timeout → network', () => {
    expect(classifyThrownError(new Error('connect ETIMEDOUT')).kind).toBe('network');
  });

  it('unknown error → unknown', () => {
    const m = classifyThrownError(new Error('something weird'));
    expect(m.kind).toBe('unknown');
  });

  it('null/undefined → unknown (no throw)', () => {
    expect(classifyThrownError(null).kind).toBe('unknown');
    expect(classifyThrownError(undefined).kind).toBe('unknown');
  });
});