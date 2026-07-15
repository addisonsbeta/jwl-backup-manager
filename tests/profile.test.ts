// Env-gated profiling harness: JWL_PROFILE_DIR=~/Downloads npm test -- profile
// Simulates a "drop everything in" session against real files and prints stage timings.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { mergeSources } from '../src/lib/engine/merge';
import { applyResolutions, bulkDecide } from '../src/lib/engine/resolve';
import { exportContainer, verifyContainer } from '../src/lib/engine/export';

const dir = process.env.JWL_PROFILE_DIR;

describe.skipIf(!dir)('profile: drop-everything session', () => {
  it('times every stage', async () => {
    const files = readdirSync(dir!).filter(f => /\.(jwlibrary|jwlplaylist)$/.test(f));
    const mb = (n: number) => (n / 1048576).toFixed(0);
    const rss = () => mb(process.memoryUsage().rss);
    const sources = [];
    let totalNorm = 0;
    for (const f of files) {
      const bytes = new Uint8Array(readFileSync(join(dir!, f)));
      const t0 = performance.now();
      try {
        sources.push(await normalizeContainer(f, bytes));
        const t = performance.now() - t0;
        totalNorm += t;
        if (t > 300) console.log(`SLOW ${t.toFixed(0).padStart(6)}ms rss=${rss()}MB size=${mb(bytes.length)}MB ${f}`);
      } catch (e: any) {
        console.log(`FAIL ${f}: ${e.message}`);
      }
    }
    console.log(`normalize: ${sources.length} files in ${(totalNorm / 1000).toFixed(1)}s, rss=${rss()}MB`);
    let t0 = performance.now();
    const r = mergeSources(sources);
    console.log(`mergeSources: ${(performance.now() - t0).toFixed(0)}ms, ${r.conflicts.length} conflicts, rss=${rss()}MB`);
    t0 = performance.now();
    const final = applyResolutions(r, bulkDecide(r.conflicts, 'newest'));
    console.log(`applyResolutions: ${(performance.now() - t0).toFixed(0)}ms`);
    t0 = performance.now();
    const { fileBytes } = await exportContainer(final, 'profile_test');
    console.log(`exportContainer: ${(performance.now() - t0).toFixed(0)}ms, output=${mb(fileBytes.length)}MB, rss=${rss()}MB`);
    t0 = performance.now();
    const v = await verifyContainer(fileBytes);
    console.log(`verifyContainer: ${(performance.now() - t0).toFixed(0)}ms ok=${v.ok} problems=${v.problems.slice(0, 3).join(' | ')}`);
    console.log(`counts: ${JSON.stringify(v.counts)}`);
    expect(sources.length).toBeGreaterThan(0);
  }, 600000);
});
