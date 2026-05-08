export type MergeMap = Record<string, string>;

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

export function buildMergeMap(
  fields: { key: string; value: string }[],
  extras: MergeMap,
): MergeMap {
  const map: MergeMap = { ...extras };
  for (const f of fields) {
    map[f.key.trim().toLowerCase()] = f.value;
  }
  return map;
}

export function applyMergeTemplate(body: string, map: MergeMap): string {
  return body.replace(TOKEN, (_, rawKey: string) => {
    const key = rawKey.trim().toLowerCase();
    return map[key] ?? `{{${rawKey.trim()}}}`;
  });
}
