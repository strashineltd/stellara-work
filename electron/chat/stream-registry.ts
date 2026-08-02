/**
 * Keeps the main-process state for active chat streams.
 *
 * A pending approval belongs to exactly one stream. This prevents cancelling
 * or completing one chat from accidentally releasing approvals in another.
 */
export class ChatStreamRegistry {
  private readonly controllers = new Map<string, AbortController>();
  private readonly approvals = new Map<string, {
    streamId: string;
    resolve: (approved: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  start(streamId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(streamId, controller);
    return controller;
  }

  getSignal(streamId: string): AbortSignal | undefined {
    return this.controllers.get(streamId)?.signal;
  }

  requestApproval(
    streamId: string,
    approvalId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    if (this.controllers.get(streamId)?.signal.aborted) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const settle = (approved: boolean) => {
        const entry = this.approvals.get(approvalId);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.approvals.delete(approvalId);
        resolve(approved);
      };
      const timer = setTimeout(() => settle(false), timeoutMs);
      this.approvals.set(approvalId, { streamId, resolve: settle, timer });
    });
  }

  respond(approvalId: string, approved: boolean): boolean {
    const entry = this.approvals.get(approvalId);
    if (!entry) return false;
    entry.resolve(approved);
    return true;
  }

  abort(streamId: string): boolean {
    const controller = this.controllers.get(streamId);
    if (!controller) return false;
    // Resolve first so an Agent blocked in onApproval can leave its await.
    this.settleApprovalsForStream(streamId, false);
    controller.abort();
    return true;
  }

  cleanup(streamId: string): void {
    this.settleApprovalsForStream(streamId, false);
    this.controllers.delete(streamId);
  }

  private settleApprovalsForStream(streamId: string, approved: boolean): void {
    for (const entry of this.approvals.values()) {
      if (entry.streamId === streamId) {
        entry.resolve(approved);
      }
    }
  }
}
