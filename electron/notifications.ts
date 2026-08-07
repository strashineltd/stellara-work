import { Notification } from 'electron';

export interface TaskEndState {
  completed: boolean;
  failed: boolean;
  aborted: boolean;
}

export interface NotificationText {
  title: string;
  body: string;
}

/**
 * 根据任务结束状态决定通知文案。
 * 返回 null 表示无需通知（如纯文本结尾）。
 */
export function taskEndNotificationText(state: TaskEndState): NotificationText | null {
  if (state.aborted) {
    return { title: '任务已取消', body: 'Agent 任务已被中止。' };
  }
  if (state.completed) {
    return { title: '任务已完成', body: 'Agent 已完成任务，可以查看结果了。' };
  }
  if (state.failed) {
    return { title: '任务失败', body: 'Agent 任务出错，请回到应用查看详情。' };
  }
  return null;
}

/**
 * 任务结束时的系统通知（macOS 通知中心 / Windows toast）。
 * 仅在应用未聚焦时发送，避免打扰正在看结果的用户。
 * click 回调用于点击通知时聚焦应用窗口。
 */
export function notifyTaskEnd(state: TaskEndState, onClick?: () => void): void {
  if (!Notification.isSupported()) return;
  const text = taskEndNotificationText(state);
  if (!text) return;
  try {
    const n = new Notification({ title: text.title, body: text.body });
    n.on('click', () => onClick?.());
    n.show();
  } catch {
    // 通知失败不影响主流程
  }
}
