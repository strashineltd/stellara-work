import { contextBridge, ipcRenderer } from 'electron';
import type {
  ElectronAPI,
  ChatRequest,
  ChatStreamEvent,
  AppInfo,
  ModelConfig,
  ModelListResponse,
  ModelListItem,
  ToolName,
  ToolArgs,
  ToolResult,
  Session,
  SessionSummary,
  MessageRow,
  CreateSessionArgs,
  AppSettings,
  FsNode,
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
    getAll: (): Promise<ModelListItem[]> => ipcRenderer.invoke('models:getAll'),
    configure: (config: ModelConfig) => ipcRenderer.invoke('models:configure', config),
    test: (config: ModelConfig) => ipcRenderer.invoke('models:test', config),
    remove: (modelId: string) => ipcRenderer.invoke('models:remove', modelId),
    setActive: (modelId: string) => ipcRenderer.invoke('models:setActive', modelId),
    updateKey: (modelId: string, newKey: string) => ipcRenderer.invoke('models:updateKey', modelId, newKey),
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
  sessions: {
    list: (): Promise<SessionSummary[]> => ipcRenderer.invoke('sessions:list'),
    get: (id: string) => ipcRenderer.invoke('sessions:get', id),
    create: (args: CreateSessionArgs): Promise<Session> => ipcRenderer.invoke('sessions:create', args),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    rename: (id: string, title: string) => ipcRenderer.invoke('sessions:rename', id, title),
    saveMessages: (id: string, messages: MessageRow[]) =>
      ipcRenderer.invoke('sessions:saveMessages', id, messages),
    appendMessage: (id: string, message: MessageRow) =>
      ipcRenderer.invoke('sessions:appendMessage', id, message),
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (partial: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', partial),
    clearAllData: () => ipcRenderer.invoke('settings:clearAllData'),
    openDataDir: () => ipcRenderer.invoke('settings:openDataDir'),
    openLogFile: (name: 'main' | 'renderer') => ipcRenderer.invoke('settings:openLogFile', name),
  },
  fs: {
    listTree: (cwd: string, maxDepth?: number): Promise<FsNode> =>
      ipcRenderer.invoke('fs:listTree', cwd, maxDepth),
    readFile: (workDir: string, filePath: string, maxBytes?: number) =>
      ipcRenderer.invoke('fs:readFile', workDir, filePath, maxBytes),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
