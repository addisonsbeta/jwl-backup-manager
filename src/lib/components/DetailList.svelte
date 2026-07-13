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
    const out: Row[] = [];
    const cat = $selectedCategory;
    const mo = $selectedMonth;
    for (const s of included) {
      const ud = s.ud;
      const src = ud.meta.deviceName || s.fileName;
      if (!cat || cat === 'notes')
        for (const n of ud.notes.values()) {
          if (mo && !(n.created ?? '').startsWith(mo)) continue;
          out.push({ icon: '📝', title: n.title || '(untitled note)', sub: `${locTitle(ud, n.locKey)} · ${(n.content ?? '').slice(0, 90)}`, source: src });
        }
      if ((!cat || cat === 'highlights') && !mo)
        for (const m of ud.marks.values())
          out.push({ icon: '🖍️', title: locTitle(ud, m.locKey), sub: `${m.ranges.length} range(s)`, color: JWL_COLORS[m.colorIndex]?.hex, source: src });
      if ((!cat || cat === 'playlists') && !mo)
        for (const t of ud.tags.values())
          if (t.type === 2)
            out.push({ icon: '🎬', title: t.name, sub: `${ud.tagMaps.filter(x => x.tagKey === JSON.stringify([2, t.name]) && x.target.kind === 'playlistItem').length} items`, source: src });
      if ((!cat || cat === 'tags') && !mo)
        for (const t of ud.tags.values())
          if (t.type === 1) out.push({ icon: '🏷️', title: t.name, sub: 'tag', source: src });
      if ((!cat || cat === 'bookmarks') && !mo)
        for (const b of ud.bookmarks) out.push({ icon: '🔖', title: b.title, sub: `slot ${b.slot} · ${locTitle(ud, b.pubLocKey)}`, source: src });
      if ((!cat || cat === 'inputFields') && !mo)
        for (const f of ud.inputFields) out.push({ icon: '✍️', title: f.value.slice(0, 60), sub: `${locTitle(ud, f.locKey)} · ${f.textTag}`, source: src });
    }
    return out.slice(0, 500);
  });
</script>

<div class="card">
  <h3 style="margin:0 0 12px">{$selectedCategory ?? 'Everything'}{$selectedMonth ? ` · ${$selectedMonth}` : ''}
    <span style="color:#64748b;font-weight:400;font-size:13px">{rows.length}{rows.length === 500 ? '+' : ''} items</span></h3>
  <div style="max-height:420px;overflow:auto">
    {#each rows as r, i (i)}
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
