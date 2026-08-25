const schemaCache = new Map<string, { schema: Record<string, unknown>; ts: number }>();
const SCHEMA_TTL = 45 * 60 * 1000;

export interface SchemaDelta {
  added: string[];
  removed: string[];
  hasChanges: boolean;
}

export function getCachedSchema(uid: string): Record<string, unknown> | null {
  const entry = schemaCache.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.ts > SCHEMA_TTL) { schemaCache.delete(uid); return null; }
  return entry.schema;
}

export function setCachedSchema(uid: string, schema: Record<string, unknown>): void {
  schemaCache.set(uid, { schema, ts: Date.now() });
}

export function clearCachedSchema(uid: string): void {
  schemaCache.delete(uid);
}

export function computeSchemaDelta(
  oldSchema: Record<string, unknown> | null,
  newSchema: Record<string, unknown>,
): SchemaDelta {
  if (!oldSchema) return { added: [], removed: [], hasChanges: false };
  const oldKeys = new Set(Object.keys(oldSchema));
  const newKeys = new Set(Object.keys(newSchema));
  const added = [...newKeys].filter((k) => !oldKeys.has(k));
  const removed = [...oldKeys].filter((k) => !newKeys.has(k));
  return { added, removed, hasChanges: added.length > 0 || removed.length > 0 };
}
