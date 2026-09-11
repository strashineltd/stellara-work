/**
 * 真实服务端冒烟脚本（Plan 2A / Task 10）。
 *
 * 用法:
 *   npx tsx scripts/verify-server.ts <baseUrl> [username] [password]
 *
 * 流程:
 *   health → listSessions 数量 → createSession('verify') → subscribeEvents
 *   → promptAsync「你好」→ 等 session.idle（最多 30s）
 *   → 打印事件类型计数与助手文本 → finally 删除会话。
 *
 * 退出码: 0 成功 / 1 冒烟失败 / 2 参数错误。密码不会被打印。
 */

import { EventAdapter } from '../electron/server/event-adapter';
import { OpencodeClient } from '../electron/server/opencode-client';
import type { RemoteEvent } from '../electron/server/types';

const IDLE_TIMEOUT_MS = 30_000;

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof AggregateError && cause.errors.length > 0) {
    const details = cause.errors
      .map((item: unknown) => (item instanceof Error ? item.message : String(item)))
      .join('；');
    return `${error.message}（${details}）`;
  }
  if (cause instanceof Error && cause.message) return `${error.message}（${cause.message}）`;
  return error.message;
}

function usage(): never {
  console.error('用法: npx tsx scripts/verify-server.ts <baseUrl> [username] [password]');
  process.exit(2);
}

async function main(): Promise<void> {
  const baseUrl = process.argv[2];
  if (!baseUrl) usage();
  const username = process.argv[3];
  const password = process.argv[4];

  const client = new OpencodeClient({ baseUrl, username, password });
  const adapter = new EventAdapter();

  console.log(`▶ 冒烟目标: ${baseUrl}`);

  const health = await client.health();
  if (health.healthy === false) throw new Error('health 返回 healthy=false');
  console.log(
    `✓ health: healthy=${String(health.healthy ?? true)}${health.version ? ` version=${health.version}` : ''}`,
  );

  const sessionsBefore = await client.listSessions();
  console.log(`✓ listSessions: ${sessionsBefore.length} 个会话`);

  const session = await client.createSession('verify');
  console.log(`✓ createSession: ${session.id}`);

  const counts = new Map<string, number>();
  const sequence: string[] = [];
  let assistantText = '';
  let remoteError: string | null = null;
  let resolveIdle: (() => void) | null = null;
  const idle = new Promise<void>((resolve) => {
    resolveIdle = resolve;
  });

  const unsubscribe = client.subscribeEvents(
    (event: RemoteEvent) => {
      const adapted = adapter.handle(event);
      if (adapted.sessionID !== undefined && adapted.sessionID !== session.id) return;
      for (const item of adapted.events) {
        counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
        sequence.push(item.type);
        if (item.type === 'content' && item.content) assistantText += item.content;
        if (item.type === 'error') remoteError = remoteError ?? item.error ?? 'Unknown error';
        if (item.type === 'done') resolveIdle?.();
      }
    },
    (status) => console.log(`  [sse] ${status}`),
  );

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await client.promptAsync(session.id, { parts: [{ type: 'text', text: '你好' }] });
    console.log('✓ promptAsync: 已发送「你好」，等待 session.idle…');

    const outcome = await Promise.race([
      idle.then(() => 'idle' as const),
      new Promise<'timeout'>((resolve) => {
        idleTimer = setTimeout(() => resolve('timeout'), IDLE_TIMEOUT_MS);
      }),
    ]);
    if (idleTimer !== undefined) clearTimeout(idleTimer);

    console.log('');
    console.log(`▶ 事件类型计数（共 ${sequence.length} 条适配事件）:`);
    for (const [type, count] of counts) console.log(`  ${type}: ${count}`);
    console.log(`▶ 事件序列: ${sequence.length > 0 ? sequence.join(' → ') : '(无)'}`);
    console.log(`▶ 助手文本（${assistantText.length} 字符）:`);
    console.log(assistantText.length > 0 ? assistantText : '(空)');

    if (remoteError !== null) throw new Error(`收到 session.error: ${remoteError}`);
    if (outcome === 'timeout') throw new Error(`等待 session.idle 超时（${IDLE_TIMEOUT_MS / 1000}s）`);
    if (!counts.has('done')) throw new Error('未收到 done 事件（session.idle）');
    if (!counts.has('content')) console.warn('⚠ 未收到 content 事件（助手文本为空）');
    console.log('✓ 冒烟通过');
  } finally {
    unsubscribe();
    try {
      await client.deleteSession(session.id);
      console.log(`✓ deleteSession: ${session.id}`);
    } catch (error) {
      console.warn(`⚠ deleteSession 失败: ${describeError(error)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`✗ 冒烟失败: ${describeError(error)}`);
    process.exit(1);
  });
