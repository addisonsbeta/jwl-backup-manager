# JWL Backup Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fully client-side web app that merges JW Library backups (`.jwlibrary`, incl. 2017-era schema v5) and `.jwlplaylist` files into one valid, importable `.jwlibrary` file, with a colorful data explorer and interactive conflict resolution.

**Architecture:** Pure-logic merge engine (TypeScript modules, no DOM) + Svelte 5 UI. Sources are unzipped in memory (fflate), read via sql.js (SQLite WASM), normalized into a canonical JS object model, merged with two-tier identity matching (GUID first, content identity second), then written back into a fresh canonical-schema SQLite db and zipped.

**Tech Stack:** Svelte 5 + Vite + TypeScript, sql.js, fflate, Vitest (jsdom not required — engine tests run in node).

**Spec:** `docs/superpowers/specs/2026-07-13-jwl-backup-manager-design.md`

---

## Verified format facts (do not re-derive; measured from real files)

- `.jwlibrary` / `.jwlplaylist` = ZIP: `manifest.json` + SQLite db + media files (GUID-named mp4/jpg/png + `default_thumbnail.png`).
- Manifest: `{name, creationDate, version:1, type:0|1, userDataBackup:{lastModifiedDate, deviceName, databaseName, hash, schemaVersion}}`. `type` 0 = backup, 1 = playlist. Old backups use `databaseName: "user_data.db"`.
- **Hash = standard zero-padded SHA-256 hex of the db file.** Proven: JWLM (go-jwlm) writes exactly this and its output imports into JW Library fine; the 2017 official backup also matches plain SHA-256. (Newest official backups use a different digest encoding — irrelevant for import validity; do NOT try to reproduce it.)
- Target schema: **v16**. `grdb_migrations` table gets rows `v9`…`v16` (JWLM proves even a single row imports, but mirror the official set).
- v5 → v16 column/table deltas the normalizer must handle:
  - v5 has NO: `PlaylistItem*`, `IndependentMedia`, `InputField`, `grdb_migrations`.
  - v5 `TagMap(TagMapId, Type, TypeId, TagId, Position)` — `Type` 0 = Location target, 1 = Note target (verify against data at runtime; fall back: if joined id exists in Note use note). v16 `TagMap` uses explicit `PlaylistItemId|LocationId|NoteId` columns (exactly one non-null).
  - v5 `Note` has no `Created` → default to `LastModified`.
  - v5 `Tag` has `LastModified` column (drop it); Tag.Type meanings identical (0=Favorite special, 1=user tag, 2=playlist).
  - v5 `Location` lacks `Specialty`/`Edition` and the UNIQUE constraint; `KeySymbol`/`MepsLanguage` NOT NULL there, nullable in v16.
- `PlaylistItemAccuracy` seed rows: `(1,'Accurate'), (2,'NeedsUserVerification')`.
- `PlaylistItem.ThumbnailFilePath` → FK to `IndependentMedia.FilePath`. `IndependentMedia.Hash` is a content hash — use it as media identity across sources.
- Six highlight colors, `UserMark.ColorIndex` 1–6 (0 = none): 1 yellow `#ffd951`, 2 green `#9fdd7a`, 3 blue `#8ecafc`, 4 pink `#f7a8d8`, 5 orange `#ffb17a`, 6 purple `#c3b1f7`.
- Real test material lives in `~/Downloads/*.jwlibrary|*.jwlplaylist` (schema v5, v14, v16). Never commit these; an env-gated smoke test reads them locally.

## File structure

```
package.json  vite.config.ts  tsconfig.json  index.html  svelte.config.js
src/main.ts                      — bootstrap
src/App.svelte                   — app shell, phase routing (ingest→explore→resolve→export)
src/lib/stores.ts                — Svelte stores: sources, mergeResult, decisions, phase
src/lib/engine/zip.ts            — container open/pack (fflate)
src/lib/engine/manifest.ts       — manifest parse/validate/generate, sha256Hex
src/lib/engine/db.ts             — sql.js loader (browser + node test), open/export bytes
src/lib/engine/schema.ts         — canonical v16 DDL, createCanonicalDb
src/lib/engine/model.ts          — UserData object model + identity keys
src/lib/engine/normalize.ts      — any-version source db → UserData (the "Upgrade" stage)
src/lib/engine/merge.ts          — fold sources, dedupe, detect conflicts
src/lib/engine/resolve.ts        — apply decisions + bulk rules
src/lib/engine/export.ts         — UserData → db bytes → container zip + self-check
src/lib/engine/stats.ts          — counts + monthly timeline buckets for explorer
src/lib/components/DropZone.svelte        — drag & drop ingest
src/lib/components/SourceList.svelte      — loaded sources w/ per-playlist include toggle
src/lib/components/MosaicDashboard.svelte — treemap tiles
src/lib/components/TimelineRiver.svelte   — stream graph + source markers
src/lib/components/DetailList.svelte      — filtered item browser
src/lib/components/ConflictResolver.svelte— v3 conflict UX (fixed stage, morph merge)
src/lib/components/ExportPanel.svelte     — export + verification summary
tests/helpers/build.ts           — synthetic v16 + v5 db/container fixture builders
tests/*.test.ts                  — one file per engine module
tests/realfiles.test.ts          — env-gated smoke test against ~/Downloads
.github/workflows/deploy.yml     — build + GitHub Pages
```

Engine modules never import Svelte or DOM APIs. UI imports engine, not vice versa.

Conventions: all engine functions are pure/async-pure; ids inside the model are **string keys** (GUIDs or content keys), never SQLite integer ids — integers are assigned only at export time.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `svelte.config.js`, `index.html`, `src/main.ts`, `src/App.svelte`, `tests/smoke.test.ts`

- [ ] **Step 1: Scaffold**

```bash
cd /Users/addisonsawyer/00_CLAUDECODE/JWL_Backup_Manager
npm create vite@latest . -- --template svelte-ts   # answer "Ignore files and continue" if prompted
npm i
npm i fflate sql.js
npm i -D vitest @types/sql.js
```

- [ ] **Step 2: Configure**

`vite.config.ts` (replace generated):

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './',                 // relative paths → works on GitHub Pages
  plugins: [svelte()],
  optimizeDeps: { exclude: ['sql.js'] },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
```

Add to `package.json` scripts: `"test": "vitest run", "test:watch": "vitest"`.

- [ ] **Step 3: Smoke test**

`tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
describe('toolchain', () => { it('runs', () => expect(1 + 1).toBe(2)); });
```

Run: `npm test` → PASS. Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold Svelte+Vite+TS with vitest, sql.js, fflate"
```

### Task 2: Container zip module

**Files:**
- Create: `src/lib/engine/zip.ts`, `tests/zip.test.ts`

- [ ] **Step 1: Write failing tests** — `tests/zip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openContainer, packContainer } from '../src/lib/engine/zip';
import { zipSync, strToU8 } from 'fflate';

const mkZip = (files: Record<string, Uint8Array>) => zipSync(files);

describe('openContainer', () => {
  it('splits manifest, db and media', () => {
    const db = new Uint8Array([1, 2, 3]);
    const zip = mkZip({
      'manifest.json': strToU8(JSON.stringify({ name: 'x', userDataBackup: { databaseName: 'userData.db' } })),
      'userData.db': db,
      'ABC.mp4': new Uint8Array([9]),
    });
    const c = openContainer(zip);
    expect(c.manifestRaw.name).toBe('x');
    expect(c.dbBytes).toEqual(db);
    expect([...c.media.keys()]).toEqual(['ABC.mp4']);
  });
  it('honors databaseName user_data.db (2017 backups)', () => {
    const zip = mkZip({
      'manifest.json': strToU8(JSON.stringify({ userDataBackup: { databaseName: 'user_data.db' } })),
      'user_data.db': new Uint8Array([7]),
    });
    expect(openContainer(zip).dbBytes).toEqual(new Uint8Array([7]));
  });
  it('rejects zip without manifest.json', () => {
    expect(() => openContainer(mkZip({ 'x.db': new Uint8Array([1]) })))
      .toThrow(/doesn't look like a JW Library backup/i);
  });
  it('rejects non-zip bytes', () => {
    expect(() => openContainer(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a valid backup file/i);
  });
  it('round-trips through packContainer', () => {
    const packed = packContainer({ manifest: { a: 1 }, dbName: 'userData.db', dbBytes: new Uint8Array([5]), media: new Map([['m.jpg', new Uint8Array([6])]]) });
    const c = openContainer(packed);
    expect(c.manifestRaw.a).toBe(1);
    expect(c.dbBytes).toEqual(new Uint8Array([5]));
    expect(c.media.get('m.jpg')).toEqual(new Uint8Array([6]));
  });
});
```

- [ ] **Step 2: Run** `npm test -- zip` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/lib/engine/zip.ts`:

```ts
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

export interface Container {
  manifestRaw: any;
  dbBytes: Uint8Array;
  dbName: string;
  media: Map<string, Uint8Array>;   // every non-manifest, non-db entry
}

export function openContainer(bytes: Uint8Array): Container {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('This is not a valid backup file (not a ZIP archive).');
  }
  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) throw new Error("This doesn't look like a JW Library backup — it's missing manifest.json.");
  let manifestRaw: any;
  try {
    manifestRaw = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new Error("This doesn't look like a JW Library backup — manifest.json is unreadable.");
  }
  const dbName: string = manifestRaw?.userDataBackup?.databaseName ?? 'userData.db';
  const dbBytes = entries[dbName];
  if (!dbBytes) throw new Error(`This doesn't look like a JW Library backup — database "${dbName}" is missing.`);
  const media = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name !== 'manifest.json' && name !== dbName) media.set(name, data);
  }
  return { manifestRaw, dbBytes, dbName, media };
}

export function packContainer(input: { manifest: any; dbName: string; dbBytes: Uint8Array; media: Map<string, Uint8Array> }): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(input.manifest)),
    [input.dbName]: input.dbBytes,
  };
  for (const [name, data] of input.media) files[name] = data;
  return zipSync(files);
}
```

- [ ] **Step 4: Run** `npm test -- zip` → PASS.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: backup container open/pack with validation"`

### Task 3: Manifest module

**Files:**
- Create: `src/lib/engine/manifest.ts`, `tests/manifest.test.ts`

- [ ] **Step 1: Failing tests** — `tests/manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseManifest, generateManifest, sha256Hex } from '../src/lib/engine/manifest';

describe('sha256Hex', () => {
  it('computes padded sha256', async () => {
    // sha256("abc") — well-known vector
    expect(await sha256Hex(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('parseManifest', () => {
  const good = { name: 'b', creationDate: '2026-07-13', version: 1, type: 0,
    userDataBackup: { lastModifiedDate: '2026-07-13T00:00:00Z', deviceName: 'iPhone', databaseName: 'userData.db', hash: 'x', schemaVersion: 16 } };
  it('accepts a valid backup manifest', () => {
    const m = parseManifest(good);
    expect(m.type).toBe(0); expect(m.schemaVersion).toBe(16); expect(m.deviceName).toBe('iPhone');
  });
  it('accepts playlist type 1', () => {
    expect(parseManifest({ ...good, type: 1 }).type).toBe(1);
  });
  it('flags unknown future schema as warning, not error', () => {
    const m = parseManifest({ ...good, userDataBackup: { ...good.userDataBackup, schemaVersion: 99 } });
    expect(m.warnings.some(w => /newer than this app understands/i.test(w))).toBe(true);
  });
  it('rejects manifest without userDataBackup', () => {
    expect(() => parseManifest({ name: 'x' })).toThrow(/missing its backup information/i);
  });
});

describe('generateManifest', () => {
  it('produces importable manifest with real hash', async () => {
    const db = new Uint8Array([1, 2, 3]);
    const m = await generateManifest(db, { name: 'merged_2026-07-13', type: 0, deviceName: 'JWL Backup Manager' });
    expect(m.userDataBackup.hash).toBe(await sha256Hex(db));
    expect(m.userDataBackup.schemaVersion).toBe(16);
    expect(m.userDataBackup.databaseName).toBe('userData.db');
    expect(m.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run** `npm test -- manifest` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/engine/manifest.ts`:

```ts
export const TARGET_SCHEMA_VERSION = 16;

export interface ParsedManifest {
  name: string; creationDate: string; type: 0 | 1;
  lastModifiedDate: string; deviceName: string; databaseName: string;
  hash: string; schemaVersion: number; warnings: string[];
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Works in browser and node ≥18 (both expose WebCrypto as globalThis.crypto)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function parseManifest(raw: any): ParsedManifest {
  const u = raw?.userDataBackup;
  if (!u) throw new Error('This backup is missing its backup information (userDataBackup) and cannot be read.');
  const warnings: string[] = [];
  const schemaVersion = Number(u.schemaVersion ?? 0);
  if (schemaVersion > TARGET_SCHEMA_VERSION)
    warnings.push(`This backup uses schema v${schemaVersion}, newer than this app understands (v${TARGET_SCHEMA_VERSION}). Loading best-effort — check the results carefully.`);
  return {
    name: String(raw.name ?? 'backup'),
    creationDate: String(raw.creationDate ?? ''),
    type: raw.type === 1 ? 1 : 0,
    lastModifiedDate: String(u.lastModifiedDate ?? ''),
    deviceName: String(u.deviceName ?? 'unknown device'),
    databaseName: String(u.databaseName ?? 'userData.db'),
    hash: String(u.hash ?? ''),
    schemaVersion, warnings,
  };
}

export async function generateManifest(dbBytes: Uint8Array, opts: { name: string; type: 0 | 1; deviceName: string }) {
  const now = new Date();
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    name: opts.name,
    creationDate: iso.slice(0, 10),
    version: 1,
    type: opts.type,
    userDataBackup: {
      lastModifiedDate: iso,
      deviceName: opts.deviceName,
      databaseName: 'userData.db',
      hash: await sha256Hex(dbBytes),
      schemaVersion: TARGET_SCHEMA_VERSION,
    },
  };
}
```

- [ ] **Step 4: Run** `npm test -- manifest` → PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: manifest parse/generate with sha256 hash"`

### Task 4: sql.js loader + canonical schema

**Files:**
- Create: `src/lib/engine/db.ts`, `src/lib/engine/schema.ts`, `tests/schema.test.ts`

- [ ] **Step 1: Failing tests** — `tests/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getSql, openDb, exportDb } from '../src/lib/engine/db';
import { createCanonicalDb, CANONICAL_TABLES } from '../src/lib/engine/schema';

describe('canonical db', () => {
  it('creates every v16 table + seeds', async () => {
    const db = await createCanonicalDb();
    const names = db.exec(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)[0].values.flat();
    for (const t of CANONICAL_TABLES) expect(names).toContain(t);
    const acc = db.exec(`SELECT PlaylistItemAccuracyId, Description FROM PlaylistItemAccuracy ORDER BY 1`)[0].values;
    expect(acc).toEqual([[1, 'Accurate'], [2, 'NeedsUserVerification']]);
    const mig = db.exec(`SELECT identifier FROM grdb_migrations`)[0].values.flat();
    expect(mig).toEqual(['v9','v10','v11','v12','v13','v14','v15','v16']);
    db.close();
  });
  it('export→reopen round-trips', async () => {
    const db = await createCanonicalDb();
    db.run(`INSERT INTO Tag(TagId, Type, Name) VALUES (1, 1, 'test')`);
    const bytes = exportDb(db); db.close();
    const db2 = await openDb(bytes);
    expect(db2.exec(`SELECT Name FROM Tag`)[0].values[0][0]).toBe('test');
    db2.close();
  });
});
```

- [ ] **Step 2: Run** `npm test -- schema` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/engine/db.ts`:

```ts
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

let sqlPromise: Promise<SqlJsStatic> | null = null;

export function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const inBrowser = typeof window !== 'undefined';
    sqlPromise = inBrowser
      ? initSqlJs({ locateFile: f => `${import.meta.env.BASE_URL}${f}` })  // sql-wasm.wasm copied to public/ (Task 13)
      : initSqlJs();                                                        // node resolves wasm from node_modules
  }
  return sqlPromise;
}

export async function openDb(bytes: Uint8Array): Promise<Database> {
  const SQL = await getSql();
  try { return new SQL.Database(bytes); }
  catch { throw new Error('The backup database is corrupt and could not be opened.'); }
}

export function exportDb(db: Database): Uint8Array { return db.export(); }
```

`src/lib/engine/schema.ts` — DDL below is the exact v16 DDL captured from a real 2026 backup (constraints included; triggers omitted deliberately — they only bump LastModified, which export sets explicitly):

```ts
import type { Database } from 'sql.js';
import { getSql } from './db';

export const CANONICAL_TABLES = [
  'BlockRange','Bookmark','IndependentMedia','InputField','LastModified','Location','Note',
  'PlaylistItem','PlaylistItemAccuracy','PlaylistItemIndependentMediaMap','PlaylistItemLocationMap',
  'PlaylistItemMarker','PlaylistItemMarkerBibleVerseMap','PlaylistItemMarkerParagraphMap',
  'Tag','TagMap','UserMark','grdb_migrations',
] as const;

export const CANONICAL_DDL = `
CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "Location"(
  LocationId INTEGER NOT NULL PRIMARY KEY, BookNumber INTEGER, ChapterNumber INTEGER,
  DocumentId INTEGER, Track INTEGER, IssueTagNumber INTEGER NOT NULL DEFAULT 0,
  KeySymbol TEXT, MepsLanguage INTEGER, Type INTEGER NOT NULL,
  Title TEXT, Specialty TEXT, Edition TEXT,
  UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type));
CREATE TABLE "UserMark" (
  UserMarkId INTEGER NOT NULL PRIMARY KEY, ColorIndex INTEGER NOT NULL, LocationId INTEGER NOT NULL,
  StyleIndex INTEGER NOT NULL, UserMarkGuid TEXT NOT NULL UNIQUE, Version INTEGER NOT NULL,
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId));
CREATE TABLE BlockRange (
  BlockRangeId INTEGER NOT NULL PRIMARY KEY, BlockType INTEGER NOT NULL, Identifier INTEGER NOT NULL,
  StartToken INTEGER, EndToken INTEGER, UserMarkId INTEGER NOT NULL,
  CHECK (BlockType BETWEEN 1 AND 2), FOREIGN KEY(UserMarkId) REFERENCES UserMark(UserMarkId));
CREATE TABLE "Note"(
  NoteId INTEGER NOT NULL PRIMARY KEY, Guid TEXT NOT NULL UNIQUE, UserMarkId INTEGER, LocationId INTEGER,
  Title TEXT, Content TEXT,
  LastModified TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  Created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER,
  CHECK((BlockType = 0 AND BlockIdentifier IS NULL) OR((BlockType BETWEEN 1 AND 2) AND BlockIdentifier IS NOT NULL)),
  FOREIGN KEY(UserMarkId) REFERENCES UserMark(UserMarkId),
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId));
CREATE TABLE Tag(
  TagId INTEGER NOT NULL PRIMARY KEY, Type INTEGER NOT NULL, Name TEXT NOT NULL,
  UNIQUE(Type, Name), CHECK(length(Name) > 0), CHECK(Type IN (0, 1, 2)));
CREATE TABLE IndependentMedia(
  IndependentMediaId INTEGER NOT NULL PRIMARY KEY, OriginalFilename TEXT NOT NULL,
  FilePath TEXT NOT NULL UNIQUE, MimeType TEXT NOT NULL, Hash TEXT NOT NULL,
  CHECK(length(OriginalFilename) > 0), CHECK(length(FilePath) > 0), CHECK(length(MimeType) > 0), CHECK(length(Hash) > 0));
CREATE TABLE PlaylistItemAccuracy(
  PlaylistItemAccuracyId INTEGER NOT NULL PRIMARY KEY, Description TEXT NOT NULL UNIQUE);
CREATE TABLE "PlaylistItem"(
  PlaylistItemId INTEGER NOT NULL PRIMARY KEY, Label TEXT NOT NULL,
  StartTrimOffsetTicks INTEGER, EndTrimOffsetTicks INTEGER,
  Accuracy INTEGER NOT NULL, EndAction INTEGER NOT NULL, ThumbnailFilePath TEXT,
  FOREIGN KEY(Accuracy) REFERENCES PlaylistItemAccuracy(PlaylistItemAccuracyId),
  FOREIGN KEY(ThumbnailFilePath) REFERENCES IndependentMedia(FilePath),
  CHECK(length(Label) > 0), CHECK(EndAction IN(0, 1, 2, 3)));
CREATE TABLE PlaylistItemIndependentMediaMap(
  PlaylistItemId INTEGER NOT NULL, IndependentMediaId INTEGER NOT NULL, DurationTicks INTEGER NOT NULL,
  PRIMARY KEY(PlaylistItemId, IndependentMediaId),
  FOREIGN KEY(PlaylistItemId) REFERENCES PlaylistItem(PlaylistItemId),
  FOREIGN KEY(IndependentMediaId) REFERENCES IndependentMedia(IndependentMediaId)) WITHOUT ROWID;
CREATE TABLE PlaylistItemLocationMap(
  PlaylistItemId INTEGER NOT NULL, LocationId INTEGER NOT NULL,
  MajorMultimediaType INTEGER NOT NULL, BaseDurationTicks INTEGER,
  PRIMARY KEY(PlaylistItemId, LocationId),
  FOREIGN KEY(PlaylistItemId) REFERENCES PlaylistItem(PlaylistItemId),
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId)) WITHOUT ROWID;
CREATE TABLE PlaylistItemMarker(
  PlaylistItemMarkerId INTEGER NOT NULL PRIMARY KEY, PlaylistItemId INTEGER NOT NULL,
  Label TEXT NOT NULL, StartTimeTicks INTEGER NOT NULL, DurationTicks INTEGER NOT NULL,
  EndTransitionDurationTicks INTEGER NOT NULL,
  UNIQUE(PlaylistItemId, StartTimeTicks),
  FOREIGN KEY(PlaylistItemId) REFERENCES PlaylistItem(PlaylistItemId));
CREATE TABLE PlaylistItemMarkerBibleVerseMap(
  PlaylistItemMarkerId INTEGER NOT NULL, VerseId INTEGER NOT NULL,
  PRIMARY KEY(PlaylistItemMarkerId, VerseId),
  FOREIGN KEY(PlaylistItemMarkerId) REFERENCES PlaylistItemMarker(PlaylistItemMarkerId)) WITHOUT ROWID;
CREATE TABLE PlaylistItemMarkerParagraphMap(
  PlaylistItemMarkerId INTEGER NOT NULL, MepsDocumentId INTEGER NOT NULL,
  ParagraphIndex INTEGER NOT NULL, MarkerIndexWithinParagraph INTEGER NOT NULL,
  PRIMARY KEY(PlaylistItemMarkerId, MepsDocumentId, ParagraphIndex, MarkerIndexWithinParagraph),
  FOREIGN KEY(PlaylistItemMarkerId) REFERENCES PlaylistItemMarker(PlaylistItemMarkerId)) WITHOUT ROWID;
CREATE TABLE "TagMap" (
  TagMapId INTEGER NOT NULL PRIMARY KEY, PlaylistItemId INTEGER, LocationId INTEGER, NoteId INTEGER,
  TagId INTEGER NOT NULL, Position INTEGER NOT NULL,
  FOREIGN KEY(TagId) REFERENCES Tag(TagId),
  FOREIGN KEY(PlaylistItemId) REFERENCES PlaylistItem(PlaylistItemId),
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId),
  FOREIGN KEY(NoteId) REFERENCES Note(NoteId),
  CONSTRAINT TagId_Position UNIQUE(TagId, Position),
  CONSTRAINT TagId_NoteId UNIQUE(TagId, NoteId),
  CONSTRAINT TagId_LocationId UNIQUE(TagId, LocationId),
  CHECK((NoteId IS NULL AND LocationId IS NULL AND PlaylistItemId IS NOT NULL)
     OR (LocationId IS NULL AND PlaylistItemId IS NULL AND NoteId IS NOT NULL)
     OR (PlaylistItemId IS NULL AND NoteId IS NULL AND LocationId IS NOT NULL)));
CREATE TABLE "Bookmark" (
  BookmarkId INTEGER NOT NULL PRIMARY KEY, LocationId INTEGER NOT NULL, PublicationLocationId INTEGER NOT NULL,
  Slot INTEGER NOT NULL, Title TEXT NOT NULL, Snippet TEXT,
  BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER,
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId),
  FOREIGN KEY(PublicationLocationId) REFERENCES Location(LocationId),
  CONSTRAINT PublicationLocationId_Slot UNIQUE (PublicationLocationId, Slot),
  CHECK((BlockType = 0 AND BlockIdentifier IS NULL) OR ((BlockType BETWEEN 1 AND 2) AND BlockIdentifier IS NOT NULL)));
CREATE TABLE "InputField"(
  LocationId INTEGER NOT NULL, TextTag TEXT NOT NULL, Value TEXT NOT NULL,
  FOREIGN KEY (LocationId) REFERENCES Location (LocationId),
  CONSTRAINT LocationId_TextTag PRIMARY KEY (LocationId, TextTag));
CREATE TABLE "LastModified"(LastModified TEXT NOT NULL);
CREATE INDEX IX_Note_LastModified_LocationId ON Note(LastModified, LocationId);
CREATE INDEX IX_Note_LocationId_BlockIdentifier ON Note(LocationId, BlockIdentifier);
CREATE INDEX IX_UserMark_LocationId ON UserMark(LocationId);
`;

export async function createCanonicalDb(): Promise<Database> {
  const SQL = await getSql();
  const db = new SQL.Database();
  db.run(CANONICAL_DDL);
  db.run(`INSERT INTO PlaylistItemAccuracy VALUES (1,'Accurate'),(2,'NeedsUserVerification')`);
  for (let v = 9; v <= 16; v++) db.run(`INSERT INTO grdb_migrations VALUES ('v${v}')`);
  return db;
}
```

Note: the v16 `Location` CHECK constraints from the real DDL are intentionally omitted — our normalizer only writes rows read from real JW Library dbs, and the official CHECKs reject some legacy rows that the v5 schema allowed. The UNIQUE constraint is kept.

- [ ] **Step 4: Run** `npm test -- schema` → PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: sql.js loader and canonical v16 schema"`

### Task 5: Object model + modern-schema normalizer

**Files:**
- Create: `src/lib/engine/model.ts`, `src/lib/engine/normalize.ts`, `tests/helpers/build.ts`, `tests/normalize.test.ts`

- [ ] **Step 1: Define the model** — `src/lib/engine/model.ts` (no test yet — types + key helpers get exercised by every later test):

```ts
export interface LocRec {
  bookNumber: number | null; chapterNumber: number | null; documentId: number | null;
  track: number | null; issueTagNumber: number; keySymbol: string | null;
  mepsLanguage: number | null; type: number; title: string | null;
  specialty: string | null; edition: string | null;
}
/** Natural identity of a Location across backups (Title etc. excluded). */
export const locKey = (l: LocRec) => JSON.stringify([
  l.bookNumber, l.chapterNumber, l.documentId, l.track, l.issueTagNumber,
  l.keySymbol, l.mepsLanguage, l.type]);

export interface RangeRec { blockType: number; identifier: number; startToken: number | null; endToken: number | null; }
export interface MarkRec {
  guid: string; colorIndex: number; styleIndex: number; version: number;
  locKey: string; ranges: RangeRec[];
}
export const markContentKey = (m: MarkRec) => JSON.stringify([
  m.locKey, m.colorIndex, m.styleIndex,
  [...m.ranges].sort((a, b) => a.identifier - b.identifier || (a.startToken ?? -1) - (b.startToken ?? -1))
    .map(r => [r.blockType, r.identifier, r.startToken, r.endToken])]);
/** Same text marked, ignoring color/style — used to catch "same verse, different color" conflicts. */
export const markPlacementKey = (m: MarkRec) => JSON.stringify([
  m.locKey,
  [...m.ranges].sort((a, b) => a.identifier - b.identifier || (a.startToken ?? -1) - (b.startToken ?? -1))
    .map(r => [r.blockType, r.identifier, r.startToken, r.endToken])]);

export interface NoteRec {
  guid: string; title: string | null; content: string | null;
  lastModified: string; created: string; blockType: number; blockIdentifier: number | null;
  locKey: string | null; markGuid: string | null;
}
export const noteContentKey = (n: NoteRec) => JSON.stringify([n.locKey, n.title, n.content, n.blockType, n.blockIdentifier]);

export interface TagRec { type: number; name: string; }
export const tagKey = (t: TagRec) => JSON.stringify([t.type, t.name]);

export type TagTarget = { kind: 'note'; guid: string } | { kind: 'location'; locKey: string } | { kind: 'playlistItem'; itemKey: string };
export interface TagMapRec { tagKey: string; target: TagTarget; position: number; }
export const tagMapKey = (tm: TagMapRec) => JSON.stringify([tm.tagKey, tm.target]);

export interface BookmarkRec {
  pubLocKey: string; locKey: string; slot: number; title: string; snippet: string | null;
  blockType: number; blockIdentifier: number | null;
}
export const bookmarkSlotKey = (b: BookmarkRec) => JSON.stringify([b.pubLocKey, b.slot]);
export const bookmarkContentKey = (b: BookmarkRec) => JSON.stringify([b.pubLocKey, b.slot, b.locKey, b.title, b.snippet, b.blockType, b.blockIdentifier]);

export interface InputFieldRec { locKey: string; textTag: string; value: string; }
export const inputFieldKey = (f: InputFieldRec) => JSON.stringify([f.locKey, f.textTag]);

export interface MediaRec { hash: string; originalFilename: string; filePath: string; mimeType: string; bytes: Uint8Array | null; }
export interface MarkerRec {
  label: string; startTimeTicks: number; durationTicks: number; endTransitionDurationTicks: number;
  verseIds: number[]; paragraphs: { mepsDocumentId: number; paragraphIndex: number; markerIndexWithinParagraph: number }[];
}
export interface PlaylistItemRec {
  label: string; startTrimOffsetTicks: number | null; endTrimOffsetTicks: number | null;
  accuracy: number; endAction: number; thumbnailMediaHash: string | null;
  markers: MarkerRec[];
  mediaRefs: { mediaHash: string; durationTicks: number }[];
  locationRefs: { locKey: string; majorMultimediaType: number; baseDurationTicks: number | null }[];
}
export const playlistItemKey = (p: PlaylistItemRec) => JSON.stringify([
  p.label, p.startTrimOffsetTicks, p.endTrimOffsetTicks, p.endAction,
  [...p.mediaRefs].map(m => m.mediaHash).sort(),
  [...p.locationRefs].map(l => l.locKey).sort(),
  [...p.markers].sort((a, b) => a.startTimeTicks - b.startTimeTicks).map(m => [m.label, m.startTimeTicks, m.durationTicks])]);

export interface SourceMeta {
  id: string;            // unique per loaded file (filename)
  name: string; deviceName: string; lastModifiedDate: string; creationDate: string;
  type: 0 | 1; schemaVersion: number; warnings: string[];
}

export interface UserData {
  meta: SourceMeta;
  locations: Map<string, LocRec>;                 // locKey → record
  marks: Map<string, MarkRec>;                    // guid → record
  notes: Map<string, NoteRec>;                    // guid → record
  tags: Map<string, TagRec>;                      // tagKey → record
  tagMaps: TagMapRec[];
  bookmarks: BookmarkRec[];
  inputFields: InputFieldRec[];
  playlistItems: Map<string, PlaylistItemRec>;    // playlistItemKey → record
  media: Map<string, MediaRec>;                   // hash → record (bytes from container)
}

export function emptyUserData(meta: SourceMeta): UserData {
  return { meta, locations: new Map(), marks: new Map(), notes: new Map(), tags: new Map(),
    tagMaps: [], bookmarks: [], inputFields: [], playlistItems: new Map(), media: new Map() };
}
```

- [ ] **Step 2: Fixture builder** — `tests/helpers/build.ts`. Builds a *real* modern db via the canonical schema, then containers via `packContainer`, so fixtures can't drift from production code:

```ts
import { createCanonicalDb } from '../../src/lib/engine/schema';
import { exportDb } from '../../src/lib/engine/db';
import { packContainer } from '../../src/lib/engine/zip';
import { generateManifest } from '../../src/lib/engine/manifest';

export interface FixtureSpec {
  device?: string;
  locations?: { id: number; keySymbol?: string; book?: number; chapter?: number; doc?: number; type?: number; title?: string }[];
  marks?: { id: number; guid: string; loc: number; color?: number; ranges?: [number, number, number, number][] }[]; // [blockType, identifier, start, end]
  notes?: { id: number; guid: string; loc?: number; mark?: number; title?: string; content?: string; modified?: string; created?: string }[];
  tags?: { id: number; type?: number; name: string }[];
  tagMaps?: { tag: number; note?: number; loc?: number; item?: number; position?: number }[];
  bookmarks?: { loc: number; pubLoc: number; slot: number; title: string; snippet?: string }[];
  inputFields?: { loc: number; tag: string; value: string }[];
  media?: { id: number; hash: string; file: string; mime?: string; original?: string }[];
  playlistItems?: { id: number; label: string; thumb?: string; mediaRefs?: [number, number][]; locRefs?: [number, number][]; markers?: { id: number; label: string; start: number; dur: number }[] }[];
}

export async function buildModernDbBytes(s: FixtureSpec): Promise<Uint8Array> {
  const db = await createCanonicalDb();
  for (const l of s.locations ?? [])
    db.run(`INSERT INTO Location(LocationId,BookNumber,ChapterNumber,DocumentId,KeySymbol,MepsLanguage,Type,Title,IssueTagNumber) VALUES (?,?,?,?,?,?,?,?,0)`,
      [l.id, l.book ?? null, l.chapter ?? null, l.doc ?? null, l.keySymbol ?? 'nwtsty', 0, l.type ?? 0, l.title ?? null]);
  for (const m of s.marks ?? []) {
    db.run(`INSERT INTO UserMark(UserMarkId,ColorIndex,LocationId,StyleIndex,UserMarkGuid,Version) VALUES (?,?,?,0,?,1)`,
      [m.id, m.color ?? 1, m.loc, m.guid]);
    for (const [bt, ident, st, en] of m.ranges ?? [[1, 1, 0, 5]])
      db.run(`INSERT INTO BlockRange(BlockType,Identifier,StartToken,EndToken,UserMarkId) VALUES (?,?,?,?,?)`, [bt, ident, st, en, m.id]);
  }
  for (const n of s.notes ?? [])
    db.run(`INSERT INTO Note(NoteId,Guid,UserMarkId,LocationId,Title,Content,LastModified,Created) VALUES (?,?,?,?,?,?,?,?)`,
      [n.id, n.guid, n.mark ?? null, n.loc ?? null, n.title ?? null, n.content ?? null,
       n.modified ?? '2026-01-01T00:00:00Z', n.created ?? '2026-01-01T00:00:00Z']);
  for (const t of s.tags ?? []) db.run(`INSERT INTO Tag(TagId,Type,Name) VALUES (?,?,?)`, [t.id, t.type ?? 1, t.name]);
  for (const m of s.media ?? [])
    db.run(`INSERT INTO IndependentMedia(IndependentMediaId,OriginalFilename,FilePath,MimeType,Hash) VALUES (?,?,?,?,?)`,
      [m.id, m.original ?? m.file, m.file, m.mime ?? 'image/jpeg', m.hash]);
  for (const p of s.playlistItems ?? []) {
    db.run(`INSERT INTO PlaylistItem(PlaylistItemId,Label,Accuracy,EndAction,ThumbnailFilePath) VALUES (?,?,1,0,?)`, [p.id, p.label, p.thumb ?? null]);
    for (const [mediaId, dur] of p.mediaRefs ?? [])
      db.run(`INSERT INTO PlaylistItemIndependentMediaMap VALUES (?,?,?)`, [p.id, mediaId, dur]);
    for (const [locId, mmt] of p.locRefs ?? [])
      db.run(`INSERT INTO PlaylistItemLocationMap(PlaylistItemId,LocationId,MajorMultimediaType) VALUES (?,?,?)`, [p.id, locId, mmt]);
    for (const mk of p.markers ?? [])
      db.run(`INSERT INTO PlaylistItemMarker(PlaylistItemMarkerId,PlaylistItemId,Label,StartTimeTicks,DurationTicks,EndTransitionDurationTicks) VALUES (?,?,?,?,?,0)`,
        [mk.id, p.id, mk.label, mk.start, mk.dur]);
  }
  let pos = 0;
  for (const tm of s.tagMaps ?? [])
    db.run(`INSERT INTO TagMap(PlaylistItemId,LocationId,NoteId,TagId,Position) VALUES (?,?,?,?,?)`,
      [tm.item ?? null, tm.loc ?? null, tm.note ?? null, tm.tag, tm.position ?? pos++]);
  for (const b of s.bookmarks ?? [])
    db.run(`INSERT INTO Bookmark(LocationId,PublicationLocationId,Slot,Title,Snippet) VALUES (?,?,?,?,?)`,
      [b.loc, b.pubLoc, b.slot, b.title, b.snippet ?? null]);
  for (const f of s.inputFields ?? [])
    db.run(`INSERT INTO InputField(LocationId,TextTag,Value) VALUES (?,?,?)`, [f.loc, f.tag, f.value]);
  db.run(`INSERT INTO LastModified VALUES ('2026-01-01T00:00:00Z')`);
  const bytes = exportDb(db); db.close(); return bytes;
}

export async function buildModernContainer(s: FixtureSpec, mediaFiles: Record<string, Uint8Array> = {}, type: 0 | 1 = 0): Promise<Uint8Array> {
  const dbBytes = await buildModernDbBytes(s);
  const manifest = await generateManifest(dbBytes, { name: 'fixture', type, deviceName: s.device ?? 'TestDevice' });
  return packContainer({ manifest, dbName: 'userData.db', dbBytes, media: new Map(Object.entries(mediaFiles)) });
}
```

- [ ] **Step 3: Failing tests** — `tests/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer } from './helpers/build';
import { locKey } from '../src/lib/engine/model';

const spec = {
  locations: [
    { id: 1, keySymbol: 'nwtsty', book: 20, chapter: 27, type: 0 },
    { id: 2, keySymbol: 'w26', doc: 2026123, type: 0, title: 'Study article' },
  ],
  marks: [{ id: 1, guid: 'MG-1', loc: 1, color: 2, ranges: [[1, 11, 2, 9]] as [number,number,number,number][] }],
  notes: [{ id: 1, guid: 'NG-1', loc: 1, mark: 1, title: 'T', content: 'C' }],
  tags: [{ id: 1, name: 'talks' }, { id: 2, type: 2, name: 'My Playlist' }],
  media: [{ id: 1, hash: 'H1', file: 'A.jpg' }],
  playlistItems: [{ id: 1, label: 'Song 42', thumb: 'A.jpg', mediaRefs: [[1, 100]] as [number,number][], markers: [{ id: 1, label: 'intro', start: 0, dur: 50 }] }],
  tagMaps: [{ tag: 1, note: 1 }, { tag: 2, item: 1 }],
  bookmarks: [{ loc: 1, pubLoc: 2, slot: 0, title: 'BM' }],
  inputFields: [{ loc: 2, tag: 'tt1', value: 'answer' }],
};

describe('normalizeContainer (modern v16)', () => {
  it('normalizes every entity into the model', async () => {
    const bytes = await buildModernContainer(spec, { 'A.jpg': new Uint8Array([1]) });
    const ud = await normalizeContainer('f.jwlibrary', bytes);
    expect(ud.meta.deviceName).toBe('TestDevice');
    expect(ud.locations.size).toBe(2);
    const mark = ud.marks.get('MG-1')!;
    expect(mark.colorIndex).toBe(2);
    expect(mark.ranges).toEqual([{ blockType: 1, identifier: 11, startToken: 2, endToken: 9 }]);
    const note = ud.notes.get('NG-1')!;
    expect(note.markGuid).toBe('MG-1');
    expect(note.locKey).toBe(locKey([...ud.locations.values()].find(l => l.bookNumber === 20)! as any));
    expect([...ud.tags.values()].map(t => t.name).sort()).toEqual(['My Playlist', 'talks']);
    expect(ud.playlistItems.size).toBe(1);
    const item = [...ud.playlistItems.values()][0];
    expect(item.thumbnailMediaHash).toBe('H1');
    expect(item.mediaRefs).toEqual([{ mediaHash: 'H1', durationTicks: 100 }]);
    expect(item.markers[0].label).toBe('intro');
    expect(ud.media.get('H1')!.bytes).toEqual(new Uint8Array([1]));
    expect(ud.tagMaps.length).toBe(2);
    expect(ud.bookmarks.length).toBe(1);
    expect(ud.inputFields[0].value).toBe('answer');
  });
});
```

- [ ] **Step 4: Run** `npm test -- normalize` → FAIL.

- [ ] **Step 5: Implement** — `src/lib/engine/normalize.ts`:

```ts
import type { Database } from 'sql.js';
import { openContainer } from './zip';
import { parseManifest } from './manifest';
import { openDb } from './db';
import {
  emptyUserData, locKey, playlistItemKey, tagKey,
  type UserData, type LocRec, type MarkRec, type NoteRec, type TagMapRec,
  type PlaylistItemRec, type MarkerRec, type SourceMeta,
} from './model';

const rows = (db: Database, sql: string): any[][] => db.exec(sql)[0]?.values ?? [];
const hasTable = (db: Database, name: string) =>
  rows(db, `SELECT 1 FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0;
const columns = (db: Database, table: string): string[] =>
  rows(db, `PRAGMA table_info(${table})`).map(r => String(r[1]));

export async function normalizeContainer(fileId: string, bytes: Uint8Array): Promise<UserData> {
  const c = openContainer(bytes);
  const m = parseManifest(c.manifestRaw);
  const db = await openDb(c.dbBytes);
  try {
    return normalizeDb(db, {
      id: fileId, name: m.name, deviceName: m.deviceName, lastModifiedDate: m.lastModifiedDate,
      creationDate: m.creationDate, type: m.type, schemaVersion: m.schemaVersion, warnings: [...m.warnings],
    }, c.media);
  } finally { db.close(); }
}

export function normalizeDb(db: Database, meta: SourceMeta, mediaFiles: Map<string, Uint8Array>): UserData {
  const ud = emptyUserData(meta);

  // Location — build integer-id → locKey mapping
  const locCols = columns(db, 'Location');
  const has = (c: string) => locCols.includes(c);
  const idToLoc = new Map<number, string>();
  for (const r of rows(db, `SELECT LocationId, BookNumber, ChapterNumber, DocumentId, Track, IssueTagNumber, KeySymbol, MepsLanguage, Type, Title${has('Specialty') ? ', Specialty' : ''}${has('Edition') ? ', Edition' : ''} FROM Location`)) {
    const [id, book, chap, doc, track, issue, key, lang, type, title, spec, ed] = r as any[];
    const loc: LocRec = { bookNumber: book ?? null, chapterNumber: chap ?? null, documentId: doc ?? null,
      track: track ?? null, issueTagNumber: issue ?? 0, keySymbol: key ?? null, mepsLanguage: lang ?? null,
      type, title: title ?? null, specialty: spec ?? null, edition: ed ?? null };
    const k = locKey(loc);
    if (!ud.locations.has(k)) ud.locations.set(k, loc);
    else if (!ud.locations.get(k)!.title && loc.title) ud.locations.get(k)!.title = loc.title;
    idToLoc.set(Number(id), k);
  }

  // UserMark + BlockRange
  const markIdToGuid = new Map<number, string>();
  for (const [id, color, locId, style, guid, version] of rows(db, `SELECT UserMarkId, ColorIndex, LocationId, StyleIndex, UserMarkGuid, Version FROM UserMark`) as any[]) {
    const mark: MarkRec = { guid, colorIndex: color, styleIndex: style, version, locKey: idToLoc.get(Number(locId))!, ranges: [] };
    ud.marks.set(guid, mark); markIdToGuid.set(Number(id), guid);
  }
  for (const [bt, ident, st, en, umId] of rows(db, `SELECT BlockType, Identifier, StartToken, EndToken, UserMarkId FROM BlockRange`) as any[]) {
    const g = markIdToGuid.get(Number(umId));
    if (g) ud.marks.get(g)!.ranges.push({ blockType: bt, identifier: ident, startToken: st ?? null, endToken: en ?? null });
  }

  // Note (v5 has no Created column)
  const noteHasCreated = columns(db, 'Note').includes('Created');
  const noteIdToGuid = new Map<number, string>();
  for (const [id, guid, umId, locId, title, content, lastMod, created, bt, bi] of
      rows(db, `SELECT NoteId, Guid, UserMarkId, LocationId, Title, Content, LastModified, ${noteHasCreated ? 'Created' : 'LastModified'}, BlockType, BlockIdentifier FROM Note`) as any[]) {
    const n: NoteRec = { guid, title: title ?? null, content: content ?? null, lastModified: lastMod, created,
      blockType: bt, blockIdentifier: bi ?? null,
      locKey: locId != null ? idToLoc.get(Number(locId)) ?? null : null,
      markGuid: umId != null ? markIdToGuid.get(Number(umId)) ?? null : null };
    ud.notes.set(guid, n); noteIdToGuid.set(Number(id), guid);
  }

  // Tag
  const tagIdToKey = new Map<number, string>();
  for (const [id, type, name] of rows(db, `SELECT TagId, Type, Name FROM Tag`) as any[]) {
    const t = { type, name }; const k = tagKey(t);
    ud.tags.set(k, t); tagIdToKey.set(Number(id), k);
  }

  // IndependentMedia (+ bytes from the container)
  const mediaIdToHash = new Map<number, string>();
  const pathToHash = new Map<string, string>();
  if (hasTable(db, 'IndependentMedia')) {
    for (const [id, orig, path, mime, hash] of rows(db, `SELECT IndependentMediaId, OriginalFilename, FilePath, MimeType, Hash FROM IndependentMedia`) as any[]) {
      ud.media.set(hash, { hash, originalFilename: orig, filePath: path, mimeType: mime, bytes: mediaFiles.get(path) ?? null });
      mediaIdToHash.set(Number(id), hash); pathToHash.set(path, hash);
    }
  }

  // PlaylistItem + markers + maps
  const itemIdToKey = new Map<number, string>();
  if (hasTable(db, 'PlaylistItem')) {
    const markersByItem = new Map<number, MarkerRec[]>(); const markerIdTo = new Map<number, MarkerRec>();
    if (hasTable(db, 'PlaylistItemMarker')) {
      for (const [mid, pid, label, start, dur, endTrans] of rows(db, `SELECT PlaylistItemMarkerId, PlaylistItemId, Label, StartTimeTicks, DurationTicks, EndTransitionDurationTicks FROM PlaylistItemMarker`) as any[]) {
        const rec: MarkerRec = { label, startTimeTicks: start, durationTicks: dur, endTransitionDurationTicks: endTrans, verseIds: [], paragraphs: [] };
        markerIdTo.set(Number(mid), rec);
        if (!markersByItem.has(Number(pid))) markersByItem.set(Number(pid), []);
        markersByItem.get(Number(pid))!.push(rec);
      }
      if (hasTable(db, 'PlaylistItemMarkerBibleVerseMap'))
        for (const [mid, v] of rows(db, `SELECT PlaylistItemMarkerId, VerseId FROM PlaylistItemMarkerBibleVerseMap`) as any[])
          markerIdTo.get(Number(mid))?.verseIds.push(Number(v));
      if (hasTable(db, 'PlaylistItemMarkerParagraphMap'))
        for (const [mid, docId, para, idx] of rows(db, `SELECT PlaylistItemMarkerId, MepsDocumentId, ParagraphIndex, MarkerIndexWithinParagraph FROM PlaylistItemMarkerParagraphMap`) as any[])
          markerIdTo.get(Number(mid))?.paragraphs.push({ mepsDocumentId: docId, paragraphIndex: para, markerIndexWithinParagraph: idx });
    }
    const mediaRefsByItem = new Map<number, { mediaHash: string; durationTicks: number }[]>();
    if (hasTable(db, 'PlaylistItemIndependentMediaMap'))
      for (const [pid, mid, dur] of rows(db, `SELECT PlaylistItemId, IndependentMediaId, DurationTicks FROM PlaylistItemIndependentMediaMap`) as any[]) {
        if (!mediaRefsByItem.has(Number(pid))) mediaRefsByItem.set(Number(pid), []);
        const h = mediaIdToHash.get(Number(mid)); if (h) mediaRefsByItem.get(Number(pid))!.push({ mediaHash: h, durationTicks: dur });
      }
    const locRefsByItem = new Map<number, { locKey: string; majorMultimediaType: number; baseDurationTicks: number | null }[]>();
    if (hasTable(db, 'PlaylistItemLocationMap'))
      for (const [pid, locId, mmt, base] of rows(db, `SELECT PlaylistItemId, LocationId, MajorMultimediaType, BaseDurationTicks FROM PlaylistItemLocationMap`) as any[]) {
        if (!locRefsByItem.has(Number(pid))) locRefsByItem.set(Number(pid), []);
        const k = idToLoc.get(Number(locId)); if (k) locRefsByItem.get(Number(pid))!.push({ locKey: k, majorMultimediaType: mmt, baseDurationTicks: base ?? null });
      }
    for (const [id, label, st, et, acc, endAction, thumb] of rows(db, `SELECT PlaylistItemId, Label, StartTrimOffsetTicks, EndTrimOffsetTicks, Accuracy, EndAction, ThumbnailFilePath FROM PlaylistItem`) as any[]) {
      const rec: PlaylistItemRec = { label, startTrimOffsetTicks: st ?? null, endTrimOffsetTicks: et ?? null,
        accuracy: acc, endAction, thumbnailMediaHash: thumb != null ? pathToHash.get(thumb) ?? null : null,
        markers: markersByItem.get(Number(id)) ?? [], mediaRefs: mediaRefsByItem.get(Number(id)) ?? [],
        locationRefs: locRefsByItem.get(Number(id)) ?? [] };
      const k = playlistItemKey(rec);
      ud.playlistItems.set(k, rec); itemIdToKey.set(Number(id), k);
    }
  }

  // TagMap — modern (explicit FK columns) vs legacy (Type/TypeId) handled in Task 6
  normalizeTagMaps(db, ud, { tagIdToKey, noteIdToGuid, idToLoc, itemIdToKey });

  // Bookmark
  for (const [locId, pubLocId, slot, title, snippet, bt, bi] of rows(db, `SELECT LocationId, PublicationLocationId, Slot, Title, Snippet, BlockType, BlockIdentifier FROM Bookmark`) as any[]) {
    const lk = idToLoc.get(Number(locId)), pk = idToLoc.get(Number(pubLocId));
    if (lk && pk) ud.bookmarks.push({ pubLocKey: pk, locKey: lk, slot, title, snippet: snippet ?? null, blockType: bt, blockIdentifier: bi ?? null });
  }

  // InputField
  if (hasTable(db, 'InputField'))
    for (const [locId, tt, val] of rows(db, `SELECT LocationId, TextTag, Value FROM InputField`) as any[]) {
      const lk = idToLoc.get(Number(locId));
      if (lk) ud.inputFields.push({ locKey: lk, textTag: tt, value: val });
    }

  return ud;
}

interface TagMapCtx {
  tagIdToKey: Map<number, string>; noteIdToGuid: Map<number, string>;
  idToLoc: Map<number, string>; itemIdToKey: Map<number, string>;
}

function normalizeTagMaps(db: Database, ud: UserData, ctx: TagMapCtx) {
  const cols = columns(db, 'TagMap');
  if (cols.includes('NoteId')) {                       // modern
    for (const [pid, locId, noteId, tagId, pos] of rows(db, `SELECT PlaylistItemId, LocationId, NoteId, TagId, Position FROM TagMap`) as any[]) {
      const tk = ctx.tagIdToKey.get(Number(tagId)); if (!tk) continue;
      let target: TagMapRec['target'] | null = null;
      if (noteId != null) { const g = ctx.noteIdToGuid.get(Number(noteId)); if (g) target = { kind: 'note', guid: g }; }
      else if (locId != null) { const k = ctx.idToLoc.get(Number(locId)); if (k) target = { kind: 'location', locKey: k }; }
      else if (pid != null) { const k = ctx.itemIdToKey.get(Number(pid)); if (k) target = { kind: 'playlistItem', itemKey: k }; }
      if (target) ud.tagMaps.push({ tagKey: tk, target, position: Number(pos) });
    }
  } else {                                             // legacy v5: Type 0 = Location, 1 = Note
    for (const [type, typeId, tagId, pos] of rows(db, `SELECT Type, TypeId, TagId, Position FROM TagMap`) as any[]) {
      const tk = ctx.tagIdToKey.get(Number(tagId)); if (!tk) continue;
      let target: TagMapRec['target'] | null = null;
      if (Number(type) === 1) { const g = ctx.noteIdToGuid.get(Number(typeId)); if (g) target = { kind: 'note', guid: g }; }
      else { const k = ctx.idToLoc.get(Number(typeId)); if (k) target = { kind: 'location', locKey: k }; }
      // Legacy safety net: if the primary interpretation found nothing, try the other table.
      if (!target) {
        const g = ctx.noteIdToGuid.get(Number(typeId)); const k = ctx.idToLoc.get(Number(typeId));
        if (Number(type) === 1 && k) target = { kind: 'location', locKey: k };
        else if (Number(type) !== 1 && g) target = { kind: 'note', guid: g };
      }
      if (target) ud.tagMaps.push({ tagKey: tk, target, position: Number(pos) });
    }
  }
}
```

- [ ] **Step 6: Run** `npm test -- normalize` → PASS.
- [ ] **Step 7: Commit** `git add -A && git commit -m "feat: object model and modern-schema normalizer"`

### Task 6: Legacy (v5) normalizer support

**Files:**
- Modify: `tests/helpers/build.ts` (add legacy builder)
- Test: `tests/normalize-legacy.test.ts`

The normalizer in Task 5 already introspects columns/tables; this task builds a *true v5 fixture* (old DDL verbatim from the real 2017 backup) and proves the same code path handles it.

- [ ] **Step 1: Add legacy builder** to `tests/helpers/build.ts`:

```ts
import { getSql } from '../../src/lib/engine/db';

export const LEGACY_V5_DDL = `
CREATE TABLE Location (LocationId INTEGER NOT NULL PRIMARY KEY, BookNumber INTEGER, ChapterNumber INTEGER,
  DocumentId INTEGER, Track INTEGER, IssueTagNumber INTEGER NOT NULL DEFAULT 0,
  KeySymbol TEXT NOT NULL, MepsLanguage INTEGER NOT NULL, Type INTEGER NOT NULL, Title TEXT);
CREATE TABLE UserMark (UserMarkId INTEGER NOT NULL PRIMARY KEY, ColorIndex INTEGER NOT NULL,
  LocationId INTEGER NOT NULL, StyleIndex INTEGER NOT NULL, UserMarkGuid TEXT NOT NULL UNIQUE, Version INTEGER NOT NULL);
CREATE TABLE BlockRange (BlockRangeId INTEGER NOT NULL PRIMARY KEY, BlockType INTEGER NOT NULL,
  Identifier INTEGER NOT NULL, StartToken INTEGER, EndToken INTEGER, UserMarkId INTEGER NOT NULL);
CREATE TABLE Note (NoteId INTEGER NOT NULL PRIMARY KEY, Guid TEXT NOT NULL UNIQUE, UserMarkId INTEGER,
  LocationId INTEGER, Title TEXT, Content TEXT,
  LastModified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER);
CREATE TABLE Tag (TagId INTEGER NOT NULL PRIMARY KEY, Type INTEGER NOT NULL, Name TEXT NOT NULL,
  LastModified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE TagMap (TagMapId INTEGER NOT NULL PRIMARY KEY, Type INTEGER NOT NULL, TypeId INTEGER NOT NULL,
  TagId INTEGER NOT NULL, Position INTEGER NOT NULL);
CREATE TABLE Bookmark (BookmarkId INTEGER NOT NULL PRIMARY KEY, PublicationLocationId INTEGER NOT NULL,
  LocationId INTEGER NOT NULL, Slot INTEGER NOT NULL, Title TEXT NOT NULL, Snippet TEXT,
  BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER);
CREATE TABLE LastModified (LastModified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
`;

export async function buildLegacyContainer(s: {
  locations?: { id: number; keySymbol: string; book?: number; chapter?: number; doc?: number; type?: number }[];
  marks?: { id: number; guid: string; loc: number; color?: number }[];
  notes?: { id: number; guid: string; loc?: number; title?: string; content?: string; modified?: string }[];
  tags?: { id: number; name: string }[];
  tagMaps?: { type: 0 | 1; typeId: number; tag: number; position?: number }[];
}): Promise<Uint8Array> {
  const SQL = await getSql();
  const db = new SQL.Database();
  db.run(LEGACY_V5_DDL);
  for (const l of s.locations ?? [])
    db.run(`INSERT INTO Location(LocationId,BookNumber,ChapterNumber,DocumentId,KeySymbol,MepsLanguage,Type) VALUES (?,?,?,?,?,0,?)`,
      [l.id, l.book ?? null, l.chapter ?? null, l.doc ?? null, l.keySymbol, l.type ?? 0]);
  for (const m of s.marks ?? []) {
    db.run(`INSERT INTO UserMark VALUES (?,?,?,0,?,1)`, [m.id, m.color ?? 1, m.loc, m.guid]);
    db.run(`INSERT INTO BlockRange(BlockType,Identifier,StartToken,EndToken,UserMarkId) VALUES (1,1,0,5,?)`, [m.id]);
  }
  for (const n of s.notes ?? [])
    db.run(`INSERT INTO Note(NoteId,Guid,LocationId,Title,Content,LastModified) VALUES (?,?,?,?,?,?)`,
      [n.id, n.guid, n.loc ?? null, n.title ?? null, n.content ?? null, n.modified ?? '2017-09-01T00:00:00Z']);
  for (const t of s.tags ?? []) db.run(`INSERT INTO Tag(TagId,Type,Name) VALUES (?,1,?)`, [t.id, t.name]);
  let pos = 0;
  for (const tm of s.tagMaps ?? [])
    db.run(`INSERT INTO TagMap(Type,TypeId,TagId,Position) VALUES (?,?,?,?)`, [tm.type, tm.typeId, tm.tag, tm.position ?? pos++]);
  db.run(`INSERT INTO LastModified(LastModified) VALUES ('2017-09-01T00:00:00Z')`);
  const dbBytes = db.export(); db.close();
  const { packContainer } = await import('../../src/lib/engine/zip');
  return packContainer({
    manifest: { name: 'legacy', creationDate: '2017-09-26', version: 1, type: 0,
      userDataBackup: { lastModifiedDate: '2017-09-25T17:17:09-05:00', deviceName: 'OldPhone', databaseName: 'user_data.db', hash: 'x', schemaVersion: 5 } },
    dbName: 'user_data.db', dbBytes, media: new Map(),
  });
}
```

- [ ] **Step 2: Failing tests** — `tests/normalize-legacy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildLegacyContainer } from './helpers/build';

describe('normalizeContainer (legacy v5)', () => {
  it('reads a 2017-style backup end to end', async () => {
    const bytes = await buildLegacyContainer({
      locations: [{ id: 1, keySymbol: 'nwt', book: 20, chapter: 27 }],
      marks: [{ id: 1, guid: 'OLD-MARK', loc: 1, color: 3 }],
      notes: [{ id: 1, guid: 'OLD-NOTE', loc: 1, title: 'Old', content: 'From 2017' }],
      tags: [{ id: 1, name: 'oldtag' }],
      tagMaps: [{ type: 1, typeId: 1, tag: 1 }],   // tags the note
    });
    const ud = await normalizeContainer('old.jwlibrary', bytes);
    expect(ud.meta.schemaVersion).toBe(5);
    expect(ud.meta.deviceName).toBe('OldPhone');
    expect(ud.marks.get('OLD-MARK')!.colorIndex).toBe(3);
    const note = ud.notes.get('OLD-NOTE')!;
    expect(note.created).toBe(note.lastModified);   // Created backfilled from LastModified
    expect(ud.tagMaps).toEqual([{ tagKey: JSON.stringify([1, 'oldtag']), target: { kind: 'note', guid: 'OLD-NOTE' }, position: 0 }]);
    expect(ud.playlistItems.size).toBe(0);          // no playlist tables in v5 — no crash
  });
  it('maps legacy TagMap Type 0 to a location target', async () => {
    const bytes = await buildLegacyContainer({
      locations: [{ id: 7, keySymbol: 'w17', doc: 123 }],
      tags: [{ id: 1, name: 'favs' }],
      tagMaps: [{ type: 0, typeId: 7, tag: 1 }],
    });
    const ud = await normalizeContainer('old2.jwlibrary', bytes);
    expect(ud.tagMaps[0].target.kind).toBe('location');
  });
});
```

- [ ] **Step 3: Run** `npm test -- normalize-legacy` → PASS expected already (Task 5 wrote the introspection); if any expectation FAILS, fix `normalize.ts` until green. This task is the proof, not new code.
- [ ] **Step 4: Commit** `git add -A && git commit -m "test: legacy v5 backup normalization proven with true v5 fixtures"`

### Task 7: Merge engine — locations, highlights, notes

**Files:**
- Create: `src/lib/engine/merge.ts`, `tests/merge.test.ts`

- [ ] **Step 1: Failing tests** — `tests/merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeSources } from '../src/lib/engine/merge';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer } from './helpers/build';

const load = async (name: string, spec: any) => normalizeContainer(name, await buildModernContainer(spec));

describe('mergeSources — marks & notes', () => {
  it('dedupes identical items (same GUID) silently', async () => {
    const spec = {
      locations: [{ id: 1, book: 20, chapter: 27 }],
      marks: [{ id: 1, guid: 'M1', loc: 1, color: 1 }],
      notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'C' }],
    };
    const r = mergeSources([await load('a', spec), await load('b', spec)]);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.marks.size).toBe(1);
    expect(r.merged.notes.size).toBe(1);
  });
  it('dedupes identical content with different GUIDs', async () => {
    const a = await load('a', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'C' }] });
    const b = await load('b', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N-OTHER', loc: 1, title: 'T', content: 'C' }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.notes.size).toBe(1);
  });
  it('conflicts when same note GUID has different content', async () => {
    const a = await load('a', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'iPhone text', modified: '2026-07-12T00:00:00Z' }] });
    const b = await load('b', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'iPad text', modified: '2025-10-13T00:00:00Z' }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts.length).toBe(1);
    const c = r.conflicts[0];
    expect(c.kind).toBe('note');
    expect((c.left.item as any).content).toBe('iPhone text');
    expect((c.right.item as any).content).toBe('iPad text');
    expect(c.left.sourceId).toBe('a');
    // merged keeps LEFT until resolved
    expect(r.merged.notes.get('N1')!.content).toBe('iPhone text');
  });
  it('conflicts when same text is highlighted in different colors', async () => {
    const mk = (guid: string, color: number) => ({ locations: [{ id: 1, book: 20, chapter: 27 }], marks: [{ id: 1, guid, loc: 1, color, ranges: [[1, 5, 0, 9]] }] });
    const r = mergeSources([await load('a', mk('MA', 1)), await load('b', mk('MB', 4))]);
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0].kind).toBe('mark');
  });
  it('single-source items pass through; locations union without dupes', async () => {
    const a = await load('a', { locations: [{ id: 1, book: 20, chapter: 27 }], marks: [{ id: 1, guid: 'MA', loc: 1 }] });
    const b = await load('b', { locations: [{ id: 9, book: 20, chapter: 27 }, { id: 2, book: 43, chapter: 3 }], marks: [{ id: 1, guid: 'MB', loc: 2, ranges: [[1, 7, 1, 4]] }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.marks.size).toBe(2);
    expect(r.merged.locations.size).toBe(2);   // (20,27) deduped across sources
  });
});
```

- [ ] **Step 2: Run** `npm test -- merge.test` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/engine/merge.ts`:

```ts
import {
  emptyUserData, markContentKey, markPlacementKey, noteContentKey,
  bookmarkSlotKey, bookmarkContentKey, inputFieldKey, tagMapKey,
  type UserData, type NoteRec, type MarkRec, type BookmarkRec, type InputFieldRec,
} from './model';

export interface ConflictSide<T> {
  sourceId: string; sourceName: string; deviceName: string; lastModifiedDate: string; item: T;
}
export interface PlaylistSnapshot { tagKey: string; name: string; itemKeys: string[]; }
export type Conflict =
  | { id: string; kind: 'note'; left: ConflictSide<NoteRec>; right: ConflictSide<NoteRec> }
  | { id: string; kind: 'mark'; left: ConflictSide<MarkRec>; right: ConflictSide<MarkRec> }
  | { id: string; kind: 'bookmark'; left: ConflictSide<BookmarkRec>; right: ConflictSide<BookmarkRec> }
  | { id: string; kind: 'inputField'; left: ConflictSide<InputFieldRec>; right: ConflictSide<InputFieldRec> }
  | { id: string; kind: 'playlist'; left: ConflictSide<PlaylistSnapshot>; right: ConflictSide<PlaylistSnapshot> };

export interface MergeResult { merged: UserData; conflicts: Conflict[]; }

const side = <T,>(ud: UserData, item: T): ConflictSide<T> => ({
  sourceId: ud.meta.id, sourceName: ud.meta.name, deviceName: ud.meta.deviceName,
  lastModifiedDate: ud.meta.lastModifiedDate, item,
});

export function mergeSources(sources: UserData[]): MergeResult {
  if (sources.length === 0) throw new Error('No sources to merge.');
  const conflicts: Conflict[] = [];
  let cid = 0;
  const nextId = () => `c${++cid}`;

  const acc = cloneUserData(sources[0], {
    id: 'merged', name: 'merged', deviceName: 'JWL Backup Manager',
    lastModifiedDate: sources[0].meta.lastModifiedDate, creationDate: sources[0].meta.creationDate,
    type: 0, schemaVersion: 16, warnings: sources.flatMap(s => s.meta.warnings),
  });
  // remember which source each accumulated item came from, for conflict labeling
  const noteOrigin = new Map<string, UserData>(); const markOrigin = new Map<string, UserData>();
  for (const g of acc.notes.keys()) noteOrigin.set(g, sources[0]);
  for (const g of acc.marks.keys()) markOrigin.set(g, sources[0]);

  for (const src of sources.slice(1)) {
    // Locations
    for (const [k, loc] of src.locations) {
      const existing = acc.locations.get(k);
      if (!existing) acc.locations.set(k, { ...loc });
      else if (!existing.title && loc.title) existing.title = loc.title;
    }
    // Media (by content hash)
    for (const [h, m] of src.media) {
      const existing = acc.media.get(h);
      if (!existing) acc.media.set(h, { ...m });
      else if (!existing.bytes && m.bytes) existing.bytes = m.bytes;
    }
    // Marks
    const accByContent = new Map([...acc.marks.values()].map(m => [markContentKey(m), m] as const));
    const accByPlacement = new Map([...acc.marks.values()].map(m => [markPlacementKey(m), m] as const));
    for (const [guid, mark] of src.marks) {
      const dup = acc.marks.get(guid);
      if (dup) {
        if (markContentKey(dup) !== markContentKey(mark))
          conflicts.push({ id: nextId(), kind: 'mark', left: side(markOrigin.get(guid) ?? sources[0], dup), right: side(src, mark) });
        continue;
      }
      if (accByContent.has(markContentKey(mark))) continue;               // identical, different guid
      const placed = accByPlacement.get(markPlacementKey(mark));
      if (placed) {                                                        // same text, different color/style
        conflicts.push({ id: nextId(), kind: 'mark', left: side(markOrigin.get(placed.guid) ?? sources[0], placed), right: side(src, mark) });
        continue;
      }
      acc.marks.set(guid, { ...mark, ranges: mark.ranges.map(r => ({ ...r })) });
      markOrigin.set(guid, src);
      accByContent.set(markContentKey(mark), acc.marks.get(guid)!);
      accByPlacement.set(markPlacementKey(mark), acc.marks.get(guid)!);
    }
    // Notes
    const notesByContent = new Map([...acc.notes.values()].map(n => [noteContentKey(n), n] as const));
    for (const [guid, note] of src.notes) {
      const dup = acc.notes.get(guid);
      if (dup) {
        if (noteContentKey(dup) !== noteContentKey(note))
          conflicts.push({ id: nextId(), kind: 'note', left: side(noteOrigin.get(guid) ?? sources[0], dup), right: side(src, note) });
        continue;
      }
      if (notesByContent.has(noteContentKey(note))) continue;
      acc.notes.set(guid, { ...note });
      noteOrigin.set(guid, src);
      notesByContent.set(noteContentKey(note), acc.notes.get(guid)!);
    }
    mergeRest(acc, src, conflicts, nextId);   // tags/tagMaps/playlists/bookmarks/inputFields — Task 8
  }
  return { merged: acc, conflicts };
}

export function cloneUserData(src: UserData, meta: UserData['meta']): UserData {
  const ud = emptyUserData(meta);
  for (const [k, v] of src.locations) ud.locations.set(k, { ...v });
  for (const [k, v] of src.marks) ud.marks.set(k, { ...v, ranges: v.ranges.map(r => ({ ...r })) });
  for (const [k, v] of src.notes) ud.notes.set(k, { ...v });
  for (const [k, v] of src.tags) ud.tags.set(k, { ...v });
  ud.tagMaps = src.tagMaps.map(t => ({ ...t, target: { ...t.target } as any }));
  ud.bookmarks = src.bookmarks.map(b => ({ ...b }));
  ud.inputFields = src.inputFields.map(f => ({ ...f }));
  for (const [k, v] of src.playlistItems)
    ud.playlistItems.set(k, { ...v, markers: v.markers.map(m => ({ ...m, verseIds: [...m.verseIds], paragraphs: m.paragraphs.map(p => ({ ...p })) })), mediaRefs: v.mediaRefs.map(m => ({ ...m })), locationRefs: v.locationRefs.map(l => ({ ...l })) });
  for (const [k, v] of src.media) ud.media.set(k, { ...v });
  return ud;
}

// Implemented in Task 8 — placeholder so Task 7 compiles and its tests pass.
function mergeRest(acc: UserData, src: UserData, conflicts: Conflict[], nextId: () => string): void {}
```

- [ ] **Step 4: Run** `npm test -- merge.test` → PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: merge engine for locations, highlights, notes"`

### Task 8: Merge engine — tags, playlists, bookmarks, input fields

**Files:**
- Modify: `src/lib/engine/merge.ts` (replace the empty `mergeRest`)
- Test: `tests/merge-rest.test.ts`

- [ ] **Step 1: Failing tests** — `tests/merge-rest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeSources } from '../src/lib/engine/merge';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer } from './helpers/build';

const load = async (name: string, spec: any, media: Record<string, Uint8Array> = {}) =>
  normalizeContainer(name, await buildModernContainer(spec, media));

describe('mergeSources — tags/playlists/bookmarks/inputFields', () => {
  it('unions tags and tag assignments without duplicates', async () => {
    const a = await load('a', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'C' }], tags: [{ id: 1, name: 'talks' }], tagMaps: [{ tag: 1, note: 1 }] });
    const b = await load('b', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'C' }], tags: [{ id: 1, name: 'talks' }, { id: 2, name: 'extra' }], tagMaps: [{ tag: 1, note: 1 }, { tag: 2, note: 1 }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.tags.size).toBe(2);
    expect(r.merged.tagMaps.length).toBe(2);   // (talks→N1) deduped
  });
  it('identical playlists merge silently; differing same-name playlists conflict', async () => {
    const base = {
      media: [{ id: 1, hash: 'H1', file: 'A.jpg' }],
      playlistItems: [{ id: 1, label: 'Song 42', mediaRefs: [[1, 100]] }],
      tags: [{ id: 1, type: 2, name: 'My Talk' }],
      tagMaps: [{ tag: 1, item: 1 }],
    };
    const extended = {
      media: [{ id: 1, hash: 'H1', file: 'A.jpg' }, { id: 2, hash: 'H2', file: 'B.mp4', mime: 'video/mp4' }],
      playlistItems: [{ id: 1, label: 'Song 42', mediaRefs: [[1, 100]] }, { id: 2, label: 'Opening video', mediaRefs: [[2, 900]] }],
      tags: [{ id: 1, type: 2, name: 'My Talk' }],
      tagMaps: [{ tag: 1, item: 1 }, { tag: 1, item: 2 }],
    };
    const same = mergeSources([await load('a', base), await load('b', base)]);
    expect(same.conflicts).toEqual([]);
    expect(same.merged.playlistItems.size).toBe(1);

    const diff = mergeSources([await load('a', base), await load('b', extended)]);
    expect(diff.conflicts.length).toBe(1);
    expect(diff.conflicts[0].kind).toBe('playlist');
    expect((diff.conflicts[0].right.item as any).itemKeys.length).toBe(2);
    // all items still available in merged storage (membership decided at resolve)
    expect(diff.merged.playlistItems.size).toBe(2);
  });
  it('bookmark same slot different target conflicts; different slots union', async () => {
    const locs = [{ id: 1, book: 20, chapter: 27 }, { id: 2, book: 43, chapter: 3 }, { id: 3, keySymbol: 'w26', doc: 1, title: 'Pub' }];
    const a = await load('a', { locations: locs, bookmarks: [{ loc: 1, pubLoc: 3, slot: 0, title: 'Prov' }] });
    const b = await load('b', { locations: locs, bookmarks: [{ loc: 2, pubLoc: 3, slot: 0, title: 'John' }, { loc: 1, pubLoc: 3, slot: 1, title: 'Prov' }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0].kind).toBe('bookmark');
    expect(r.merged.bookmarks.length).toBe(2);  // slot0 (left kept until resolve) + slot1
  });
  it('input field same key different value conflicts', async () => {
    const locs = [{ id: 1, keySymbol: 'lff', doc: 5, title: 'Lesson' }];
    const a = await load('a', { locations: locs, inputFields: [{ loc: 1, tag: 'tt1', value: 'my answer' }] });
    const b = await load('b', { locations: locs, inputFields: [{ loc: 1, tag: 'tt1', value: 'different answer' }] });
    const r = mergeSources([a, b]);
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0].kind).toBe('inputField');
  });
});
```

- [ ] **Step 2: Run** `npm test -- merge-rest` → FAIL.

- [ ] **Step 3: Implement** — replace the `mergeRest` stub in `src/lib/engine/merge.ts`:

```ts
function mergeRest(acc: UserData, src: UserData, conflicts: Conflict[], nextId: () => string): void {
  // Playlist items are pure content — union by content key (membership handled via playlists below)
  for (const [k, item] of src.playlistItems)
    if (!acc.playlistItems.has(k))
      acc.playlistItems.set(k, { ...item, markers: item.markers.map(m => ({ ...m, verseIds: [...m.verseIds], paragraphs: m.paragraphs.map(p => ({ ...p })) })), mediaRefs: item.mediaRefs.map(m => ({ ...m })), locationRefs: item.locationRefs.map(l => ({ ...l })) });

  // Detect playlist conflicts BEFORE folding tags/tagMaps
  const playlistMembers = (ud: UserData, tk: string) =>
    ud.tagMaps.filter(t => t.tagKey === tk && t.target.kind === 'playlistItem')
      .sort((x, y) => x.position - y.position)
      .map(t => (t.target as { kind: 'playlistItem'; itemKey: string }).itemKey);
  const conflictedPlaylistTags = new Set<string>();
  for (const [tk, tag] of src.tags) {
    if (tag.type !== 2 || !acc.tags.has(tk)) continue;
    const l = playlistMembers(acc, tk), r = playlistMembers(src, tk);
    if (JSON.stringify(l) !== JSON.stringify(r)) {
      conflictedPlaylistTags.add(tk);
      conflicts.push({
        id: nextId(), kind: 'playlist',
        left: { sourceId: acc.meta.id, sourceName: acc.meta.name, deviceName: acc.meta.deviceName, lastModifiedDate: acc.meta.lastModifiedDate, item: { tagKey: tk, name: tag.name, itemKeys: l } },
        right: { sourceId: src.meta.id, sourceName: src.meta.name, deviceName: src.meta.deviceName, lastModifiedDate: src.meta.lastModifiedDate, item: { tagKey: tk, name: tag.name, itemKeys: r } },
      });
    }
  }

  // Tags
  for (const [tk, tag] of src.tags) if (!acc.tags.has(tk)) acc.tags.set(tk, { ...tag });

  // TagMaps — dedupe by (tag, target); skip members of conflicted playlists (resolve decides those)
  const seen = new Set(acc.tagMaps.map(tagMapKey));
  for (const tm of src.tagMaps) {
    if (conflictedPlaylistTags.has(tm.tagKey) && tm.target.kind === 'playlistItem') continue;
    const k = tagMapKey(tm);
    if (seen.has(k)) continue;
    seen.add(k);
    acc.tagMaps.push({ ...tm, target: { ...tm.target } as any });
  }

  // Bookmarks
  const bySlot = new Map(acc.bookmarks.map(b => [bookmarkSlotKey(b), b] as const));
  const byContent = new Set(acc.bookmarks.map(bookmarkContentKey));
  for (const bm of src.bookmarks) {
    if (byContent.has(bookmarkContentKey(bm))) continue;
    const clash = bySlot.get(bookmarkSlotKey(bm));
    if (clash) {
      conflicts.push({ id: nextId(), kind: 'bookmark',
        left: { sourceId: acc.meta.id, sourceName: acc.meta.name, deviceName: acc.meta.deviceName, lastModifiedDate: acc.meta.lastModifiedDate, item: clash },
        right: { sourceId: src.meta.id, sourceName: src.meta.name, deviceName: src.meta.deviceName, lastModifiedDate: src.meta.lastModifiedDate, item: bm } });
      continue;
    }
    const copy = { ...bm };
    acc.bookmarks.push(copy); bySlot.set(bookmarkSlotKey(copy), copy); byContent.add(bookmarkContentKey(copy));
  }

  // InputFields
  const fieldByKey = new Map(acc.inputFields.map(f => [inputFieldKey(f), f] as const));
  for (const f of src.inputFields) {
    const existing = fieldByKey.get(inputFieldKey(f));
    if (!existing) { const copy = { ...f }; acc.inputFields.push(copy); fieldByKey.set(inputFieldKey(copy), copy); continue; }
    if (existing.value !== f.value)
      conflicts.push({ id: nextId(), kind: 'inputField',
        left: { sourceId: acc.meta.id, sourceName: acc.meta.name, deviceName: acc.meta.deviceName, lastModifiedDate: acc.meta.lastModifiedDate, item: existing },
        right: { sourceId: src.meta.id, sourceName: src.meta.name, deviceName: src.meta.deviceName, lastModifiedDate: src.meta.lastModifiedDate, item: f } });
  }
}
```

Note the conflict `left` sides here carry `acc.meta` (the running merge), not the original source. That is acceptable for kinds where the left item may itself be a prior merge product; the UI labels the left side "Merged so far" when `sourceId === 'merged'` and left items came from source 1 otherwise. For the common 2-source case the left side is simply the first backup.

- [ ] **Step 4: Run** `npm test -- merge` → both merge test files PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: merge tags, playlists, bookmarks, input fields with conflict detection"`

### Task 9: Resolution engine

**Files:**
- Create: `src/lib/engine/resolve.ts`, `tests/resolve.test.ts`

Decision model — one entry per conflict id:

```
'left' | 'right' | 'both' | { merged: { title: string | null; content: string | null } }   // merged: notes only
```

Semantics: `left` = keep what's in merged (no-op). `right` = replace left item with right. `both` = keep left AND add right (notes/marks: right keeps its own GUID or gets `-2` suffix if colliding; bookmarks: right moves to next free slot; playlists: right becomes "Name (2)"; inputField: 'both' invalid → treated as 'right' concatenated? NO — inputFields only allow left/right, UI enforces it, engine throws). Bulk rule helper `bulkDecide(conflicts, rule)` returns a decision map.

- [ ] **Step 1: Failing tests** — `tests/resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeSources } from '../src/lib/engine/merge';
import { applyResolutions, bulkDecide } from '../src/lib/engine/resolve';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer } from './helpers/build';

const load = async (name: string, spec: any) => normalizeContainer(name, await buildModernContainer(spec));
const noteConflictPair = async () => {
  const a = await load('a', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'iPhone', modified: '2026-07-12T00:00:00Z' }] });
  const b = await load('b', { locations: [{ id: 1, book: 20, chapter: 27 }], notes: [{ id: 1, guid: 'N1', loc: 1, title: 'T', content: 'iPad', modified: '2025-10-13T00:00:00Z' }] });
  return mergeSources([a, b]);
};

describe('applyResolutions', () => {
  it('left keeps left', async () => {
    const r = await noteConflictPair();
    const out = applyResolutions(r, { [r.conflicts[0].id]: 'left' });
    expect(out.notes.get('N1')!.content).toBe('iPhone');
  });
  it('right swaps in right version', async () => {
    const r = await noteConflictPair();
    const out = applyResolutions(r, { [r.conflicts[0].id]: 'right' });
    expect(out.notes.get('N1')!.content).toBe('iPad');
  });
  it('both keeps two notes with distinct guids', async () => {
    const r = await noteConflictPair();
    const out = applyResolutions(r, { [r.conflicts[0].id]: 'both' });
    expect(out.notes.size).toBe(2);
    const contents = [...out.notes.values()].map(n => n.content).sort();
    expect(contents).toEqual(['iPad', 'iPhone']);
    expect(new Set([...out.notes.keys()]).size).toBe(2);
  });
  it('merged custom text wins with newest lastModified', async () => {
    const r = await noteConflictPair();
    const out = applyResolutions(r, { [r.conflicts[0].id]: { merged: { title: 'T', content: 'combined' } } });
    const n = out.notes.get('N1')!;
    expect(n.content).toBe('combined');
    expect(n.lastModified).toBe('2026-07-12T00:00:00Z');
  });
  it('unresolved conflicts throw a clear error', async () => {
    const r = await noteConflictPair();
    expect(() => applyResolutions(r, {})).toThrow(/unresolved/i);
  });
  it('playlist both duplicates under renamed playlist', async () => {
    const base = { media: [{ id: 1, hash: 'H1', file: 'A.jpg' }], playlistItems: [{ id: 1, label: 'S', mediaRefs: [[1, 1]] }], tags: [{ id: 1, type: 2, name: 'P' }], tagMaps: [{ tag: 1, item: 1 }] };
    const ext = { ...base, playlistItems: [...base.playlistItems, { id: 2, label: 'S2', mediaRefs: [[1, 2]] }], tagMaps: [{ tag: 1, item: 1 }, { tag: 1, item: 2 }] };
    const r = mergeSources([await load('a', base), await load('b', ext)]);
    const out = applyResolutions(r, { [r.conflicts[0].id]: 'both' });
    expect([...out.tags.values()].filter(t => t.type === 2).map(t => t.name).sort()).toEqual(['P', 'P (2)']);
  });
});

describe('bulkDecide', () => {
  it('newest wins picks the newer side per conflict', async () => {
    const r = await noteConflictPair();
    expect(bulkDecide(r.conflicts, 'newest')).toEqual({ [r.conflicts[0].id]: 'left' });  // iPhone note is newer
  });
  it('device wins matches deviceName', async () => {
    const r = await noteConflictPair();
    expect(bulkDecide(r.conflicts, { device: 'TestDevice' })).toEqual({ [r.conflicts[0].id]: 'left' });
  });
});
```

- [ ] **Step 2: Run** `npm test -- resolve` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/engine/resolve.ts`:

```ts
import { bookmarkSlotKey, tagKey, tagMapKey, type UserData, type NoteRec } from './model';
import { cloneUserData, type Conflict, type MergeResult } from './merge';

export type Decision = 'left' | 'right' | 'both' | { merged: { title: string | null; content: string | null } };
export type Decisions = Record<string, Decision>;

export function applyResolutions(result: MergeResult, decisions: Decisions): UserData {
  const missing = result.conflicts.filter(c => !(c.id in decisions));
  if (missing.length) throw new Error(`${missing.length} unresolved conflict(s) remain — resolve them before exporting.`);
  const out = cloneUserData(result.merged, result.merged.meta);

  for (const c of result.conflicts) {
    const d = decisions[c.id];
    switch (c.kind) {
      case 'note': {
        const left = c.left.item, right = c.right.item;
        if (d === 'left') break;
        if (d === 'right') { out.notes.set(left.guid, { ...right, guid: left.guid }); break; }
        if (d === 'both') {
          let g = right.guid === left.guid ? `${right.guid}-2` : right.guid;
          while (out.notes.has(g)) g = `${g}-2`;
          out.notes.set(g, { ...right, guid: g });
          break;
        }
        const newest = left.lastModified >= right.lastModified ? left.lastModified : right.lastModified;
        out.notes.set(left.guid, { ...left, title: d.merged.title, content: d.merged.content, lastModified: newest });
        break;
      }
      case 'mark': {
        const left = c.left.item, right = c.right.item;
        if (d === 'left') break;
        if (d === 'right') { out.marks.set(left.guid, { ...right, guid: left.guid, ranges: right.ranges.map(r => ({ ...r })) }); break; }
        if (d === 'both') {
          let g = right.guid === left.guid ? `${right.guid}-2` : right.guid;
          while (out.marks.has(g)) g = `${g}-2`;
          out.marks.set(g, { ...right, guid: g, ranges: right.ranges.map(r => ({ ...r })) });
          break;
        }
        throw new Error('Highlights cannot be text-merged — choose left, right, or both.');
      }
      case 'bookmark': {
        const leftKey = bookmarkSlotKey(c.left.item);
        const idx = out.bookmarks.findIndex(b => bookmarkSlotKey(b) === leftKey);
        if (d === 'left') break;
        if (d === 'right') { out.bookmarks[idx] = { ...c.right.item }; break; }
        if (d === 'both') {
          const used = new Set(out.bookmarks.filter(b => b.pubLocKey === c.right.item.pubLocKey).map(b => b.slot));
          let slot = 0; while (used.has(slot)) slot++;
          out.bookmarks.push({ ...c.right.item, slot });
          break;
        }
        throw new Error('Bookmarks cannot be text-merged — choose left, right, or both.');
      }
      case 'inputField': {
        const k = JSON.stringify([c.left.item.locKey, c.left.item.textTag]);
        const idx = out.inputFields.findIndex(f => JSON.stringify([f.locKey, f.textTag]) === k);
        if (d === 'left') break;
        if (d === 'right') { out.inputFields[idx] = { ...c.right.item }; break; }
        throw new Error('Study answers can only keep one value — choose left or right.');
      }
      case 'playlist': {
        const tk = c.left.item.tagKey;
        const mkMaps = (itemKeys: string[], key: string) =>
          itemKeys.map((itemKey, i) => ({ tagKey: key, target: { kind: 'playlistItem' as const, itemKey }, position: i }));
        // strip existing membership for this playlist, then rebuild per decision
        out.tagMaps = out.tagMaps.filter(t => !(t.tagKey === tk && t.target.kind === 'playlistItem'));
        if (d === 'left') { out.tagMaps.push(...mkMaps(c.left.item.itemKeys, tk)); break; }
        if (d === 'right') { out.tagMaps.push(...mkMaps(c.right.item.itemKeys, tk)); break; }
        if (d === 'both') {
          out.tagMaps.push(...mkMaps(c.left.item.itemKeys, tk));
          let name = `${c.left.item.name} (2)`, n = 2;
          while (out.tags.has(tagKey({ type: 2, name }))) name = `${c.left.item.name} (${++n})`;
          const tk2 = tagKey({ type: 2, name });
          out.tags.set(tk2, { type: 2, name });
          out.tagMaps.push(...mkMaps(c.right.item.itemKeys, tk2));
          break;
        }
        throw new Error('Playlists cannot be text-merged — choose left, right, or both.');
      }
    }
  }
  // dedupe any tagMap duplicates introduced by swaps
  const seen = new Set<string>();
  out.tagMaps = out.tagMaps.filter(t => { const k = tagMapKey(t); if (seen.has(k)) return false; seen.add(k); return true; });
  return out;
}

export type BulkRule = 'newest' | 'both' | { device: string };

export function bulkDecide(conflicts: Conflict[], rule: BulkRule): Decisions {
  const d: Decisions = {};
  for (const c of conflicts) {
    if (rule === 'both') { d[c.id] = c.kind === 'inputField' ? 'right' : 'both'; continue; }
    if (typeof rule === 'object') {
      d[c.id] = c.right.deviceName === rule.device && c.left.deviceName !== rule.device ? 'right' : 'left';
      continue;
    }
    // newest: prefer item-level lastModified (notes), fall back to source lastModifiedDate
    const lm = (s: { lastModifiedDate: string; item: any }) => s.item?.lastModified ?? s.lastModifiedDate ?? '';
    d[c.id] = lm(c.right) > lm(c.left) ? 'right' : 'left';
  }
  return d;
}
```

- [ ] **Step 4: Run** `npm test -- resolve` → PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: conflict resolution with keep/swap/both/merge and bulk rules"`

### Task 10: Export engine

**Files:**
- Create: `src/lib/engine/export.ts`, `tests/export.test.ts`

- [ ] **Step 1: Failing tests** — `tests/export.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { exportContainer, verifyContainer } from '../src/lib/engine/export';
import { mergeSources } from '../src/lib/engine/merge';
import { normalizeContainer } from '../src/lib/engine/normalize';
import { buildModernContainer } from './helpers/build';
import { sha256Hex } from '../src/lib/engine/manifest';
import { openContainer } from '../src/lib/engine/zip';

const load = async (name: string, spec: any, media: Record<string, Uint8Array> = {}) =>
  normalizeContainer(name, await buildModernContainer(spec, media));

const richSpec = {
  locations: [{ id: 1, book: 20, chapter: 27 }, { id: 2, keySymbol: 'w26', doc: 9, title: 'Pub' }],
  marks: [{ id: 1, guid: 'M1', loc: 1, color: 2, ranges: [[1, 11, 2, 9]] }],
  notes: [{ id: 1, guid: 'N1', loc: 1, mark: 1, title: 'T', content: 'C' }],
  tags: [{ id: 1, name: 'talks' }, { id: 2, type: 2, name: 'PL' }],
  media: [{ id: 1, hash: 'H1', file: 'A.jpg' }],
  playlistItems: [{ id: 1, label: 'Song', thumb: 'A.jpg', mediaRefs: [[1, 100]], markers: [{ id: 1, label: 'intro', start: 0, dur: 50 }] }],
  tagMaps: [{ tag: 1, note: 1 }, { tag: 2, item: 1 }],
  bookmarks: [{ loc: 1, pubLoc: 2, slot: 0, title: 'BM' }],
  inputFields: [{ loc: 2, tag: 'tt1', value: 'ans' }],
};

describe('exportContainer', () => {
  it('round-trips: export → normalize gives identical model', async () => {
    const ud = await load('a', richSpec, { 'A.jpg': new Uint8Array([1, 2]) });
    const { fileBytes } = await exportContainer(ud, 'merged_test');
    const back = await normalizeContainer('back.jwlibrary', fileBytes);
    expect(back.marks.get('M1')!.ranges).toEqual(ud.marks.get('M1')!.ranges);
    expect(back.notes.get('N1')!.content).toBe('C');
    expect([...back.tags.values()]).toEqual(expect.arrayContaining([...ud.tags.values()]));
    expect(back.playlistItems.size).toBe(1);
    expect([...back.playlistItems.values()][0].thumbnailMediaHash).toBe('H1');
    expect(back.bookmarks.length).toBe(1);
    expect(back.inputFields[0].value).toBe('ans');
    expect(back.media.get('H1')!.bytes).toEqual(new Uint8Array([1, 2]));
  });
  it('manifest hash matches db bytes', async () => {
    const ud = await load('a', richSpec, { 'A.jpg': new Uint8Array([1]) });
    const { fileBytes } = await exportContainer(ud, 'merged_test');
    const c = openContainer(fileBytes);
    expect(c.manifestRaw.userDataBackup.hash).toBe(await sha256Hex(c.dbBytes));
    expect(c.manifestRaw.userDataBackup.schemaVersion).toBe(16);
    expect(c.manifestRaw.type).toBe(0);
  });
  it('merge with self then export equals single-source export (invariant)', async () => {
    const a = await load('a', richSpec, { 'A.jpg': new Uint8Array([1]) });
    const b = await load('b', richSpec, { 'A.jpg': new Uint8Array([1]) });
    const r = mergeSources([a, b]);
    expect(r.conflicts).toEqual([]);
    const single = await normalizeContainer('s.jwlibrary', (await exportContainer(a, 'x')).fileBytes);
    const merged = await normalizeContainer('m.jwlibrary', (await exportContainer(r.merged, 'x')).fileBytes);
    expect(merged.notes.size).toBe(single.notes.size);
    expect(merged.marks.size).toBe(single.marks.size);
    expect(merged.tagMaps.length).toBe(single.tagMaps.length);
    expect(merged.playlistItems.size).toBe(single.playlistItems.size);
  });
  it('verifyContainer reports counts and ok', async () => {
    const ud = await load('a', richSpec, { 'A.jpg': new Uint8Array([1]) });
    const { fileBytes } = await exportContainer(ud, 'merged_test');
    const v = await verifyContainer(fileBytes);
    expect(v.ok).toBe(true);
    expect(v.counts.notes).toBe(1);
    expect(v.counts.highlights).toBe(1);
    expect(v.counts.playlistItems).toBe(1);
  });
  it('exports a single playlist as .jwlplaylist (type 1)', async () => {
    const ud = await load('a', richSpec, { 'A.jpg': new Uint8Array([1]) });
    const { fileBytes } = await exportContainer(ud, 'PL', { type: 1, onlyPlaylistTagKey: JSON.stringify([2, 'PL']) });
    const c = openContainer(fileBytes);
    expect(c.manifestRaw.type).toBe(1);
    const back = await normalizeContainer('pl.jwlplaylist', fileBytes);
    expect(back.playlistItems.size).toBe(1);
    expect(back.notes.size).toBe(0);          // playlist exports carry no notes
  });
});
```

- [ ] **Step 2: Run** `npm test -- export` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/engine/export.ts`:

```ts
import type { Database } from 'sql.js';
import { createCanonicalDb } from './schema';
import { exportDb, openDb } from './db';
import { generateManifest, sha256Hex } from './manifest';
import { packContainer, openContainer } from './zip';
import { locKey, type UserData } from './model';

export interface ExportOptions { type?: 0 | 1; onlyPlaylistTagKey?: string; }
export interface ExportResult { fileBytes: Uint8Array; fileName: string; }

export async function exportContainer(ud: UserData, baseName: string, opts: ExportOptions = {}): Promise<ExportResult> {
  const type = opts.type ?? 0;
  const data = opts.onlyPlaylistTagKey ? filterToPlaylist(ud, opts.onlyPlaylistTagKey) : ud;
  const db = await createCanonicalDb();
  const media = writeDb(db, data);
  const dbBytes = exportDb(db); db.close();
  const manifest = await generateManifest(dbBytes, { name: baseName, type, deviceName: 'JWL Backup Manager' });
  const fileBytes = packContainer({ manifest, dbName: 'userData.db', dbBytes, media });
  return { fileBytes, fileName: `${baseName}.${type === 1 ? 'jwlplaylist' : 'jwlibrary'}` };
}

function filterToPlaylist(ud: UserData, tagKeyWanted: string): UserData {
  const memberKeys = new Set(ud.tagMaps
    .filter(t => t.tagKey === tagKeyWanted && t.target.kind === 'playlistItem')
    .map(t => (t.target as { itemKey: string }).itemKey));
  const out: UserData = { ...ud,
    notes: new Map(), marks: new Map(), bookmarks: [], inputFields: [],
    tags: new Map([...ud.tags].filter(([k]) => k === tagKeyWanted)),
    tagMaps: ud.tagMaps.filter(t => t.tagKey === tagKeyWanted && t.target.kind === 'playlistItem'),
    playlistItems: new Map([...ud.playlistItems].filter(([k]) => memberKeys.has(k))),
  };
  const usedHashes = new Set<string>();
  for (const item of out.playlistItems.values()) {
    for (const m of item.mediaRefs) usedHashes.add(m.mediaHash);
    if (item.thumbnailMediaHash) usedHashes.add(item.thumbnailMediaHash);
  }
  out.media = new Map([...ud.media].filter(([h]) => usedHashes.has(h)));
  // keep only locations referenced by kept playlist items
  const usedLocs = new Set<string>();
  for (const item of out.playlistItems.values()) for (const l of item.locationRefs) usedLocs.add(l.locKey);
  out.locations = new Map([...ud.locations].filter(([k]) => usedLocs.has(k)));
  return out;
}

/** Writes the model into a canonical db. Returns the media file map for the zip. */
function writeDb(db: Database, ud: UserData): Map<string, Uint8Array> {
  // Locations
  const locIds = new Map<string, number>(); let locId = 0;
  for (const [k, l] of ud.locations) {
    locIds.set(k, ++locId);
    db.run(`INSERT INTO Location(LocationId,BookNumber,ChapterNumber,DocumentId,Track,IssueTagNumber,KeySymbol,MepsLanguage,Type,Title,Specialty,Edition) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [locId, l.bookNumber, l.chapterNumber, l.documentId, l.track, l.issueTagNumber, l.keySymbol, l.mepsLanguage, l.type, l.title, l.specialty, l.edition]);
  }
  const locIdOf = (k: string | null) => (k != null ? locIds.get(k) ?? null : null);

  // Media — unique zip filenames; PlaylistItem.ThumbnailFilePath FK needs final paths
  const mediaFiles = new Map<string, Uint8Array>();
  const mediaIds = new Map<string, number>(); const mediaPath = new Map<string, string>();
  const takenPaths = new Set<string>(); let mediaId = 0;
  for (const [h, m] of ud.media) {
    let path = m.filePath;
    while (takenPaths.has(path)) path = `${mediaId}_${path}`;
    takenPaths.add(path);
    mediaIds.set(h, ++mediaId); mediaPath.set(h, path);
    db.run(`INSERT INTO IndependentMedia(IndependentMediaId,OriginalFilename,FilePath,MimeType,Hash) VALUES (?,?,?,?,?)`,
      [mediaId, m.originalFilename, path, m.mimeType, m.hash]);
    if (m.bytes) mediaFiles.set(path, m.bytes);
  }

  // UserMarks + BlockRanges
  const markIds = new Map<string, number>(); let markId = 0; let rangeId = 0;
  for (const [guid, m] of ud.marks) {
    const lid = locIdOf(m.locKey);
    if (lid == null) continue;
    markIds.set(guid, ++markId);
    db.run(`INSERT INTO UserMark(UserMarkId,ColorIndex,LocationId,StyleIndex,UserMarkGuid,Version) VALUES (?,?,?,?,?,?)`,
      [markId, m.colorIndex, lid, m.styleIndex, guid, m.version]);
    for (const r of m.ranges)
      db.run(`INSERT INTO BlockRange(BlockRangeId,BlockType,Identifier,StartToken,EndToken,UserMarkId) VALUES (?,?,?,?,?,?)`,
        [++rangeId, r.blockType, r.identifier, r.startToken, r.endToken, markId]);
  }

  // Notes
  const noteIds = new Map<string, number>(); let noteId = 0;
  for (const [guid, n] of ud.notes) {
    noteIds.set(guid, ++noteId);
    db.run(`INSERT INTO Note(NoteId,Guid,UserMarkId,LocationId,Title,Content,LastModified,Created,BlockType,BlockIdentifier) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [noteId, guid, n.markGuid ? markIds.get(n.markGuid) ?? null : null, locIdOf(n.locKey),
       n.title, n.content, n.lastModified, n.created, n.blockType, n.blockIdentifier]);
  }

  // PlaylistItems (+ markers + maps)
  const itemIds = new Map<string, number>(); let itemId = 0; let markerId = 0;
  for (const [k, p] of ud.playlistItems) {
    itemIds.set(k, ++itemId);
    db.run(`INSERT INTO PlaylistItem(PlaylistItemId,Label,StartTrimOffsetTicks,EndTrimOffsetTicks,Accuracy,EndAction,ThumbnailFilePath) VALUES (?,?,?,?,?,?,?)`,
      [itemId, p.label, p.startTrimOffsetTicks, p.endTrimOffsetTicks, p.accuracy, p.endAction,
       p.thumbnailMediaHash ? mediaPath.get(p.thumbnailMediaHash) ?? null : null]);
    for (const m of p.mediaRefs) {
      const mid = mediaIds.get(m.mediaHash);
      if (mid) db.run(`INSERT INTO PlaylistItemIndependentMediaMap VALUES (?,?,?)`, [itemId, mid, m.durationTicks]);
    }
    for (const l of p.locationRefs) {
      const lid = locIdOf(l.locKey);
      if (lid) db.run(`INSERT INTO PlaylistItemLocationMap VALUES (?,?,?,?)`, [itemId, lid, l.majorMultimediaType, l.baseDurationTicks]);
    }
    for (const mk of p.markers) {
      db.run(`INSERT INTO PlaylistItemMarker VALUES (?,?,?,?,?,?)`,
        [++markerId, itemId, mk.label, mk.startTimeTicks, mk.durationTicks, mk.endTransitionDurationTicks]);
      for (const v of mk.verseIds) db.run(`INSERT INTO PlaylistItemMarkerBibleVerseMap VALUES (?,?)`, [markerId, v]);
      for (const pp of mk.paragraphs)
        db.run(`INSERT INTO PlaylistItemMarkerParagraphMap VALUES (?,?,?,?)`, [markerId, pp.mepsDocumentId, pp.paragraphIndex, pp.markerIndexWithinParagraph]);
    }
  }

  // Tags + TagMaps (Position renumbered per tag: unique, ordered)
  const tagIds = new Map<string, number>(); let tagId = 0;
  for (const [k, t] of ud.tags) { tagIds.set(k, ++tagId); db.run(`INSERT INTO Tag(TagId,Type,Name) VALUES (?,?,?)`, [tagId, t.type, t.name]); }
  let tagMapId = 0;
  const byTag = new Map<string, typeof ud.tagMaps>();
  for (const tm of ud.tagMaps) { if (!byTag.has(tm.tagKey)) byTag.set(tm.tagKey, []); byTag.get(tm.tagKey)!.push(tm); }
  for (const [tk, maps] of byTag) {
    const tid = tagIds.get(tk); if (!tid) continue;
    maps.sort((a, b) => a.position - b.position);
    let pos = 0;
    for (const tm of maps) {
      let pid: number | null = null, lid: number | null = null, nid: number | null = null;
      if (tm.target.kind === 'playlistItem') { pid = itemIds.get(tm.target.itemKey) ?? null; if (!pid) continue; }
      if (tm.target.kind === 'location') { lid = locIdOf(tm.target.locKey); if (!lid) continue; }
      if (tm.target.kind === 'note') { nid = noteIds.get(tm.target.guid) ?? null; if (!nid) continue; }
      db.run(`INSERT INTO TagMap(TagMapId,PlaylistItemId,LocationId,NoteId,TagId,Position) VALUES (?,?,?,?,?,?)`,
        [++tagMapId, pid, lid, nid, tid, pos++]);
    }
  }

  // Bookmarks + InputFields + LastModified
  let bmId = 0;
  for (const b of ud.bookmarks) {
    const lid = locIdOf(b.locKey), pid = locIdOf(b.pubLocKey);
    if (lid && pid) db.run(`INSERT INTO Bookmark(BookmarkId,LocationId,PublicationLocationId,Slot,Title,Snippet,BlockType,BlockIdentifier) VALUES (?,?,?,?,?,?,?,?)`,
      [++bmId, lid, pid, b.slot, b.title, b.snippet, b.blockType, b.blockIdentifier]);
  }
  for (const f of ud.inputFields) {
    const lid = locIdOf(f.locKey);
    if (lid) db.run(`INSERT INTO InputField(LocationId,TextTag,Value) VALUES (?,?,?)`, [lid, f.textTag, f.value]);
  }
  db.run(`INSERT INTO LastModified VALUES (?)`, [new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')]);
  return mediaFiles;
}

export interface Verification {
  ok: boolean; problems: string[];
  counts: { notes: number; highlights: number; playlistItems: number; tags: number; bookmarks: number; inputFields: number; locations: number; media: number };
}

export async function verifyContainer(fileBytes: Uint8Array): Promise<Verification> {
  const problems: string[] = [];
  const c = openContainer(fileBytes);
  if (c.manifestRaw.userDataBackup.hash !== await sha256Hex(c.dbBytes)) problems.push('Manifest hash does not match database bytes.');
  const db = await openDb(c.dbBytes);
  try {
    const fk = db.exec(`PRAGMA foreign_key_check`);
    if (fk.length && fk[0].values.length) problems.push(`Foreign key violations: ${fk[0].values.length}`);
    const integrity = db.exec(`PRAGMA integrity_check`)[0].values[0][0];
    if (integrity !== 'ok') problems.push(`Integrity check: ${integrity}`);
    const count = (t: string) => Number(db.exec(`SELECT COUNT(*) FROM ${t}`)[0].values[0][0]);
    const counts = { notes: count('Note'), highlights: count('UserMark'), playlistItems: count('PlaylistItem'),
      tags: count('Tag'), bookmarks: count('Bookmark'), inputFields: count('InputField'),
      locations: count('Location'), media: count('IndependentMedia') };
    // every media row must exist in the zip if it had bytes
    for (const [path] of db.exec(`SELECT FilePath FROM IndependentMedia`)[0]?.values ?? [])
      if (!c.media.has(String(path))) problems.push(`Media file missing from archive: ${path}`);
    return { ok: problems.length === 0, problems, counts };
  } finally { db.close(); }
}
```

Note on missing media bytes: sources sometimes reference media files absent from the container (observed in real backups). `verifyContainer` flags them; the UI (Task 15) shows the warning but still allows export — matching what JW Library itself tolerates.

- [ ] **Step 4: Run** `npm test -- export` → PASS. If the "media file missing" check trips the happy-path test, ensure fixtures pass bytes for every media row.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: export to .jwlibrary/.jwlplaylist with verification"`

### Task 11: Stats for the explorer

**Files:**
- Create: `src/lib/engine/stats.ts`, `tests/stats.test.ts`

- [ ] **Step 1: Failing tests** — `tests/stats.test.ts`:

```ts
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
    expect(s.totals.playlists).toBe(1);          // tags with type 2
    expect(s.totals.tags).toBe(1);               // user tags only (type 1)
    expect(s.colorCounts[1]).toBe(1);
    expect(s.colorCounts[4]).toBe(1);
    expect(s.timeline.find(b => b.month === '2025-03')!.notes).toBe(2);  // bucketed by Created
    expect(s.perSource[0].sourceId).toBe('a');
    expect(JWL_COLORS[1].hex).toBe('#ffd951');
  });
});
```

- [ ] **Step 2: Run** `npm test -- stats` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/engine/stats.ts`:

```ts
import type { UserData } from './model';

export const JWL_COLORS: Record<number, { name: string; hex: string }> = {
  1: { name: 'Yellow', hex: '#ffd951' }, 2: { name: 'Green', hex: '#9fdd7a' },
  3: { name: 'Blue', hex: '#8ecafc' }, 4: { name: 'Pink', hex: '#f7a8d8' },
  5: { name: 'Orange', hex: '#ffb17a' }, 6: { name: 'Purple', hex: '#c3b1f7' },
};

export interface Totals { highlights: number; notes: number; playlists: number; playlistItems: number; tags: number; bookmarks: number; inputFields: number; }
export interface TimelineBucket { month: string; notes: number; }
export interface Stats {
  totals: Totals;
  colorCounts: Record<number, number>;
  timeline: TimelineBucket[];                                    // sorted by month asc
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
```

- [ ] **Step 4: Run** `npm test -- stats` → PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: explorer stats (totals, colors, timeline buckets)"`

### Task 12: Real-file smoke test (env-gated, never in CI)

**Files:**
- Create: `tests/realfiles.test.ts`

- [ ] **Step 1: Write test** — skips unless `JWL_REAL_DIR` is set:

```ts
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
```

- [ ] **Step 2: Run against real data**

```bash
JWL_REAL_DIR=~/Downloads npm test -- realfiles
```

Expected: PASS. **This is the moment schema assumptions meet reality** — if a real file breaks the normalizer (unexpected column, null where we assumed value), fix `normalize.ts` here, re-running until green. Do not weaken assertions to pass; fix the engine.

- [ ] **Step 3: Commit** `git add -A && git commit -m "test: env-gated smoke test against real backup files"`

---

## UI tasks

UI verification is manual (`npm run dev`, drag real files) — the engine is where the correctness lives and is fully unit-tested. Keep the dark-glass design language: navy radial background, frosted cards (`rgba(30,41,59,.72)` + `backdrop-filter:blur(12px)`), gradient accents, springy transitions `cubic-bezier(.22,1,.36,1)`, **no layout shift** on state changes. All conflict-UX behavior must match the approved v3 mockup (kept for reference at `.superpowers/brainstorm/*/content/conflict-ux-v3.html`).

### Task 13: App shell, stores, ingest

**Files:**
- Create: `src/lib/stores.ts`, `src/app.css`, `src/lib/components/DropZone.svelte`, `src/lib/components/SourceList.svelte`
- Modify: `src/App.svelte`, `src/main.ts`, `index.html`

- [ ] **Step 1: Copy the sql.js wasm into static assets**

```bash
mkdir -p public && cp node_modules/sql.js/dist/sql-wasm.wasm public/
```

Add to `package.json` scripts: `"postinstall": "cp node_modules/sql.js/dist/sql-wasm.wasm public/"`.

- [ ] **Step 2: Stores** — `src/lib/stores.ts`:

```ts
import { writable, derived, get } from 'svelte/store';
import type { UserData } from './engine/model';
import type { MergeResult } from './engine/merge';
import type { Decisions } from './engine/resolve';
import { normalizeContainer } from './engine/normalize';
import { mergeSources } from './engine/merge';

export type Phase = 'ingest' | 'explore' | 'resolve' | 'export';
export const phase = writable<Phase>('ingest');

export interface LoadedSource { ud: UserData; fileName: string; error?: string; included: boolean; }
export const sources = writable<LoadedSource[]>([]);
export const loadErrors = writable<string[]>([]);
export const mergeResult = writable<MergeResult | null>(null);
export const decisions = writable<Decisions>({});

export async function addFiles(files: File[]) {
  for (const f of files) {
    if (get(sources).some(s => s.fileName === f.name)) continue;   // ignore duplicate file names
    try {
      const ud = await normalizeContainer(f.name, new Uint8Array(await f.arrayBuffer()));
      sources.update(s => [...s, { ud, fileName: f.name, included: true }]);
    } catch (e: any) {
      loadErrors.update(errs => [...errs, `${f.name}: ${e.message}`]);
    }
  }
  recomputeMerge();
}

export function removeSource(fileName: string) {
  sources.update(s => s.filter(x => x.fileName !== fileName));
  recomputeMerge();
}

export function toggleInclude(fileName: string) {
  sources.update(s => s.map(x => x.fileName === fileName ? { ...x, included: !x.included } : x));
  recomputeMerge();
}

export function recomputeMerge() {
  const inc = get(sources).filter(s => s.included).map(s => s.ud);
  decisions.set(restoreDecisions(inc.map(u => u.meta.id)));
  mergeResult.set(inc.length ? mergeSources(inc) : null);
}

export const conflictCount = derived(mergeResult, r => r?.conflicts.length ?? 0);
export const unresolvedCount = derived([mergeResult, decisions], ([r, d]) =>
  r ? r.conflicts.filter(c => !(c.id in d)).length : 0);

// --- session persistence (survive tab crash; spec §error handling) ---
const KEY = 'jwlbm-decisions';
export function persistDecisions(sourceIds: string[], d: Decisions) {
  try { localStorage.setItem(KEY, JSON.stringify({ sourceIds: sourceIds.sort(), d })); } catch {}
}
function restoreDecisions(sourceIds: string[]): Decisions {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw);
    return JSON.stringify(saved.sourceIds) === JSON.stringify([...sourceIds].sort()) ? saved.d : {};
  } catch { return {}; }
}
decisions.subscribe(d => {
  const ids = get(sources).filter(s => s.included).map(s => s.ud.meta.id);
  if (ids.length) persistDecisions(ids, d);
});
```

- [ ] **Step 3: Global style** — `src/app.css`:

```css
* { box-sizing: border-box; }
:root { color-scheme: dark; }
body {
  margin: 0; min-height: 100vh; color: #cbd5e1;
  font-family: -apple-system, 'SF Pro Text', Inter, system-ui, sans-serif;
  background: radial-gradient(1200px 600px at 20% -10%, #1e293b, #0b1120 60%) fixed #0b1120;
}
h1, h2, h3 { color: #f1f5f9; letter-spacing: -0.01em; }
.card {
  background: rgba(30,41,59,.72); backdrop-filter: blur(12px);
  border: 1px solid rgba(148,163,184,.15); border-radius: 18px; padding: 20px;
  transition: all .45s cubic-bezier(.22,1,.36,1);
}
button.primary {
  border: none; border-radius: 12px; padding: 12px 22px; font-size: 14px; font-weight: 800; cursor: pointer;
  background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
  box-shadow: 0 6px 20px rgba(99,102,241,.4); transition: all .2s cubic-bezier(.22,1,.36,1);
}
button.primary:hover { transform: translateY(-1px); box-shadow: 0 10px 28px rgba(99,102,241,.5); }
button.primary:disabled { opacity: .4; cursor: default; transform: none; }
button.ghost {
  border: 1px solid rgba(148,163,184,.25); background: transparent; color: #94a3b8;
  border-radius: 10px; padding: 9px 16px; font-weight: 700; font-size: 13px; cursor: pointer; transition: all .2s;
}
button.ghost:hover { color: #e2e8f0; border-color: rgba(129,140,248,.6); }
```

- [ ] **Step 4: Shell** — `src/App.svelte`:

```svelte
<script lang="ts">
  import { phase, sources, mergeResult, unresolvedCount } from './lib/stores';
  import DropZone from './lib/components/DropZone.svelte';
  import SourceList from './lib/components/SourceList.svelte';
  import MosaicDashboard from './lib/components/MosaicDashboard.svelte';
  import TimelineRiver from './lib/components/TimelineRiver.svelte';
  import DetailList from './lib/components/DetailList.svelte';
  import ConflictResolver from './lib/components/ConflictResolver.svelte';
  import ExportPanel from './lib/components/ExportPanel.svelte';

  const steps: { id: typeof $phase; label: string }[] = [
    { id: 'ingest', label: '1 · Add backups' }, { id: 'explore', label: '2 · Explore' },
    { id: 'resolve', label: '3 · Resolve' }, { id: 'export', label: '4 · Export' },
  ];
</script>

<main style="max-width:1080px;margin:0 auto;padding:28px 20px 80px">
  <header style="display:flex;align-items:baseline;gap:14px;margin-bottom:6px">
    <h1 style="font-size:26px;margin:0">JWL Backup Manager</h1>
    <span style="color:#64748b;font-size:13px">merge your JW Library backups — everything stays on this device</span>
  </header>

  <nav style="display:flex;gap:6px;margin:18px 0 26px;background:rgba(148,163,184,.1);border-radius:14px;padding:5px;width:fit-content">
    {#each steps as s}
      <button class="ghost" style="border:none;{$phase === s.id ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : ''}"
        disabled={s.id !== 'ingest' && $sources.filter(x => x.included).length === 0}
        on:click={() => phase.set(s.id)}>
        {s.label}{#if s.id === 'resolve' && $unresolvedCount > 0}&nbsp;<span style="background:#f43f5e;color:#fff;border-radius:99px;padding:1px 8px;font-size:11px">{$unresolvedCount}</span>{/if}
      </button>
    {/each}
  </nav>

  {#if $phase === 'ingest'}
    <DropZone /><SourceList />
  {:else if $phase === 'explore'}
    <MosaicDashboard /><TimelineRiver /><DetailList />
  {:else if $phase === 'resolve'}
    <ConflictResolver />
  {:else}
    <ExportPanel />
  {/if}
</main>
```

`src/main.ts`:

```ts
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
export default mount(App, { target: document.getElementById('app')! });
```

`index.html`: set `<title>JWL Backup Manager</title>` and `<meta name="viewport" content="width=device-width, initial-scale=1">`.

- [ ] **Step 5: DropZone** — `src/lib/components/DropZone.svelte`:

```svelte
<script lang="ts">
  import { addFiles, loadErrors, sources, phase } from '../stores';
  let dragging = $state(false);
  let busy = $state(false);
  async function handle(files: FileList | null) {
    if (!files?.length) return;
    busy = true;
    await addFiles([...files]);
    busy = false;
    if ($sources.length) phase.set('explore');
  }
</script>

<div class="card" role="button" tabindex="0"
  style="border:2px dashed {dragging ? '#818cf8' : 'rgba(148,163,184,.3)'};text-align:center;padding:56px 20px;cursor:pointer;
         transform:{dragging ? 'scale(1.01)' : 'none'}"
  on:dragover|preventDefault={() => (dragging = true)}
  on:dragleave={() => (dragging = false)}
  on:drop|preventDefault={e => { dragging = false; handle(e.dataTransfer?.files ?? null); }}
  on:click={() => document.getElementById('filepick')?.click()}
  on:keydown={e => e.key === 'Enter' && document.getElementById('filepick')?.click()}>
  <div style="font-size:40px">🗂️</div>
  <h2 style="margin:10px 0 4px">{busy ? 'Reading backups…' : 'Drop backups here'}</h2>
  <p style="color:#64748b;margin:0">.jwlibrary and .jwlplaylist files — or click to choose.<br>Nothing is uploaded; merging happens in your browser.</p>
  <input id="filepick" type="file" multiple accept=".jwlibrary,.jwlplaylist" style="display:none"
    on:change={e => handle((e.target as HTMLInputElement).files)} />
</div>

{#each $loadErrors as err}
  <div style="margin-top:12px;background:rgba(244,63,94,.12);border:1px solid rgba(244,63,94,.4);border-radius:12px;padding:12px 16px;color:#fda4af;font-size:13px">⚠️ {err}</div>
{/each}
```

- [ ] **Step 6: SourceList** — `src/lib/components/SourceList.svelte`:

```svelte
<script lang="ts">
  import { sources, removeSource, toggleInclude } from '../stores';
</script>

{#if $sources.length}
  <h3 style="margin:26px 0 10px">Loaded sources</h3>
  {#each $sources as s (s.fileName)}
    <div class="card" style="display:flex;align-items:center;gap:14px;padding:14px 18px;margin-bottom:10px;opacity:{s.included ? 1 : .45}">
      <span style="font-size:22px">{s.ud.meta.type === 1 ? '🎬' : '📦'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{s.fileName}</div>
        <div style="font-size:12px;color:#64748b">
          {s.ud.meta.deviceName} · schema v{s.ud.meta.schemaVersion} · {s.ud.notes.size} notes · {s.ud.marks.size} highlights · {s.ud.playlistItems.size} playlist items
        </div>
        {#each s.ud.meta.warnings as w}<div style="font-size:12px;color:#fbbf24">⚠️ {w}</div>{/each}
      </div>
      <label style="font-size:12px;color:#94a3b8;display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" checked={s.included} on:change={() => toggleInclude(s.fileName)} /> include
      </label>
      <button class="ghost" on:click={() => removeSource(s.fileName)}>✕</button>
    </div>
  {/each}
{/if}
```

- [ ] **Step 7: Stub the remaining components** so the app compiles — create `MosaicDashboard.svelte`, `TimelineRiver.svelte`, `DetailList.svelte`, `ConflictResolver.svelte`, `ExportPanel.svelte` each containing:

```svelte
<div class="card" style="margin-bottom:14px"><p style="color:#64748b">Coming in the next task…</p></div>
```

- [ ] **Step 8: Verify** `npm run dev` → drag a real backup from `~/Downloads` → source card appears with correct counts; a bogus file shows a friendly error; nav unlocks. `npm test` still green. `npm run build` succeeds.
- [ ] **Step 9: Commit** `git add -A && git commit -m "feat: app shell, stores, drag-and-drop ingest"`

### Task 14: Explorer — mosaic + timeline river + detail list

**Files:**
- Modify: `src/lib/components/MosaicDashboard.svelte`, `src/lib/components/TimelineRiver.svelte`, `src/lib/components/DetailList.svelte`
- Create: `src/lib/explorer.ts` (shared explorer state)

- [ ] **Step 1: Explorer state** — `src/lib/explorer.ts`:

```ts
import { writable } from 'svelte/store';
export type Category = 'highlights' | 'notes' | 'playlists' | 'tags' | 'bookmarks' | 'inputFields';
export const selectedCategory = writable<Category | null>(null);
export const selectedMonth = writable<string | null>(null);   // 'YYYY-MM' from timeline click
```

- [ ] **Step 2: MosaicDashboard** — treemap tiles sized by share of total, gradient per type, highlight tile shows the six-color spectrum; click selects a category:

```svelte
<script lang="ts">
  import { sources } from '../stores';
  import { computeStats, JWL_COLORS } from '../engine/stats';
  import { selectedCategory, type Category } from '../explorer';

  const stats = $derived(computeStats($sources.filter(s => s.included).map(s => s.ud)));
  const tiles = $derived(([
    { id: 'highlights', label: 'Highlights', n: stats.totals.highlights, grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
    { id: 'notes', label: 'Notes', n: stats.totals.notes, grad: 'linear-gradient(135deg,#3b82f6,#6366f1)' },
    { id: 'playlists', label: 'Playlists', n: stats.totals.playlists, grad: 'linear-gradient(135deg,#10b981,#14b8a6)' },
    { id: 'tags', label: 'Tags', n: stats.totals.tags, grad: 'linear-gradient(135deg,#8b5cf6,#a855f7)' },
    { id: 'bookmarks', label: 'Bookmarks', n: stats.totals.bookmarks, grad: 'linear-gradient(135deg,#ec4899,#f43f5e)' },
    { id: 'inputFields', label: 'Study answers', n: stats.totals.inputFields, grad: 'linear-gradient(135deg,#06b6d4,#0ea5e9)' },
  ] as { id: Category; label: string; n: number; grad: string }[]).filter(t => t.n > 0));
  const max = $derived(Math.max(1, ...tiles.map(t => t.n)));
  // tile size scales with sqrt of count so small categories stay visible
  const flexOf = (n: number) => 1 + 3 * Math.sqrt(n / max);
</script>

<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
  {#each tiles as t (t.id)}
    <button on:click={() => selectedCategory.update(c => c === t.id ? null : t.id)}
      style="flex:{flexOf(t.n)} 1 140px;min-height:120px;border:none;border-radius:16px;cursor:pointer;color:#fff;
             background:{t.grad};padding:16px;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-start;
             transition:all .35s cubic-bezier(.22,1,.36,1);
             outline:{$selectedCategory === t.id ? '3px solid #34d399' : 'none'};
             transform:{$selectedCategory === t.id ? 'scale(1.02)' : 'none'}">
      <div style="font-size:30px;font-weight:800">{t.n.toLocaleString()}</div>
      <div style="font-weight:600;opacity:.9">{t.label}</div>
      {#if t.id === 'highlights'}
        <div style="display:flex;gap:3px;margin-top:8px">
          {#each Object.entries(JWL_COLORS) as [idx, c]}
            {#if stats.colorCounts[+idx]}
              <span title="{c.name}: {stats.colorCounts[+idx]}"
                style="width:{8 + 22 * (stats.colorCounts[+idx] / Math.max(...Object.values(stats.colorCounts)))}px;height:10px;border-radius:3px;background:{c.hex}"></span>
            {/if}
          {/each}
        </div>
      {/if}
    </button>
  {/each}
</div>
```

- [ ] **Step 3: TimelineRiver** — SVG stacked area of note activity per month with a marker per source; click a month to filter:

```svelte
<script lang="ts">
  import { sources } from '../stores';
  import { computeStats } from '../engine/stats';
  import { selectedMonth } from '../explorer';

  const stats = $derived(computeStats($sources.filter(s => s.included).map(s => s.ud)));
  const W = 1000, H = 180, PAD = 24;
  const months = $derived(stats.timeline);
  const maxN = $derived(Math.max(1, ...months.map(m => m.notes)));
  const x = (i: number) => months.length < 2 ? W / 2 : PAD + (i / (months.length - 1)) * (W - 2 * PAD);
  const y = (n: number) => H - PAD - (n / maxN) * (H - 2 * PAD);
  const path = $derived(months.length
    ? `M ${x(0)},${H - PAD} ` + months.map((m, i) => `L ${x(i)},${y(m.notes)}`).join(' ') + ` L ${x(months.length - 1)},${H - PAD} Z`
    : '');
  const markerX = (lastMod: string) => {
    const mo = lastMod.slice(0, 7);
    const i = months.findIndex(m => m.month >= mo);
    return i < 0 ? W - PAD : x(i);
  };
  function clickAt(e: MouseEvent) {
    if (!months.length) return;
    const svg = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - svg.left) / svg.width) * W;
    const i = Math.round(((px - PAD) / (W - 2 * PAD)) * (months.length - 1));
    const m = months[Math.max(0, Math.min(months.length - 1, i))];
    selectedMonth.update(cur => (cur === m.month ? null : m.month));
  }
</script>

{#if months.length > 1}
  <div class="card" style="margin-bottom:14px;padding:14px">
    <div style="display:flex;justify-content:space-between;color:#64748b;font-size:12px;margin-bottom:4px">
      <span>{months[0].month}</span>
      <span>note activity over time — click to filter{$selectedMonth ? ` · ${$selectedMonth} ✕` : ''}</span>
      <span>{months[months.length - 1].month}</span>
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <svg viewBox="0 0 {W} {H}" style="width:100%;cursor:crosshair" on:click={clickAt}>
      <defs><linearGradient id="river" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6366f1" stop-opacity=".9"/><stop offset="1" stop-color="#14b8a6" stop-opacity=".55"/>
      </linearGradient></defs>
      <path d={path} fill="url(#river)"/>
      {#each stats.perSource as s}
        <line x1={markerX(s.lastModifiedDate)} x2={markerX(s.lastModifiedDate)} y1="8" y2={H - PAD} stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="4,4"/>
        <text x={markerX(s.lastModifiedDate) + 4} y="16" fill="#fda4af" font-size="10">{s.deviceName}</text>
      {/each}
      {#if $selectedMonth}
        {@const i = months.findIndex(m => m.month === $selectedMonth)}
        {#if i >= 0}<circle cx={x(i)} cy={y(months[i].notes)} r="6" fill="#34d399"/>{/if}
      {/if}
    </svg>
  </div>
{/if}
```

- [ ] **Step 4: DetailList** — filtered browsable list honoring `selectedCategory` + `selectedMonth`:

```svelte
<script lang="ts">
  import { sources } from '../stores';
  import { JWL_COLORS } from '../engine/stats';
  import { selectedCategory, selectedMonth } from '../explorer';
  import type { UserData } from '../engine/model';

  const included = $derived($sources.filter(s => s.included));
  const locTitle = (ud: UserData, k: string | null) => {
    if (!k) return '—';
    const l = ud.locations.get(k);
    if (!l) return '—';
    return l.title ?? (l.bookNumber ? `Bible book ${l.bookNumber}${l.chapterNumber ? ':' + l.chapterNumber : ''} (${l.keySymbol})` : l.keySymbol ?? 'document');
  };
  interface Row { icon: string; title: string; sub: string; color?: string; source: string; }
  const rows = $derived.by(() => {
    const out: Row[] = []; const cat = $selectedCategory; const mo = $selectedMonth;
    for (const s of included) {
      const ud = s.ud; const src = ud.meta.deviceName || s.fileName;
      if ((!cat || cat === 'notes'))
        for (const n of ud.notes.values()) {
          if (mo && !(n.created ?? '').startsWith(mo)) continue;
          out.push({ icon: '📝', title: n.title || '(untitled note)', sub: `${locTitle(ud, n.locKey)} · ${(n.content ?? '').slice(0, 90)}`, source: src });
        }
      if ((!cat || cat === 'highlights') && !mo)
        for (const m of ud.marks.values())
          out.push({ icon: '🖍️', title: locTitle(ud, m.locKey), sub: `${m.ranges.length} range(s)`, color: JWL_COLORS[m.colorIndex]?.hex, source: src });
      if ((!cat || cat === 'playlists') && !mo)
        for (const t of ud.tags.values()) if (t.type === 2)
          out.push({ icon: '🎬', title: t.name, sub: `${ud.tagMaps.filter(x => x.tagKey === JSON.stringify([2, t.name]) && x.target.kind === 'playlistItem').length} items`, source: src });
      if ((!cat || cat === 'tags') && !mo)
        for (const t of ud.tags.values()) if (t.type === 1) out.push({ icon: '🏷️', title: t.name, sub: 'tag', source: src });
      if ((!cat || cat === 'bookmarks') && !mo)
        for (const b of ud.bookmarks) out.push({ icon: '🔖', title: b.title, sub: `slot ${b.slot} · ${locTitle(ud, b.pubLocKey)}`, source: src });
      if ((!cat || cat === 'inputFields') && !mo)
        for (const f of ud.inputFields) out.push({ icon: '✍️', title: f.value.slice(0, 60), sub: `${locTitle(ud, f.locKey)} · ${f.textTag}`, source: src });
    }
    return out.slice(0, 500);
  });
</script>

<div class="card">
  <h3 style="margin:0 0 12px">{$selectedCategory ?? 'Everything'}{$selectedMonth ? ` · ${$selectedMonth}` : ''} <span style="color:#64748b;font-weight:400;font-size:13px">{rows.length}{rows.length === 500 ? '+' : ''} items</span></h3>
  <div style="max-height:420px;overflow:auto">
    {#each rows as r}
      <div style="display:flex;gap:10px;align-items:center;padding:8px 6px;border-bottom:1px solid rgba(148,163,184,.08)">
        <span>{r.icon}</span>
        {#if r.color}<span style="width:12px;height:12px;border-radius:3px;background:{r.color};flex-shrink:0"></span>{/if}
        <div style="flex:1;min-width:0">
          <div style="color:#e2e8f0;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{r.title}</div>
          <div style="color:#64748b;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{r.sub}</div>
        </div>
        <span style="color:#475569;font-size:11px;flex-shrink:0">{r.source}</span>
      </div>
    {/each}
  </div>
</div>
```

- [ ] **Step 5: Verify** `npm run dev` → load 2+ real backups → tiles show correct totals (cross-check against Task 12 numbers), highlight spectrum renders, river shows markers per source, clicking tiles/months filters the list. `npm run build` green.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: mosaic dashboard, timeline river, detail list explorer"`

### Task 15: Conflict resolver (approved v3 UX)

**Files:**
- Modify: `src/lib/components/ConflictResolver.svelte`

Behavior contract (from the approved mockup): fixed-height stage, two device-colored cards, word-level diff highlighting, click-to-keep with glow/dim states, keep-both, merge-morph into an editable single card with **zero layout shift**, plain-English verdict line, progress bar, bulk rules, everything undoable until export.

- [ ] **Step 1: Diff helper** — add to `src/lib/components/ConflictResolver.svelte` a `<script context="module">` word-diff (LCS on words; good enough for note-sized text):

```svelte
<script context="module" lang="ts">
  export type DiffSeg = { text: string; state: 'same' | 'left' | 'right' };
  export function wordDiff(a: string, b: string): { left: DiffSeg[]; right: DiffSeg[] } {
    const wa = a.split(/(\s+)/), wb = b.split(/(\s+)/);
    const n = wa.length, m = wb.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = wa[i] === wb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const left: DiffSeg[] = [], right: DiffSeg[] = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (wa[i] === wb[j]) { left.push({ text: wa[i], state: 'same' }); right.push({ text: wb[j], state: 'same' }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { left.push({ text: wa[i], state: 'left' }); i++; }
      else { right.push({ text: wb[j], state: 'right' }); j++; }
    }
    while (i < n) left.push({ text: wa[i++], state: 'left' });
    while (j < m) right.push({ text: wb[j++], state: 'right' });
    return { left, right };
  }
</script>
```

- [ ] **Step 2: Component body** — same file:

```svelte
<script lang="ts">
  import { mergeResult, decisions } from '../stores';
  import { bulkDecide, type Decision } from '../engine/resolve';
  import type { Conflict } from '../engine/merge';

  let idx = $state(0);
  let mergedText = $state('');
  const conflicts = $derived($mergeResult?.conflicts ?? []);
  const c = $derived(conflicts[Math.min(idx, Math.max(0, conflicts.length - 1))] as Conflict | undefined);
  const current = $derived(c ? $decisions[c.id] : undefined);
  const resolvedCount = $derived(conflicts.filter(x => x.id in $decisions).length);

  const KIND_LABEL: Record<Conflict['kind'], string> = {
    note: '📝 Note', mark: '🖍️ Highlight', bookmark: '🔖 Bookmark', inputField: '✍️ Study answer', playlist: '🎬 Playlist' };
  const textOf = (side: any, kind: string) =>
    kind === 'note' ? `${side.item.title ?? ''}\n${side.item.content ?? ''}`.trim()
    : kind === 'inputField' ? side.item.value
    : kind === 'playlist' ? `${side.item.itemKeys.length} items`
    : kind === 'bookmark' ? `${side.item.title} (slot ${side.item.slot})`
    : `color ${side.item.colorIndex}, ${side.item.ranges.length} range(s)`;
  const diff = $derived(c && (c.kind === 'note' || c.kind === 'inputField')
    ? wordDiff(textOf(c.left, c.kind), textOf(c.right, c.kind))
    : null);
  const canMergeText = $derived(c?.kind === 'note');
  const canBoth = $derived(c && c.kind !== 'inputField');

  function decide(d: Decision) {
    if (!c) return;
    decisions.update(x => ({ ...x, [c.id]: d }));
  }
  function reset() { if (c) decisions.update(x => { const y = { ...x }; delete y[c.id]; return y; }); }
  function startMerge() {
    if (!c || c.kind !== 'note') return;
    mergedText = `${textOf(c.left, 'note')}\n${(c.right.item as any).content ?? ''}`;
    decide({ merged: { title: (c.left.item as any).title, content: mergedText } });
  }
  const isMergeChosen = $derived(typeof current === 'object');
  function bulk(rule: Parameters<typeof bulkDecide>[1]) {
    decisions.update(x => ({ ...bulkDecide(conflicts, rule), ...x }));   // existing manual choices win
  }
  const verdict = $derived(!current ? '' :
    current === 'left' ? `✓ Keeping the ${c!.left.deviceName} version — the other will not be in the merged backup.` :
    current === 'right' ? `✓ Keeping the ${c!.right.deviceName} version — the other will not be in the merged backup.` :
    current === 'both' ? '✓ Keeping both — they will appear as two separate entries.' :
    '✓ Combined into one — edit the text, then move on.');
</script>

{#if !conflicts.length}
  <div class="card" style="text-align:center;padding:48px"><div style="font-size:38px">🎉</div>
    <h2>No conflicts</h2><p style="color:#64748b">Everything merged cleanly. Head to Export.</p></div>
{:else if c}
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
    <b style="font-size:13px">Resolve conflicts</b>
    <div style="flex:1;height:6px;border-radius:99px;background:rgba(148,163,184,.18);overflow:hidden">
      <div style="width:{100 * resolvedCount / conflicts.length}%;height:100%;background:linear-gradient(90deg,#34d399,#2dd4bf);transition:width .4s cubic-bezier(.22,1,.36,1)"></div>
    </div>
    <span style="color:#64748b;font-size:12px">{resolvedCount} / {conflicts.length}</span>
  </div>
  <div style="color:#94a3b8;font-size:12.5px;margin-bottom:14px">{KIND_LABEL[c.kind]} · conflict {idx + 1} of {conflicts.length}</div>

  <div style="position:relative;height:300px">
    {#each [['left', c.left, '#2563eb', '#3b82f6', '📱'], ['right', c.right, '#d97706', '#f59e0b', '🖥️']] as [sideId, side, g1, g2, icon]}
      <div role="button" tabindex="0"
        style="position:absolute;top:0;{sideId === 'left' ? 'left:0' : 'right:0'};width:calc(50% - 9px);height:100%;
               border-radius:18px;cursor:pointer;background:rgba(30,41,59,.72);backdrop-filter:blur(12px);overflow:hidden;
               border:1px solid {current === sideId || current === 'both' ? '#34d399' : 'rgba(148,163,184,.15)'};
               box-shadow:{current === sideId || current === 'both' ? '0 0 0 1px #34d399, 0 12px 40px rgba(52,211,153,.25)' : 'none'};
               opacity:{isMergeChosen || (current && current !== 'both' && current !== sideId) ? .3 : 1};
               filter:{isMergeChosen || (current && current !== 'both' && current !== sideId) ? 'grayscale(1)' : 'none'};
               transition:all .45s cubic-bezier(.22,1,.36,1)"
        on:click={() => decide(sideId as Decision)}
        on:keydown={e => e.key === 'Enter' && decide(sideId as Decision)}>
        <div style="display:flex;align-items:center;gap:9px;padding:13px 16px;font-weight:700;font-size:13.5px;color:#fff;
                    background:linear-gradient(135deg,{g1}ee,{g2}88)">
          {icon} {side.deviceName}
          <span style="opacity:.75;font-weight:500;font-size:11px">{side.sourceName}</span>
          <span style="margin-left:auto;font-size:10.5px;font-weight:600;background:rgba(255,255,255,.18);padding:3px 9px;border-radius:99px">
            {(side.item.lastModified ?? side.lastModifiedDate ?? '').slice(0, 10)}</span>
        </div>
        <div style="padding:15px 17px;font-size:13px;line-height:1.7;overflow:auto;max-height:220px">
          {#if diff}
            {#each (sideId === 'left' ? diff.left : diff.right) as seg}
              {#if seg.state === 'same'}<span>{seg.text}</span>
              {:else}<span style="background:{sideId === 'left' ? 'rgba(59,130,246,.22)' : 'rgba(245,158,11,.2)'};
                box-shadow:inset 0 -2px 0 {sideId === 'left' ? '#3b82f6' : '#f59e0b'};border-radius:3px">{seg.text}</span>{/if}
            {/each}
          {:else}{textOf(side, c.kind)}{/if}
        </div>
      </div>
    {/each}
    {#if isMergeChosen}
      <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:64%;height:100%;border-radius:18px;
                  background:rgba(46,16,101,.55);backdrop-filter:blur(14px);border:1px solid rgba(167,139,250,.5);
                  box-shadow:0 12px 48px rgba(139,92,246,.35);overflow:hidden;
                  animation:pop .45s cubic-bezier(.22,1,.36,1)">
        <div style="padding:13px 16px;font-weight:700;font-size:13.5px;color:#fff;background:linear-gradient(135deg,#7c3aedee,#a855f788)">🧬 Merged note <span style="opacity:.75;font-weight:500;font-size:11px">both edits, editable</span></div>
        <textarea bind:value={mergedText}
          on:input={() => decide({ merged: { title: (c.left.item as any).title, content: mergedText } })}
          style="width:calc(100% - 34px);margin:12px 17px;height:190px;background:rgba(15,23,42,.5);
                 border:1px solid rgba(148,163,184,.2);border-radius:12px;color:#e2e8f0;font-size:13px;line-height:1.7;padding:12px;resize:none;font-family:inherit"></textarea>
      </div>
    {/if}
  </div>
  <style>@keyframes pop { from { opacity:0; transform:translateX(-50%) scale(.92);} to { opacity:1; transform:translateX(-50%) scale(1);} }</style>

  <div style="display:flex;gap:6px;margin-top:16px;background:rgba(148,163,184,.1);border-radius:14px;padding:5px;width:fit-content">
    <button class="ghost" style="border:none;{current === 'left' ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : ''}" on:click={() => decide('left')}>Keep {c.left.deviceName}</button>
    <button class="ghost" style="border:none;{current === 'right' ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : ''}" on:click={() => decide('right')}>Keep {c.right.deviceName}</button>
    {#if canBoth}<button class="ghost" style="border:none;{current === 'both' ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : ''}" on:click={() => decide('both')}>🗂 Keep both</button>{/if}
    {#if canMergeText}<button class="ghost" style="border:none;{isMergeChosen ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : ''}" on:click={startMerge}>🧬 Merge</button>{/if}
    <button class="ghost" style="border:none" on:click={reset}>↩︎ Reset</button>
  </div>
  <div style="display:flex;align-items:center;margin-top:12px;min-height:22px">
    <span style="color:#6ee7b7;font-size:12.5px;font-weight:600">{verdict}</span>
    <span style="margin-left:auto;display:flex;gap:8px">
      <button class="ghost" disabled={idx === 0} on:click={() => idx--}>← Prev</button>
      <button class="primary" disabled={idx >= conflicts.length - 1} on:click={() => idx++}>Next →</button>
    </span>
  </div>

  <div class="card" style="margin-top:18px;border-style:dashed">
    <b style="font-size:13px">⚡ Bulk rules</b>
    <span style="color:#64748b;font-size:12px;margin-left:6px">apply to all conflicts you haven't decided yet — your manual choices are kept</span>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="ghost" on:click={() => bulk('newest')}>Newest wins</button>
      <button class="ghost" on:click={() => bulk('both')}>Always keep both</button>
      {#each [...new Set(conflicts.flatMap(x => [x.left.deviceName, x.right.deviceName]))] as dev}
        <button class="ghost" on:click={() => bulk({ device: dev })}>{dev} wins</button>
      {/each}
      <button class="ghost" on:click={() => decisions.set({})}>Clear all decisions</button>
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Verify** `npm run dev` → craft a conflict: load one real backup twice is conflict-free, so use two different-generation real backups (e.g. an old iPad and new iPhone backup) which share edited notes — or temporarily edit a fixture. Confirm: diff highlighting, keep/dim glow states, merge morph with no layout shift, bulk rules fill only undecided, nav badge counts down, decisions survive a page reload (localStorage).
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat: conflict resolver with diff highlighting, merge morph, bulk rules"`

### Task 16: Export panel

**Files:**
- Modify: `src/lib/components/ExportPanel.svelte`

- [ ] **Step 1: Implement**:

```svelte
<script lang="ts">
  import { sources, mergeResult, decisions, unresolvedCount, phase } from '../stores';
  import { applyResolutions } from '../engine/resolve';
  import { exportContainer, verifyContainer, type Verification } from '../engine/export';
  import { tagKey, type UserData } from '../engine/model';

  let busy = $state(false);
  let verification = $state<Verification | null>(null);
  let error = $state('');
  let finalData = $state<UserData | null>(null);

  const playlists = $derived(finalData ? [...finalData.tags.values()].filter(t => t.type === 2) : []);

  function download(bytes: Uint8Array, name: string) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click(); URL.revokeObjectURL(url);
  }
  async function doExport() {
    if (!$mergeResult) return;
    busy = true; error = ''; verification = null;
    try {
      finalData = applyResolutions($mergeResult, $decisions);
      const name = `merged_${new Date().toISOString().slice(0, 10)}`;
      const { fileBytes, fileName } = await exportContainer(finalData, name);
      verification = await verifyContainer(fileBytes);
      if (verification.ok || confirm(`Verification warnings:\n${verification.problems.join('\n')}\n\nDownload anyway?`))
        download(fileBytes, fileName);
    } catch (e: any) { error = e.message; }
    busy = false;
  }
  async function exportPlaylist(name: string) {
    if (!finalData) return;
    const { fileBytes, fileName } = await exportContainer(finalData, name.replace(/[^\w\- ]+/g, '_'),
      { type: 1, onlyPlaylistTagKey: tagKey({ type: 2, name }) });
    download(fileBytes, fileName);
  }
</script>

<div class="card">
  <h2 style="margin-top:0">Export merged backup</h2>
  {#if $unresolvedCount > 0}
    <p style="color:#fbbf24">⚠️ {$unresolvedCount} conflict(s) still unresolved — <button class="ghost" on:click={() => phase.set('resolve')}>resolve them first</button></p>
  {:else}
    <p style="color:#94a3b8;font-size:13.5px">Combines {$sources.filter(s => s.included).length} sources into one <b>.jwlibrary</b> file. Restore it in JW Library via Personal Study → Backup and Restore. <b style="color:#fda4af">Restoring replaces that device's data</b> — check the verification summary first.</p>
    <button class="primary" disabled={busy || !$mergeResult} on:click={doExport}>{busy ? 'Building…' : '⬇︎ Build & download merged backup'}</button>
  {/if}
  {#if error}<p style="color:#fda4af">✗ {error}</p>{/if}

  {#if verification}
    <div style="margin-top:16px;border-radius:12px;padding:14px 16px;background:{verification.ok ? 'rgba(52,211,153,.12)' : 'rgba(251,191,36,.1)'};border:1px solid {verification.ok ? 'rgba(52,211,153,.4)' : 'rgba(251,191,36,.4)'}">
      <b style="color:{verification.ok ? '#6ee7b7' : '#fbbf24'}">{verification.ok ? '✓ Verified — re-opened the output and checked hash, integrity, and foreign keys' : '⚠ Verified with warnings'}</b>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;color:#cbd5e1;font-size:13px">
        <span>📝 {verification.counts.notes} notes</span><span>🖍️ {verification.counts.highlights} highlights</span>
        <span>🎬 {verification.counts.playlistItems} playlist items</span><span>🏷️ {verification.counts.tags} tags</span>
        <span>🔖 {verification.counts.bookmarks} bookmarks</span><span>✍️ {verification.counts.inputFields} answers</span>
      </div>
      {#each verification.problems as p}<div style="color:#fbbf24;font-size:12.5px;margin-top:6px">• {p}</div>{/each}
    </div>
  {/if}

  {#if playlists.length}
    <h3 style="margin:22px 0 8px">Share individual playlists</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      {#each playlists as p}<button class="ghost" on:click={() => exportPlaylist(p.name)}>🎬 {p.name} → .jwlplaylist</button>{/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: End-to-end verify with real data** — `npm run dev`, load ≥2 real backups + 1 `.jwlplaylist`, resolve conflicts (bulk "newest wins"), export. Then run `JWL_REAL_DIR=~/Downloads npm test -- realfiles` again. **Acceptance:** import the downloaded `merged_*.jwlibrary` into JW Library on a spare device/simulator and confirm notes, highlights, playlists all appear. (This is the one step no test can substitute.)
- [ ] **Step 3: Commit** `git add -A && git commit -m "feat: export panel with verification summary and per-playlist export"`

### Task 17: PWA + deploy

**Files:**
- Modify: `vite.config.ts`, `index.html`
- Create: `.github/workflows/deploy.yml`, `public/icon.svg`

- [ ] **Step 1: PWA** — `npm i -D vite-plugin-pwa`, then in `vite.config.ts` add:

```ts
import { VitePWA } from 'vite-plugin-pwa';
// inside plugins:
VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['sql-wasm.wasm', 'icon.svg'],
  manifest: {
    name: 'JWL Backup Manager', short_name: 'JWL Merge',
    theme_color: '#0b1120', background_color: '#0b1120', display: 'standalone',
    icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  },
  workbox: { maximumFileSizeToCacheInBytes: 8 * 1024 * 1024 },   // sql-wasm.wasm is ~1.5 MB
}),
```

`public/icon.svg` — simple gradient rounded square with "JW⇆" glyph:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#14b8a6"/></linearGradient></defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <text x="64" y="82" text-anchor="middle" font-family="system-ui" font-size="52" font-weight="800" fill="#fff">⇆</text>
</svg>
```

- [ ] **Step 2: Deploy workflow** — `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on: { push: { branches: [main] } }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Verify** `npm run build && npm run preview` → app works from the built bundle (wasm loads, ingest→export path works offline after first load). Full `npm test` green.
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat: PWA manifest and GitHub Pages deploy workflow"`

Publishing (user action, not automated): create a GitHub repo, `git remote add origin … && git push -u origin main`, enable Pages → GitHub Actions in repo settings. Share the resulting URL.

---

## Plan self-review notes

- **Spec coverage:** ingest incl. v5 + `.jwlplaylist` (T2–T6), upgrade-via-canonical-normalization (T5/T6 — spec's "stepwise migration" is implemented as normalize-to-canonical, same outcome, noted in spec terms), explore mosaic+river+drilldown (T11, T14), GUID-first merge + content tier (T7/T8), conflict UX v3 incl. merge-morph/bulk/undo (T9, T15), export+hash+self-check+per-playlist (T10, T16), session resume (T13 stores), PWA+static hosting (T17), real-file validation (T12, T16). Per-file playlist include toggle (spec "fold in as needed") = SourceList `include` checkbox (T13).
- **Known simplification:** timeline river plots note activity only — highlights/playlist items carry no timestamps in the schema (verified). Source markers still show every backup. Matches what the data can support.
- **Type consistency check done:** `Decision`/`Decisions` (resolve), `Conflict` sides carry `deviceName/lastModifiedDate` used by UI + bulkDecide; `tagKey({type:2,name})` used consistently for playlist identity; `exportContainer(ud, baseName, opts)` signature consistent between T10 and T16.






