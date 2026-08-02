/**
 * 一次性脚本：把 src/styles/global.css 里的硬编码颜色替换为 CSS variables。
 *
 * 用法：node scripts/theme-tokens.mjs
 *
 * 不会改 :root 和 [data-theme="dark"] 块里的内容（那是 token 定义本身）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(__dirname, '../src/styles/global.css');
const css = readFileSync(target, 'utf-8');

// 用临时占位符避开 :root 块（那里的 hex 是 token 定义本身）
// 简单粗暴：把 :root { ... } 和 [data-theme="dark"] { ... } 整块替换成不可
// 变标识，跑完替换后再还原。
const rootBlockRe = /(:root\s*\{[^}]*\}|\[data-theme="dark"\]\s*\{[^}]*\})/g;
const placeholders = [];
let masked = css.replace(rootBlockRe, (m) => {
  placeholders.push(m);
  return `__ROOT_BLOCK_${placeholders.length - 1}__`;
});

// 颜色 → token 映射
const map = [
  // accent 浅蓝底（hover / 选中 / 高亮）
  ['#e8f0ff', 'var(--color-accent-soft)'],
  ['#f0f5ff', 'var(--color-accent-soft)'],
  ['#fafbfc', 'var(--color-bg-elevated)'],
  ['#f8fbff', 'var(--color-bg-elevated)'],
  // 灰阶背景 / 边框
  ['#f5f5f5', 'var(--color-bg-soft)'],
  ['#e6e6e6', 'var(--color-border)'],
  ['#e5e5e5', 'var(--color-border)'],
  ['#cccccc', 'var(--color-border-strong)'],
  // 文字
  ['#999999', 'var(--color-text-soft)'],
  ['#999', 'var(--color-text-soft)'],
  ['#555555', 'var(--color-text-secondary)'],
  // 主背景 / 文字
  ['#ffffff', 'var(--color-bg)'],
  ['#fff', 'var(--color-bg)'],
  ['#1a1a1a', 'var(--color-text)'],
  ['#1e2530', 'var(--color-text)'],
  // 品牌色
  ['#2c3e50', 'var(--color-primary)'],
  ['#3b7def', 'var(--color-accent)'],
  // 错误 / 危险
  ['#d32f2f', 'var(--color-error)'],
  ['#b71c1c', 'var(--color-error-text)'],
  ['#ff8a80', 'var(--color-error-accent)'],
  ['#ffebe9', 'var(--color-error-bg)'],
  ['#fff8f8', 'var(--color-error-bg)'],
  ['#ffebee', 'var(--color-error-bg)'],
  ['#c7254e', 'var(--color-error-strong)'],
  // 警告
  ['#ffca28', 'var(--color-warning)'],
  ['#ffc107', 'var(--color-warning)'],
  ['#fff3cd', 'var(--color-warning-bg)'],
  ['#856404', 'var(--color-warning-text)'],
  // 成功
  ['#2e7d32', 'var(--color-success)'],
  ['#e8f5e9', 'var(--color-success-bg)'],
  ['#e6ffec', 'var(--color-success-bg)'],
  // 信息 / 代码
  ['#6f42c1', 'var(--color-info)'],
];

let updated = masked;
for (const [from, to] of map) {
  // 大小写不敏感匹配（CSS 大小写不敏感，但保险起见覆盖 #FFF 等）
  const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  updated = updated.replace(re, to);
}

// 还原 :root 块
updated = updated.replace(/__ROOT_BLOCK_(\d+)__/g, (_, i) => placeholders[Number(i)]);

// 写回
writeFileSync(target, updated, 'utf-8');

// 统计
const beforeCount = css.match(/#[0-9a-fA-F]{3,6}/g)?.length ?? 0;
const afterCount = updated.match(/#[0-9a-fA-F]{3,6}/g)?.length ?? 0;
console.log(`OK: ${beforeCount} hex literals → ${afterCount} (in non-token regions)`);
console.log('   :root + [data-theme="dark"] blocks preserved verbatim.');