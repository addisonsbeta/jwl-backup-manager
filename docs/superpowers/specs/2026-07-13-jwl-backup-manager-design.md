# JWL Backup Manager — Design Spec

**Date:** 2026-07-13
**Status:** Approved by user (brainstorming session with visual companion)

## Purpose

A drag & drop web app that merges multiple JW Library backups — including old
(2017-era, schema v5) backups and standalone `.jwlplaylist` files — into a single
valid `.jwlibrary` backup file that can be restored in JW Library on any device.
Identical data is deduplicated automatically; genuinely conflicting data is
resolved by the user through an attractive side-by-side UI.

**Audience:** the owner plus a few non-technical friends/family. Shared as a URL.

## Architecture decision

**Fully client-side static web app.** All processing happens in the browser:

- **Framework:** Svelte + Vite single-page app
- **SQLite:** sql.js (SQLite compiled to WebAssembly) for reading and writing `userData.db`
- **ZIP:** fflate for unpacking/packing the backup containers
- **Hosting:** static (GitHub Pages or Netlify) — zero backend, zero hosting cost
- **PWA:** installable, works offline after first load, home-screen icon on iOS

Rationale: personal study data never leaves the device (privacy), free to host,
trivially shareable with non-technical users, works on iPad/iPhone Safari.

Rejected alternatives: server-backed web app (privacy, cost, overkill for a few
users); desktop app via Tauri (install friction, loses link-sharing).

**Workflow decision:** fully manual drag & drop. No watched folders, no reminders,
no background automation. (Automation options were explored and consciously
dropped; JW Library has no API — backups are always exported manually in-app,
and restores are always manual in-app and *replace* device data.)

## File format facts (verified against real files)

- `.jwlibrary` and `.jwlplaylist` are both ZIP containers holding `manifest.json`,
  a SQLite database, and (for playlists) media files (mp4/jpg/png, GUID-named).
- `manifest.json` fields: `name`, `creationDate`, `version` (container version, 1),
  `type` (0 = backup, 1 = playlist), and `userDataBackup` { `lastModifiedDate`,
  `deviceName`, `databaseName`, `hash` (SHA-256 of the db file), `schemaVersion` }.
- Old backups (2017, schemaVersion 5): db named `user_data.db`; tables
  BlockRange, Bookmark, LastModified, Location, Note, Tag, TagMap, UserMark.
- Current backups (2026, schemaVersion 16): db named `userData.db`; adds
  IndependentMedia, InputField, PlaylistItem (+ Accuracy/Marker/media-map tables),
  grdb_migrations, and playlists modeled as Tag type 2 + TagMap → PlaylistItem.
- `.jwlplaylist` files observed at schemaVersion 14, `type: 1`.

## Pipeline (six stages)

1. **Ingest** — drag & drop any mix of `.jwlibrary` / `.jwlplaylist`. Unzip in
   memory, open SQLite db, validate manifest. Reject non-backups with a clear
   plain-language message. Sources are strictly read-only.
2. **Upgrade** — migrate every source stepwise to the latest known schema (v5 →
   v16) before any merging, mirroring the official app's migration path. Old
   Sign Language playlists and 2017 backups become first-class inputs.
   `.jwlplaylist` sources are optional per-file: user chooses which to fold into
   the merged backup.
3. **Explore** — visual dashboard of all loaded data (see UI section).
4. **Merge** — deduplicate by **content identity**, not row IDs:
   - highlight (UserMark/BlockRange): publication/location + block ranges + color
   - note: location + title + content lineage
   - playlist: name + item set; playlist item: media/location + markers
   - tag: normalized name; bookmark: location + slot
   Items present in only one source are included automatically. Identical items
   collapse to one.
5. **Resolve** — same-item-different-content pairs become conflicts the user
   resolves (see Conflict UX). Bulk rules: "newest wins", "device X wins",
   "always keep both" — applied to remaining conflicts of a type, with a review
   list. All decisions undoable until export.
6. **Export** — rebuild a fresh `userData.db` at the latest schema, renumber all
   IDs consistently, bundle referenced playlist media, regenerate `manifest.json`
   with correct SHA-256 hash, zip as `merged_YYYY-MM-DD.jwlibrary`. Also: export
   any individual playlist as a `.jwlplaylist`.
   **Self-check before download:** re-open own output, verify hash, foreign keys,
   and row counts against the approved on-screen summary; display verification.

## UI design

**Overall look:** modern dark glassmorphism (radial navy background, frosted
translucent cards, saturated gradient accents), fluid springy animations
(`cubic-bezier(.22,1,.36,1)`-style easing) on all state changes. Micro-
interactions everywhere; no layout shift on state changes.

### Data Explorer (approved: Mosaic + Timeline combo)

- **Mosaic Dashboard** (overview): treemap-style tiles per data type (highlights,
  notes, playlists, tags, bookmarks, inputs), sized by item count, vivid gradient
  fills; highlights tile shows the six real JW Library highlight colors as a
  spectrum bar. Clicking a tile drills into a filtered, browsable detail list.
- **Timeline River**: stacked stream graph of item creation/modification dates
  (2017 → today), colored by data type, with a marker per loaded source backup;
  scrubbing/clicking filters the detail list to that era. Shows which backup
  contributes what.
- Per-source and combined views.

### Conflict Resolution (approved v3 mockup)

- Fixed-height stage; two version cards side by side, **zero layout shift** for
  any action.
- Device identity: gradient header bar per card (iPhone blue, iPad amber) with
  device icon, source backup name, edit date, "newest" badge.
- **Word-level diff highlighting:** shared text plain; text unique to a version
  highlighted in that version's color on both cards; text missing from a version
  struck out in gray.
- Click a card → green glow + "✓ KEEPING" badge; other card dims/grayscales
  with "not kept" badge. Plain-English verdict line confirms the consequence.
- Actions as a segmented control: Keep iPhone / Keep iPad / Keep both (two
  notes) / **Merge** / Reset.
- **Merge morph:** both cards glide to center and fade; a single merged card
  appears in the same space with an editable textarea combining both versions
  (each contribution color-coded). Reset reverses.
- Progress bar ("2 / 5") and Next button; bulk rules section beneath.

## Error handling & safety

- Source files are never modified; merging is non-destructive by construction.
- Corrupt/unrecognized files rejected at ingest with plain-language messages.
- Unknown *future* schema versions load best-effort with a visible warning.
- Merge session state (decisions) persisted to browser storage; resumable after
  a tab crash.
- Pre-restore warning surfaced at export: restoring a backup in JW Library
  replaces that device's data — verify the summary first.

## Testing

- Merge engine is pure logic, fully decoupled from UI; heavily unit-tested:
  - round-trip: import → export → reimport yields identical data
  - migrations: real anonymized fixtures from each schema era (v5 2017 backup,
    v14 playlist, v16 backup)
  - dedup and conflict detection cases
  - invariant: merging a backup with itself yields zero changes and no conflicts
- Light end-to-end coverage of drag-drop → resolve → export.

## Out of scope (explicitly)

- Watched folders, reminders, or any background automation
- Server components, accounts, cloud storage
- Automating JW Library itself (no API exists; export/restore stay manual)
