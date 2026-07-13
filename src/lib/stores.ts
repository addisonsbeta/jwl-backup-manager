import { writable, derived, get } from 'svelte/store';
import type { UserData } from './engine/model';
import type { MergeResult } from './engine/merge';
import type { Decisions } from './engine/resolve';
import { normalizeContainer } from './engine/normalize';
import { mergeSources } from './engine/merge';

export type Phase = 'ingest' | 'explore' | 'resolve' | 'export';
export const phase = writable<Phase>('ingest');

export interface LoadedSource { ud: UserData; fileName: string; included: boolean; }
export const sources = writable<LoadedSource[]>([]);
export const loadErrors = writable<string[]>([]);
export const mergeResult = writable<MergeResult | null>(null);
export const decisions = writable<Decisions>({});

export async function addFiles(files: File[]) {
  for (const f of files) {
    if (get(sources).some(s => s.fileName === f.name)) continue; // ignore duplicate file names
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
  sources.update(s => s.map(x => (x.fileName === fileName ? { ...x, included: !x.included } : x)));
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
function persistDecisions(sourceIds: string[], d: Decisions) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ sourceIds: [...sourceIds].sort(), d }));
  } catch { /* storage full or unavailable — resume is best-effort */ }
}
function restoreDecisions(sourceIds: string[]): Decisions {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw);
    return JSON.stringify(saved.sourceIds) === JSON.stringify([...sourceIds].sort()) ? saved.d : {};
  } catch {
    return {};
  }
}
decisions.subscribe(d => {
  const ids = get(sources).filter(s => s.included).map(s => s.ud.meta.id);
  if (ids.length) persistDecisions(ids, d);
});
