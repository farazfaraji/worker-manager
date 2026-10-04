/**
 * Nodes that pick a single `true` or `false` edge, the same way `condition` does.
 * The runner reads `conditionMet` on the node output.
 */
export function usesBooleanBranch(nodeType: string, config: any): boolean {
  const type = String(nodeType || '').toLowerCase();
  const op = String(config?.operation || '').toLowerCase();
  const onFail = String(config?.onFail || 'fail').toLowerCase();
  if (type === 'condition') return true;
  if (type === 'log' && op === 'assert' && onFail === 'route') return true;
  if (type === 'file' && op === 'exists') return true;
  if (type === 'secrets' && op === 'exists') return true;
  if (type === 'database' && op === 'ping') return true;
  return false;
}
