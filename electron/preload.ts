import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI, ChatRequest, ChatStreamEvent } from '../shared/ipc';

/**
 * Preload 脚本
 *
 * 用 contextBridge 暴露受限的 electronAPI 给渲染进程。
 * 渲染进程拿不到原始 ipcRenderer / node 模块，只能通过这个白名单 API。
 */
const api: ElectronAPI = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    configure: (config) => ipcRenderer.invoke('models:configure', config),
    test: (config) => ipcRenderer.invoke('models:test', config),
  },
  chat: {
    send: async (request: ChatRequest): Promise<AsyncIterable<ChatStreamEvent>> => {
      // 返回一个 async iterable，渲染进程 for await 消费
      return (async function* () {
        // 一次性拿到所有事件（v0.9 简化：W1 不做实时流推送）
        // 等 W2 接 WebSocket / EventEmitter 改成真正的流
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const events: ChatStreamEvent[] = await (ipcRenderer as any).invoke('chat:send', request);
        for (const event of events) {
          yield event;
        }
      })();
    },
    cancel: () => {
      // W1 不实现：暂时 noop
    },
  },
  tools: {
    invoke: (name, args) => ipcRenderer.invoke('tools:invoke', name, args),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
