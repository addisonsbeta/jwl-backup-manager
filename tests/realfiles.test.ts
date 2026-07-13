import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { mergeSources } from '../src/lib/engine/merge';
import { applyResolutions, bulkDecide } from '../src/lib/engine/resolve';
import { exportContainer, verifyContainer } from '../src/lib/engine/export';

const dir = process.env.JWL_REAL_DIR;

describe.skipIf(!dir)('real backup files', () => {
  it('loads every real backup/playlist without errors', async () => {
    const files = readdirSync(dir!).filter(f => /\.(jwlibrary|jwlplaylist)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const ud = await normalizeContainer(f, new Uint8Array(readFileSync(join(dir!, f))));
      expect(ud.locations.size + ud.playlistItems.size + ud.marks.size).toBeGreaterThanOrEqual(0);
    }
  }, 120000);
  it('merges the two newest backups, resolves newest-wins, exports verified', async () => {
    const files = readdirSync(dir!).filter(f => /UserdataBackup.*\.jwlibrary$/.test(f)).sort().slice(-2);
    const sources = await Promise.all(files.map(async f => normalizeContainer(f, new Uint8Array(readFileSync(join(dir!, f))))));
    const r = mergeSources(sources);
    const final = applyResolutions(r, bulkDecide(r.conflicts, 'newest'));
    const { fileBytes } = await exportContainer(final, 'merged_smoke');
    const v = await verifyContainer(fileBytes);
    expect(v.problems.filter(p => !p.startsWith('Media file missing'))).toEqual([]);
    expect(v.counts.notes).toBeGreaterThan(0);
  }, 120000);
});
