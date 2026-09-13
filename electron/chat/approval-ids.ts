export function buildSubagentApprovalId(subagentId: string, now: number = Date.now()): string {
  const suffix = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `sub-${subagentId}-${now}-${suffix}`;
}
