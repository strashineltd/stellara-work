import { contextBridge, ipcRenderer } from 'electron';
import type {
  ElectronAPI,
  ChatRequest,
  ChatStreamEvent,
  AppInfo,
  ModelConfig,
  ModelListResponse,
  ToolName,
  ToolArgs,
  ToolResult,
} from '../shared/ipc';

/**
 * Preload 脚本
 *
 * 用 contextBridge 暴露受限的 electronAPI 给渲染进程。
 * 渲染进程拿不到原始 ipcRenderer / node 模块，只能通过这个白名单 API。
 */

// 内部工具：创建一个与 streamId 绑定的 AsyncIterable
function makeStreamIterator<T>(channel: string, filter: (payload: any) => boolean): AsyncIterable<T> {
  const queue: T[] = [];
  const resolvers: Array<(v: IteratorResult<T>) => void> = [];
  let closed = false;

  const handler = (_e: unknown, payload: any) => {
    if (!filter(payload)) return;
    if (closed) return;
    const event = payload.event as T;
    if (resolvers.length > 0) {
      const r = resolvers.shift()!;
      r({ value: event, done: false });
    } else {
      queue.push(event);
    }
  };

  ipcRenderer.on(channel, handler);

  // done 事件（payload.event.type === 'done'）关闭流
  const closer = (_e: unknown, payload: any) => {
    if (filter(payload) && payload?.event?.type === 'done') {
      closed = true;
      ipcRenderer.removeListener(channel, handler);
      ipcRenderer.removeListener(channel, closer);
      while (resolvers.length > 0) {
        const r = resolvers.shift()!;
        r({ value: undefined as unknown as T, done: true });
      }
    }
  };
  ipcRenderer.on(channel, closer);

  return {
    [Symbol.asyncIterator]() {
      return {
        next: (): Promise<IteratorResult<T>> => {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as T, done: true });
          }
          return new Promise((resolve) => resolvers.push(resolve));
        },
      };
    },
  };
}

const api: ElectronAPI = {
  app: {
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo'),
  },
  models: {
    list: (): Promise<ModelListResponse> => ipcRenderer.invoke('models:list'),
    configure: (config: ModelConfig) => ipcRenderer.invoke('models:configure', config),
    test: (config: ModelConfig) => ipcRenderer.invoke('models:test', config),
  },
  chat: {
    start: async (request: ChatRequest): Promise<{ streamId: string; events: AsyncIterable<ChatStreamEvent> }> => {
      const { streamId } = await ipcRenderer.invoke('chat:start', request);
      const events = makeStreamIterator<ChatStreamEvent>(
        'chat-stream',
        (payload) => payload?.streamId === streamId,
      );
      return { streamId, events };
    },
    cancel: () => {
      // W2 不实现：暂时 noop
    },
  },
  tools: {
    invoke: (name: ToolName, args: ToolArgs): Promise<ToolResult> =>
      ipcRenderer.invoke('tools:invoke', name, args),
  },
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
