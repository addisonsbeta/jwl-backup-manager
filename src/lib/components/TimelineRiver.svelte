<script lang="ts">
  import { sources } from '../stores';
  import { computeStats } from '../engine/stats';
  import { selectedMonth } from '../explorer';

  const stats = $derived(computeStats($sources.filter(s => s.included).map(s => s.ud)));
  const W = 1000, H = 180, PAD = 24;
  const months = $derived(stats.timeline);
  const maxN = $derived(Math.max(1, ...months.map(m => m.notes)));
  const x = (i: number) => (months.length < 2 ? W / 2 : PAD + (i / (months.length - 1)) * (W - 2 * PAD));
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
  const selIdx = $derived($selectedMonth ? months.findIndex(m => m.month === $selectedMonth) : -1);
</script>

{#if months.length > 1}
  <div class="card" style="margin-bottom:14px;padding:14px">
    <div style="display:flex;justify-content:space-between;color:#64748b;font-size:12px;margin-bottom:4px">
      <span>{months[0].month}</span>
      <span>note activity over time — click to filter{$selectedMonth ? ` · ${$selectedMonth} ✕` : ''}</span>
      <span>{months[months.length - 1].month}</span>
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <svg viewBox="0 0 {W} {H}" style="width:100%;cursor:crosshair" onclick={clickAt}>
      <defs>
        <linearGradient id="river" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#6366f1" stop-opacity=".9" />
          <stop offset="1" stop-color="#14b8a6" stop-opacity=".55" />
        </linearGradient>
      </defs>
      <path d={path} fill="url(#river)" />
      {#each stats.perSource as s (s.sourceId)}
        <line x1={markerX(s.lastModifiedDate)} x2={markerX(s.lastModifiedDate)} y1="8" y2={H - PAD} stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="4,4" />
        <text x={markerX(s.lastModifiedDate) + 4} y="16" fill="#fda4af" font-size="10">{s.deviceName}</text>
      {/each}
      {#if selIdx >= 0}
        <circle cx={x(selIdx)} cy={y(months[selIdx].notes)} r="6" fill="#34d399" />
      {/if}
    </svg>
  </div>
{/if}
