import type { ModelConfig, WireApi } from '../../shared/ipc';
import { inferWireApiFromUrl } from '../../shared/ipc';
import { extractResponseText } from '../../shared/responses';
import { AnthropicClient } from './anthropic';
import { ResponsesClient } from './responses';

export function resolveWireApi(config: Pick<ModelConfig, 'wireApi' | 'baseUrl'>): WireApi {
  return config.wireApi ?? inferWireApiFromUrl(config.baseUrl);
}

export async function testModelConnection(
  config: Pick<ModelConfig, 'wireApi' | 'baseUrl' | 'apiKey' | 'model'>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  if (resolveWireApi(config) === 'anthropic') {
    return new AnthropicClient(config).ping(signal);
  }
  return new ResponsesClient(config).ping(signal);
}

export async function summarizeWithModel(
  config: Pick<ModelConfig, 'wireApi' | 'baseUrl' | 'apiKey' | 'model' | 'maxOutputTokens'>,
  systemPrompt: string,
  userMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  if (resolveWireApi(config) === 'anthropic') {
    const response = await new AnthropicClient(config).create({
      model: config.model,
      max_tokens: Math.min(config.maxOutputTokens ?? 2048, 4096),
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }, signal);
    return response.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('');
  }

  const response = await new ResponsesClient(config).create({
    model: config.model,
    instructions: systemPrompt,
    input: userMessage,
    stream: false,
    store: false,
    max_output_tokens: Math.min(config.maxOutputTokens ?? 2048, 4096),
  }, signal);
  return extractResponseText(response);
}
