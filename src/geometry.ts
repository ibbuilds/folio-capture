import type { Rect } from './types.ts';

/** Browser geometry uses CSS pixels; image extraction uses device pixels. */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  if (![a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return null;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function documentToViewport(rect: Rect, scrollX: number, scrollY: number): Rect {
  return { ...rect, x: rect.x - scrollX, y: rect.y - scrollY };
}

/** Enclose fractional CSS geometry, then intersect with the actual encoded image. */
export function pixelCrop(rect: Rect, image: { width: number; height: number }, dpr: number): Rect | null {
  if (!Number.isFinite(dpr) || dpr <= 0 || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
  const x = Math.floor(rect.x * dpr), y = Math.floor(rect.y * dpr);
  const right = Math.ceil((rect.x + rect.width) * dpr), bottom = Math.ceil((rect.y + rect.height) * dpr);
  return intersectRect({ x, y, width: right - x, height: bottom - y }, { x: 0, y: 0, ...image });
}

export function mergeCoverage(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = ranges.filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map(r => ({ ...r })).sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  return merged;
}

export function uncoveredRanges(height: number, coverage: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const range of mergeCoverage(coverage)) {
    if (range.start > cursor + 1) gaps.push({ start: cursor, end: Math.min(range.start, height) });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < height - 1) gaps.push({ start: cursor, end: height });
  return gaps.filter(g => g.end > g.start);
}
