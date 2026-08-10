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
  Memory,
  MenuAction,
  McpServerConfig,
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

  // terminal 事件关闭流，避免 error 路径遗留 renderer listener。
  const closer = (_e: unknown, payload: any) => {
    if (filter(payload) && (payload?.event?.type === 'done' || payload?.event?.type === 'error')) {
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
    openSettingsWindow: (tab?: string) => ipcRenderer.invoke('settings:openWindow', tab),
    onSettingsChanged: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('settings-changed', handler);
      return () => {
        ipcRenderer.removeListener('settings-changed', handler);
      };
    },
  },
  models: {
    list: (): Promise<ModelListResponse> => ipcRenderer.invoke('models:list'),
    getAll: (): Promise<ModelListItem[]> => ipcRenderer.invoke('models:getAll'),
    configure: (config: ModelConfig) => ipcRenderer.invoke('models:configure', config),
    test: (config: ModelConfig) => ipcRenderer.invoke('models:test', config),
    remove: (modelId: string) => ipcRenderer.invoke('models:remove', modelId),
    setActive: (modelId: string) => ipcRenderer.invoke('models:setActive', modelId),
    updateKey: (modelId: string, newKey: string) => ipcRenderer.invoke('models:updateKey', modelId, newKey),
    updateWorkDir: (modelId: string, workDir: string) => ipcRenderer.invoke('models:updateWorkDir', modelId, workDir),
    updateContextWindow: (modelId: string, contextWindow: number) =>
      ipcRenderer.invoke('models:updateContextWindow', modelId, contextWindow),
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
    abort: (streamId: string) => {
      ipcRenderer.send('chat:abort', streamId);
    },
    approve: (approvalId: string, approved: boolean) => {
      ipcRenderer.send('approval:respond', approvalId, approved);
    },
  },
  tools: {
    invoke: (name: ToolName, args: ToolArgs): Promise<ToolResult> =>
      ipcRenderer.invoke('tools:invoke', name, args),
  },
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
    openFile: (workDir: string): Promise<string | null> => ipcRenderer.invoke('dialog:openFile', workDir),
    selectProjectFile: () => ipcRenderer.invoke('dialog:selectProjectFile'),
    selectProjectDir: () => ipcRenderer.invoke('dialog:selectProjectDir'),
    createProjectFile: () => ipcRenderer.invoke('dialog:createProjectFile'),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (args: { name: string; workDir: string; entryFile?: string }) => ipcRenderer.invoke('projects:create', args),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id),
    rename: (id: string, name: string) => ipcRenderer.invoke('projects:rename', id, name),
    updateFile: (id: string, selection: { path: string; workDir: string }) => ipcRenderer.invoke('projects:updateFile', id, selection),
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
    move: (sessionId: string, projectId: string | null) =>
      ipcRenderer.invoke('sessions:move', sessionId, projectId),
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (partial: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', partial),
    clearAllData: () => ipcRenderer.invoke('settings:clearAllData'),
    resetSelective: (level: 'sessions' | 'memories' | 'all') =>
      ipcRenderer.invoke('settings:resetSelective', level),
    openDataDir: () => ipcRenderer.invoke('settings:openDataDir'),
    openLogFile: (name: 'main' | 'renderer') => ipcRenderer.invoke('settings:openLogFile', name),
    collectDiagnostics: () => ipcRenderer.invoke('settings:collectDiagnostics'),
  },
  skills: {
    list: (workDir: string) => ipcRenderer.invoke('skills:list', workDir),
    listDetailed: (workDir: string) => ipcRenderer.invoke('skills:listDetailed', workDir),
    create: (workDir: string, skill: { name: string; description: string; prompt: string }) =>
      ipcRenderer.invoke('skills:create', workDir, skill),
    update: (workDir: string, file: string, patch: { name?: string; description?: string; prompt?: string; enabled?: boolean }) =>
      ipcRenderer.invoke('skills:update', workDir, file, patch),
    delete: (workDir: string, file: string) => ipcRenderer.invoke('skills:delete', workDir, file),
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    add: (cfg: McpServerConfig) => ipcRenderer.invoke('mcp:add', cfg),
    update: (id: string, patch: Partial<McpServerConfig>) => ipcRenderer.invoke('mcp:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('mcp:remove', id),
    test: (cfg: McpServerConfig) => ipcRenderer.invoke('mcp:test', cfg),
  },
  fs: {
    listTree: (cwd: string, maxDepth?: number): Promise<FsNode> =>
      ipcRenderer.invoke('fs:listTree', cwd, maxDepth),
    readFile: (workDir: string, filePath: string, maxBytes?: number) =>
      ipcRenderer.invoke('fs:readFile', workDir, filePath, maxBytes),
    openPath: (workDir: string, filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('fs:openPath', workDir, filePath),
    createFile: (workDir: string, relativePath: string): Promise<{ path: string }> =>
      ipcRenderer.invoke('fs:createFile', workDir, relativePath),
  },
  memory: {
    search: (query: string, options?: { scope?: Memory['scope']; kind?: Memory['kind']; limit?: number }) =>
      ipcRenderer.invoke('memory:search', query, options),
    list: (options?: { scope?: Memory['scope']; kind?: Memory['kind']; limit?: number; offset?: number }) =>
      ipcRenderer.invoke('memory:list', options),
    save: (memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>) =>
      ipcRenderer.invoke('memory:save', memory),
    update: (id: string, patch: { content?: string; importance?: number; tags?: string[] }) =>
      ipcRenderer.invoke('memory:update', id, patch),
    delete: (id: string) =>
      ipcRenderer.invoke('memory:delete', id),
    stats: () =>
      ipcRenderer.invoke('memory:stats'),
    exportSingle: (id: string) => ipcRenderer.invoke('memory:exportSingle', id),
    exportAll: () => ipcRenderer.invoke('memory:exportAll'),
    copyMd: (id: string) => ipcRenderer.invoke('memory:copyMd', id),
    onExtracted: (callback: (info: { sessionId: string; count: number }) => void) => {
      const handler = (_e: unknown, info: { sessionId: string; count: number }) => callback(info);
      ipcRenderer.on('memories-extracted', handler);
      return () => {
        ipcRenderer.removeListener('memories-extracted', handler);
      };
    },
  },
  menu: {
    onAction: (callback: (action: MenuAction) => void) => {
      const handler = (_e: unknown, action: MenuAction) => callback(action);
      ipcRenderer.on('menu:action', handler);
      return () => {
        ipcRenderer.removeListener('menu:action', handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
