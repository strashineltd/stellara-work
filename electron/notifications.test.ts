import { describe, it, expect } from 'vitest';
import { taskEndNotificationText } from './notifications';

describe('taskEndNotificationText', () => {
  it('notifies on completed task', () => {
    const t = taskEndNotificationText({ completed: true, failed: false, aborted: false });
    expect(t).not.toBeNull();
    expect(t?.title).toContain('完成');
  });

  it('notifies on failed task', () => {
    const t = taskEndNotificationText({ completed: false, failed: true, aborted: false });
    expect(t).not.toBeNull();
    expect(t?.title).toContain('失败');
  });

  it('notifies on abort', () => {
    const t = taskEndNotificationText({ completed: false, failed: false, aborted: true });
    expect(t).not.toBeNull();
    expect(t?.title).toContain('取消');
  });

  it('returns null when nothing remarkable happened', () => {
    expect(taskEndNotificationText({ completed: false, failed: false, aborted: false })).toBeNull();
  });

  it('prioritizes abort over completion', () => {
    const t = taskEndNotificationText({ completed: true, failed: true, aborted: true });
    expect(t?.title).toContain('取消');
  });
});
