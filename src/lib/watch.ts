export function addWatching(current: string[], id: string): string[] {
  if (current.includes(id)) return current;
  return [...current, id];
}

export function removeWatching(current: string[], id: string): string[] {
  return current.filter((item) => item !== id);
}

export function pruneWatching(current: string[], available: string[]): string[] {
  const live = new Set(available);
  return current.filter((id) => live.has(id));
}

export function mosaicColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}
