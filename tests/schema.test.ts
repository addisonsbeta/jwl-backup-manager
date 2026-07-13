import { describe, it, expect } from 'vitest';
import { openDb, exportDb } from '../src/lib/engine/db';
import { createCanonicalDb, CANONICAL_TABLES } from '../src/lib/engine/schema';

describe('canonical db', () => {
  it('creates every v16 table + seeds', async () => {
    const db = await createCanonicalDb();
    const names = db.exec(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)[0].values.flat();
    for (const t of CANONICAL_TABLES) expect(names).toContain(t);
    const acc = db.exec(`SELECT PlaylistItemAccuracyId, Description FROM PlaylistItemAccuracy ORDER BY 1`)[0].values;
    expect(acc).toEqual([[1, 'Accurate'], [2, 'NeedsUserVerification']]);
    const mig = db.exec(`SELECT identifier FROM grdb_migrations`)[0].values.flat();
    expect(mig).toEqual(['v9', 'v10', 'v11', 'v12', 'v13', 'v14', 'v15', 'v16']);
    db.close();
  });
  it('export→reopen round-trips', async () => {
    const db = await createCanonicalDb();
    db.run(`INSERT INTO Tag(TagId, Type, Name) VALUES (1, 1, 'test')`);
    const bytes = exportDb(db);
    db.close();
    const db2 = await openDb(bytes);
    expect(db2.exec(`SELECT Name FROM Tag`)[0].values[0][0]).toBe('test');
    db2.close();
  });
});
