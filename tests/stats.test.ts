import { describe, it, expect } from 'vitest';
import { computeStats, JWL_COLORS } from '../src/lib/engine/stats';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer } from './helpers/build';

describe('computeStats', () => {
  it('counts per type, per color, and buckets notes by month', async () => {
    const ud = await normalizeContainer('a', await buildModernContainer({
      locations: [{ id: 1, book: 20, chapter: 27 }],
      marks: [{ id: 1, guid: 'M1', loc: 1, color: 1 }, { id: 2, guid: 'M2', loc: 1, color: 4, ranges: [[1, 2, 0, 3]] }],
      notes: [
        { id: 1, guid: 'N1', loc: 1, title: 'x', content: 'y', created: '2025-03-05T00:00:00Z', modified: '2025-03-05T00:00:00Z' },
        { id: 2, guid: 'N2', loc: 1, title: 'z', content: 'w', created: '2025-03-20T00:00:00Z', modified: '2026-01-02T00:00:00Z' },
      ],
      tags: [{ id: 1, name: 't' }, { id: 2, type: 2, name: 'PL' }],
    }));
    const s = computeStats([ud]);
    expect(s.totals.highlights).toBe(2);
    expect(s.totals.notes).toBe(2);
    expect(s.totals.playlists).toBe(1); // tags with type 2
    expect(s.totals.tags).toBe(1); // user tags only (type 1)
    expect(s.colorCounts[1]).toBe(1);
    expect(s.colorCounts[4]).toBe(1);
    expect(s.timeline.find(b => b.month === '2025-03')!.notes).toBe(2); // bucketed by Created
    expect(s.perSource[0].sourceId).toBe('a');
    expect(JWL_COLORS[1].hex).toBe('#ffd951');
  });
});
