/**
 * Normalizes foreach/aggregate inputs into a plain array.
 * Accepts arrays directly or common wrapper shapes such as
 * `{ items: [...] }`, `{ files: [...] }`, or nested `result` objects.
 */
export function normalizeCollectionInput(raw: unknown): any[] | null {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, any>;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.files)) return obj.files;

  const result = obj.result;
  if (result && typeof result === 'object') {
    if (Array.isArray(result.items)) return result.items;
    if (Array.isArray(result.files)) return result.files;
  }

  return null;
}
