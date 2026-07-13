import type { UserData } from './model';

export const JWL_COLORS: Record<number, { name: string; hex: string }> = {
  1: { name: 'Yellow', hex: '#ffd951' },
  2: { name: 'Green', hex: '#9fdd7a' },
  3: { name: 'Blue', hex: '#8ecafc' },
  4: { name: 'Pink', hex: '#f7a8d8' },
  5: { name: 'Orange', hex: '#ffb17a' },
  6: { name: 'Purple', hex: '#c3b1f7' },
};

export interface Totals { highlights: number; notes: number; playlists: number; playlistItems: number; tags: number; bookmarks: number; inputFields: number; }
export interface TimelineBucket { month: string; notes: number; }
export interface Stats {
  totals: Totals;
  colorCounts: Record<number, number>;
  timeline: TimelineBucket[]; // sorted by month asc
  perSource: ({ sourceId: string; sourceName: string; deviceName: string; lastModifiedDate: string } & Totals)[];
}

const totalsOf = (ud: UserData): Totals => ({
  highlights: ud.marks.size,
  notes: ud.notes.size,
  playlists: [...ud.tags.values()].filter(t => t.type === 2).length,
  playlistItems: ud.playlistItems.size,
  tags: [...ud.tags.values()].filter(t => t.type === 1).length,
  bookmarks: ud.bookmarks.length,
  inputFields: ud.inputFields.length,
});

export function computeStats(sources: UserData[]): Stats {
  const combined: Totals = { highlights: 0, notes: 0, playlists: 0, playlistItems: 0, tags: 0, bookmarks: 0, inputFields: 0 };
  const colorCounts: Record<number, number> = {};
  const buckets = new Map<string, TimelineBucket>();
  const perSource: Stats['perSource'] = [];
  for (const ud of sources) {
    const t = totalsOf(ud);
    (Object.keys(combined) as (keyof Totals)[]).forEach(k => (combined[k] += t[k]));
    perSource.push({ sourceId: ud.meta.id, sourceName: ud.meta.name, deviceName: ud.meta.deviceName, lastModifiedDate: ud.meta.lastModifiedDate, ...t });
    for (const m of ud.marks.values()) colorCounts[m.colorIndex] = (colorCounts[m.colorIndex] ?? 0) + 1;
    for (const n of ud.notes.values()) {
      const month = (n.created || n.lastModified).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      if (!buckets.has(month)) buckets.set(month, { month, notes: 0 });
      buckets.get(month)!.notes++;
    }
  }
  return { totals: combined, colorCounts, timeline: [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month)), perSource };
}
