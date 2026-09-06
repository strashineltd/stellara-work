import type { OpenAITool, BrowserActArgs } from '../../../shared/ipc';
import { webSearchTools } from './web-search';

export function validateActArgs(args: BrowserActArgs, knownIds: Set<string>): { ok: boolean; error?: string } {
  if (!args.tabId) return { ok: false, error: '缺少 tabId' };
  if (args.action === 'click' || args.action === 'hover' || args.action === 'select') {
    if (!args.targetId) return { ok: false, error: `${args.action} 需要 targetId（来自最近 snapshot）` };
    if (!knownIds.has(args.targetId)) return { ok: false, error: `未知 targetId: ${args.targetId}，请先 snapshot` };
  }
  if (args.action === 'type' && !((args.text ?? '').trim())) return { ok: false, error: 'type 需要 text' };
  if (args.text && args.text.length > 2000) return { ok: false, error: '输入文本超长（>2000）' };
  return { ok: true };
}

function def(name: string, description: string, parameters: Record<string, unknown>): OpenAITool {
  return { type: 'function', function: { name, description, parameters } };
}

export const browserOpenAITools: OpenAITool[] = [
  ...webSearchTools,
  def('browser_navigate', '导航到 http/https URL。新域名需用户审批。', { type: 'object', properties: { tabId: { type: 'string' }, url: { type: 'string' } }, required: ['url'], additionalProperties: false }),
  def('browser_snapshot', '获取当前页可访问性快照+链接id（只读）。', { type: 'object', properties: { tabId: { type: 'string' } }, required: ['tabId'], additionalProperties: false }),
  def('browser_act', '点击/输入/滚动/选择（每次需审批，targetId 必须来自 snapshot）。', { type: 'object', properties: { tabId: { type: 'string' }, action: { type: 'string' }, targetId: { type: 'string' }, text: { type: 'string' }, direction: { type: 'string' } }, required: ['tabId', 'action'], additionalProperties: false }),
  def('browser_extract', '结构化抽取正文/链接/表格（只读）。', { type: 'object', properties: { tabId: { type: 'string' }, kind: { type: 'string' } }, required: ['tabId', 'kind'], additionalProperties: false }),
  def('browser_screenshot', '截取当前页 PNG（限流）。', { type: 'object', properties: { tabId: { type: 'string' } }, required: ['tabId'], additionalProperties: false }),
  def('browser_tabs', '多 Tab 管理 list/create/close/select。', { type: 'object', properties: { op: { type: 'string' }, tabId: { type: 'string' }, url: { type: 'string' } }, required: ['op'], additionalProperties: false }),
  def('browser_exec_js', '受限 JS（默认关闭，需设置开启+每次审批）。', { type: 'object', properties: { tabId: { type: 'string' }, js: { type: 'string' } }, required: ['tabId', 'js'], additionalProperties: false }),
];

export const browserPlanTools: OpenAITool[] = [
  ...webSearchTools,
  browserOpenAITools.find(t => t.function.name === 'browser_snapshot')!,
  browserOpenAITools.find(t => t.function.name === 'browser_extract')!,
];
