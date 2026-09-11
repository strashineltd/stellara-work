import { useCallback, useEffect, useState } from 'react';
import type { ServerEntry, ServerStatusEntry } from '../../shared/ipc';

export interface UseServersResult {
  servers: ServerEntry[];
  statuses: ServerStatusEntry[];
  refresh: () => void;
}

/**
 * 服务器列表 + 运行时状态：挂载时加载、订阅主进程状态广播（按 id 合并）、暴露手动刷新。
 * `electronAPI.servers` 缺失（非 Electron 测试桩 / 旧环境）时保持空态且不订阅。
 */
export function useServers(): UseServersResult {
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [statuses, setStatuses] = useState<ServerStatusEntry[]>([]);

  const refresh = useCallback(() => {
    void (async () => {
      const api = window.electronAPI?.servers;
      if (!api) return;
      try {
        const [list, statusList] = await Promise.all([api.list(), api.status()]);
        setServers(list);
        setStatuses(statusList);
      } catch {
        /* 列表/状态加载失败时保留已有数据 */
      }
    })();
  }, []);

  useEffect(() => {
    refresh();
    const api = window.electronAPI?.servers;
    if (!api) return;
    return api.onStatusChanged((incoming) => {
      setStatuses((prev) => {
        const next = [...prev];
        for (const entry of incoming) {
          const index = next.findIndex((item) => item.id === entry.id);
          if (index === -1) next.push(entry);
          else next[index] = entry;
        }
        return next;
      });
    });
  }, [refresh]);

  return { servers, statuses, refresh };
}
