import { bookmarkSlotKey, tagKey, tagMapKey, type UserData } from './model';
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
          let slot = 0;
          while (used.has(slot)) slot++;
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
  out.tagMaps = out.tagMaps.filter(t => {
    const k = tagMapKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
