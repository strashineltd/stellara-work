import { describe, expect, it } from 'vitest';
import {
  buildResponsesUrl,
  extractResponseText,
  extractFunctionCalls,
  buildFunctionCallOutput,
} from './responses';
import type {
  ResponseObject,
  ResponseItem,
  ResponseFunctionTool,
  CreateResponseRequest,
  ResponseStreamEvent,
  ProviderCapability,
  ResponseUsage,
} from './responses';

describe('buildResponsesUrl', () => {
  it('追加 /responses 到普通 URL', () => {
    expect(buildResponsesUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/responses');
    expect(buildResponsesUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/responses',
    );
  });

  it('已有 /responses 结尾时原样返回', () => {
    expect(buildResponsesUrl('https://example.com/v1/responses')).toBe('https://example.com/v1/responses');
  });

  it('移除末尾斜杠', () => {
    expect(buildResponsesUrl('https://example.com/')).toBe('https://example.com/responses');
    expect(buildResponsesUrl('https://example.com/v1/')).toBe('https://example.com/v1/responses');
  });

  it('保留已有 /responses 后的斜杠', () => {
    expect(buildResponsesUrl('https://example.com/responses/')).toBe('https://example.com/responses');
  });

  it('不自动补 /v1', () => {
    expect(buildResponsesUrl('https://open.bigmodel.cn/api')).toBe(
      'https://open.bigmodel.cn/api/responses',
    );
  });

  it('空字符串抛错', () => {
    expect(() => buildResponsesUrl('')).toThrow('baseUrl 不能为空');
    expect(() => buildResponsesUrl('  ')).toThrow('baseUrl 不能为空');
  });
});

describe('extractResponseText', () => {
  it('提取 output_text', () => {
    const response: ResponseObject = {
      id: 'resp_001',
      object: 'response',
      model: 'deepseek-v4-pro',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello ' }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'world!' }],
        },
      ],
    };
    expect(extractResponseText(response)).toBe('Hello world!');
  });

  it('空 output 返回空字符串', () => {
    const response: ResponseObject = {
      id: 'resp_002',
      object: 'response',
      model: 'test',
      status: 'completed',
      output: [],
    };
    expect(extractResponseText(response)).toBe('');
  });
});

describe('extractFunctionCalls', () => {
  it('提取 function_call 项', () => {
    const response: ResponseObject = {
      id: 'resp_003',
      object: 'response',
      model: 'test',
      status: 'completed',
      output: [
        { type: 'function_call', call_id: 'call_001', name: 'read_file', arguments: '{"path":"/test"}' },
        { type: 'function_call', call_id: 'call_002', name: 'write_file', arguments: '{"path":"/out"}' },
      ],
    };
    const calls = extractFunctionCalls(response);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.name).toBe('read_file');
    expect(calls[1]!.name).toBe('write_file');
  });

  it('无 function_call 返回空数组', () => {
    const response: ResponseObject = {
      id: 'resp_004',
      object: 'response',
      model: 'test',
      status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
      ],
    };
    expect(extractFunctionCalls(response)).toHaveLength(0);
  });
});

describe('buildFunctionCallOutput', () => {
  it('构建 function_call_output item', () => {
    const item = buildFunctionCallOutput('call_001', '{"ok":true}');
    expect(item).toEqual({
      type: 'function_call_output',
      call_id: 'call_001',
      output: '{"ok":true}',
    });
  });
});

describe('ResponseItem 类型结构', () => {
  it('ResponseMessageItem 结构正确', () => {
    const item: ResponseItem = {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'test' }],
      status: 'completed',
    };
    expect(item.type).toBe('message');
    expect(item.role).toBe('assistant');
  });

  it('ResponseReasoningItem 结构正确', () => {
    const item: ResponseItem = {
      type: 'reasoning',
      content: [{ type: 'reasoning_text', text: 'thinking...' }],
      status: 'completed',
    };
    expect(item.type).toBe('reasoning');
  });

  it('ResponseFunctionCallItem 结构正确', () => {
    const item: ResponseItem = {
      type: 'function_call',
      call_id: 'call_001',
      name: 'test_tool',
      arguments: '{}',
      status: 'completed',
    };
    expect(item.type).toBe('function_call');
    expect(item.call_id).toBe('call_001');
  });

  it('ResponseFunctionCallOutputItem 结构正确', () => {
    const item: ResponseItem = {
      type: 'function_call_output',
      call_id: 'call_001',
      output: 'result',
    };
    expect(item.type).toBe('function_call_output');
  });
});

describe('ResponseFunctionTool', () => {
  it('扁平工具结构', () => {
    const tool: ResponseFunctionTool = {
      type: 'function',
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      strict: false,
    };
    expect(tool.type).toBe('function');
    expect(tool.name).toBe('read_file');
    expect(tool.strict).toBe(false);
  });
});

describe('CreateResponseRequest', () => {
  it('请求结构包含必要字段', () => {
    const req: CreateResponseRequest = {
      model: 'deepseek-v4-pro',
      input: 'test',
      stream: false,
      store: false,
    };
    expect(req.store).toBe(false);
    expect(req.stream).toBe(false);
  });

  it('支持 ResponseItem[] 输入', () => {
    const req: CreateResponseRequest = {
      model: 'deepseek-v4-pro',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'test' }] },
      ],
      stream: true,
      store: false,
      tools: [
        { type: 'function', name: 'test', description: 'test', parameters: {}, strict: false },
      ],
    };
    expect(Array.isArray(req.input)).toBe(true);
    expect(req.tools).toHaveLength(1);
  });
});

describe('ResponseStreamEvent', () => {
  it('支持所有必要事件类型', () => {
    const types: ResponseStreamEvent['type'][] = [
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.output_item.done',
      'response.content_part.added',
      'response.content_part.done',
      'response.output_text.delta',
      'response.output_text.done',
      'response.reasoning_text.delta',
      'response.reasoning_text.done',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
      'response.completed',
      'response.incomplete',
      'response.failed',
    ];
    expect(types).toHaveLength(15);
  });
});

describe('ProviderCapability', () => {
  it('包含所有必要字段', () => {
    const cap: ProviderCapability = {
      modelId: 'deepseek-v4-pro',
      baseUrl: 'https://api.deepseek.com',
      responsesSupported: true,
      textStream: true,
      functionCall: true,
      parallelFunctionCall: true,
      functionOutput: true,
      usage: true,
      reasoning: true,
      abort: true,
      reasoningEffort: true,
      strictTools: false,
      contextWindow: 128000,
      maxOutputTokens: 16384,
      verifiedAt: '2026-08-19T12:00:00Z',
    };
    expect(cap.responsesSupported).toBe(true);
    expect(cap.contextWindow).toBe(128000);
  });
});

describe('ResponseUsage', () => {
  it('包含基础 token 字段', () => {
    const usage: ResponseUsage = {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    };
    expect(usage.total_tokens).toBe(150);
  });

  it('支持 cached_tokens 和 reasoning_tokens', () => {
    const usage: ResponseUsage = {
      input_tokens: 200,
      output_tokens: 80,
      total_tokens: 280,
      input_tokens_details: { cached_tokens: 50 },
      output_tokens_details: { reasoning_tokens: 30 },
    };
    expect(usage.input_tokens_details?.cached_tokens).toBe(50);
    expect(usage.output_tokens_details?.reasoning_tokens).toBe(30);
  });
});
