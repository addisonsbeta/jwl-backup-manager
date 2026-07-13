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
  const maxColor = $derived(Math.max(1, ...Object.values(stats.colorCounts)));
  // tile size scales with sqrt of count so small categories stay visible
  const flexOf = (n: number) => 1 + 3 * Math.sqrt(n / max);
</script>

<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
  {#each tiles as t (t.id)}
    <button onclick={() => selectedCategory.update(c => (c === t.id ? null : t.id))}
      style="flex:{flexOf(t.n)} 1 140px;min-height:120px;border:none;border-radius:16px;cursor:pointer;color:#fff;
             background:{t.grad};padding:16px;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-start;
             transition:all .35s cubic-bezier(.22,1,.36,1);
             outline:{$selectedCategory === t.id ? '3px solid #34d399' : 'none'};
             transform:{$selectedCategory === t.id ? 'scale(1.02)' : 'none'}">
      <div style="font-size:30px;font-weight:800">{t.n.toLocaleString()}</div>
      <div style="font-weight:600;opacity:.9">{t.label}</div>
      {#if t.id === 'highlights'}
        <div style="display:flex;gap:3px;margin-top:8px">
          {#each Object.entries(JWL_COLORS) as [idx, c] (idx)}
            {#if stats.colorCounts[+idx]}
              <span title="{c.name}: {stats.colorCounts[+idx]}"
                style="width:{8 + 22 * (stats.colorCounts[+idx] / maxColor)}px;height:10px;border-radius:3px;background:{c.hex}"></span>
            {/if}
          {/each}
        </div>
      {/if}
    </button>
  {/each}
</div>
