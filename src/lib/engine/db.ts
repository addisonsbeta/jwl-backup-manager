import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

let sqlPromise: Promise<SqlJsStatic> | null = null;

export function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const inBrowser = typeof window !== 'undefined';
    sqlPromise = inBrowser
      ? initSqlJs({ locateFile: f => `${import.meta.env.BASE_URL}${f}` }) // sql-wasm.wasm served from public/
      : initSqlJs(); // node resolves wasm from node_modules
  }
  return sqlPromise;
}

export async function openDb(bytes: Uint8Array): Promise<Database> {
  const SQL = await getSql();
  try {
    return new SQL.Database(bytes);
  } catch {
    throw new Error('The backup database is corrupt and could not be opened.');
  }
}

export function exportDb(db: Database): Uint8Array {
  return db.export();
}
