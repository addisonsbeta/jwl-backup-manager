# JWL Backup Manager

Merge multiple [JW Library](https://www.jw.org/en/online-help/jw-library/) backups into one — entirely in your browser. Nothing is ever uploaded; all processing happens on your device.

**⚠️ Important:** restoring a backup in JW Library **replaces** that device's data. Always check the verification summary before restoring, and keep your original backup files.

## What it does

- **Drag & drop** any mix of `.jwlibrary` backups and `.jwlplaylist` files — including old backups from 2017-era app versions (schema v5) and JW Library Sign Language playlist exports
- **Explore** everything inside: a color mosaic dashboard of highlights (in their real JW Library colors), notes, playlists, tags, bookmarks, and study answers, plus a timeline of your note activity
- **Merge** with automatic deduplication: identical items are matched by GUID or content and kept once
- **Resolve conflicts** you decide: when the same note or highlight differs between backups, side-by-side cards show word-level diffs — keep either version, both, or merge the text into one. Bulk rules ("newest wins") handle many at once
- **Export** a valid `.jwlibrary` file that JW Library can restore, self-verified (hash, integrity, foreign keys, media) before download. Individual playlists can be exported as `.jwlplaylist` files to share

## Use it on iPhone/iPad

Open the app URL in Safari → Share → **Add to Home Screen**. It installs as a full-screen app and works offline.

## Development

```bash
npm install
npm run dev     # local dev server
npm test        # engine test suite
npm run build   # production build (PWA)
```

Optional test suites against your own real backup files (never committed):

```bash
JWL_REAL_DIR=~/Downloads npm test -- realfiles     # load/merge/export smoke test
JWL_PROFILE_DIR=~/Downloads npm test -- profile    # stage-by-stage timings
```

The merge engine is pure TypeScript in `src/lib/engine/` with no DOM dependencies; the UI is Svelte 5. SQLite runs in WebAssembly (sql.js); backup containers are handled with fflate.

## Disclaimer

This is an unofficial personal tool, not affiliated with or endorsed by the publishers of JW Library. Use at your own risk and keep copies of your original backups.
