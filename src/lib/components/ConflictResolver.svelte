<script module lang="ts">
  export type DiffSeg = { text: string; state: 'same' | 'left' | 'right' };
  export function wordDiff(a: string, b: string): { left: DiffSeg[]; right: DiffSeg[] } {
    const wa = a.split(/(\s+)/), wb = b.split(/(\s+)/);
    const n = wa.length, m = wb.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
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

<script lang="ts">
  import { mergeResult, decisions } from '../stores';
  import { bulkDecide, type Decision, type BulkRule } from '../engine/resolve';
  import type { Conflict } from '../engine/merge';
  import { JWL_COLORS } from '../engine/stats';

  let idx = $state(0);
  let mergedText = $state('');
  const conflicts = $derived($mergeResult?.conflicts ?? []);
  const c = $derived(conflicts.length ? (conflicts[Math.min(idx, conflicts.length - 1)] as Conflict) : undefined);
  const current = $derived(c ? $decisions[c.id] : undefined);
  const resolvedCount = $derived(conflicts.filter(x => x.id in $decisions).length);

  const KIND_LABEL: Record<Conflict['kind'], string> = {
    note: '📝 Note', mark: '🖍️ Highlight', bookmark: '🔖 Bookmark', inputField: '✍️ Study answer', playlist: '🎬 Playlist',
  };
  const sideName = (s: { deviceName: string; sourceId: string; sourceName: string }) =>
    s.sourceId === 'merged' ? 'Merged so far' : s.deviceName || s.sourceName;
  const textOf = (side: any, kind: string) =>
    kind === 'note' ? `${side.item.title ?? ''}\n${side.item.content ?? ''}`.trim()
    : kind === 'inputField' ? side.item.value
    : kind === 'playlist' ? `${side.item.name} — ${side.item.itemKeys.length} item(s)`
    : kind === 'bookmark' ? `${side.item.title} (slot ${side.item.slot})`
    : `${JWL_COLORS[side.item.colorIndex]?.name ?? 'No color'} highlight · ${side.item.ranges.length} passage(s) marked`;
  const diff = $derived(c && (c.kind === 'note' || c.kind === 'inputField')
    ? wordDiff(textOf(c.left, c.kind), textOf(c.right, c.kind))
    : null);
  const canMergeText = $derived(c?.kind === 'note');
  const canBoth = $derived(!!c && c.kind !== 'inputField');
  const isMergeChosen = $derived(typeof current === 'object');

  function decide(d: Decision) {
    if (!c) return;
    decisions.update(x => ({ ...x, [c.id]: d }));
  }
  function reset() {
    if (!c) return;
    decisions.update(x => {
      const y = { ...x };
      delete y[c.id];
      return y;
    });
  }
  function startMerge() {
    if (!c || c.kind !== 'note') return;
    mergedText = `${(c.left.item as any).content ?? ''}\n${(c.right.item as any).content ?? ''}`.trim();
    decide({ merged: { title: (c.left.item as any).title, content: mergedText } });
  }
  function bulk(rule: BulkRule) {
    decisions.update(x => ({ ...bulkDecide(conflicts, rule), ...x })); // existing manual choices win
  }
  const verdict = $derived(!c || !current ? '' :
    current === 'left' ? `✓ Keeping the ${sideName(c.left)} version — the other will not be in the merged backup.` :
    current === 'right' ? `✓ Keeping the ${sideName(c.right)} version — the other will not be in the merged backup.` :
    current === 'both' ? '✓ Keeping both — they will appear as two separate entries.' :
    '✓ Combined into one — edit the text, then move on.');
  const devices = $derived([...new Set(conflicts.flatMap(x => [x.left.deviceName, x.right.deviceName]))]
    .filter(d => d && d !== 'JWL Backup Manager'));
</script>

{#if !conflicts.length}
  <div class="card" style="text-align:center;padding:48px">
    <div style="font-size:38px">🎉</div>
    <h2>No conflicts</h2>
    <p style="color:#64748b">Everything merged cleanly. Head to Export.</p>
  </div>
{:else if c}
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
    <b style="font-size:13px">Resolve conflicts</b>
    <div style="flex:1;height:6px;border-radius:99px;background:rgba(148,163,184,.18);overflow:hidden">
      <div style="width:{(100 * resolvedCount) / conflicts.length}%;height:100%;background:linear-gradient(90deg,#34d399,#2dd4bf);transition:width .4s cubic-bezier(.22,1,.36,1)"></div>
    </div>
    <span style="color:#64748b;font-size:12px">{resolvedCount} / {conflicts.length}</span>
  </div>
  <div style="color:#94a3b8;font-size:12.5px;margin-bottom:14px">{KIND_LABEL[c.kind]} · conflict {idx + 1} of {conflicts.length}</div>

  <div style="position:relative;height:300px">
    {#each [{ sideId: 'left', side: c.left, g1: '#2563eb', g2: '#3b82f6', icon: '📱' }, { sideId: 'right', side: c.right, g1: '#d97706', g2: '#f59e0b', icon: '🖥️' }] as v (v.sideId)}
      <div role="button" tabindex="0"
        style="position:absolute;top:0;{v.sideId === 'left' ? 'left:0' : 'right:0'};width:calc(50% - 9px);height:100%;
               border-radius:18px;cursor:pointer;background:rgba(30,41,59,.72);backdrop-filter:blur(12px);overflow:hidden;
               border:1px solid {current === v.sideId || current === 'both' ? '#34d399' : 'rgba(148,163,184,.15)'};
               box-shadow:{current === v.sideId || current === 'both' ? '0 0 0 1px #34d399, 0 12px 40px rgba(52,211,153,.25)' : 'none'};
               opacity:{isMergeChosen || (current && current !== 'both' && current !== v.sideId) ? .3 : 1};
               filter:{isMergeChosen || (current && current !== 'both' && current !== v.sideId) ? 'grayscale(1)' : 'none'};
               transition:all .45s cubic-bezier(.22,1,.36,1)"
        onclick={() => decide(v.sideId as Decision)}
        onkeydown={e => e.key === 'Enter' && decide(v.sideId as Decision)}>
        <div style="display:flex;align-items:center;gap:9px;padding:13px 16px;font-weight:700;font-size:13.5px;color:#fff;
                    background:linear-gradient(135deg,{v.g1}ee,{v.g2}88)">
          {v.icon} {sideName(v.side)}
          <span style="opacity:.75;font-weight:500;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%">{v.side.sourceName}</span>
          <span style="margin-left:auto;font-size:10.5px;font-weight:600;background:rgba(255,255,255,.18);padding:3px 9px;border-radius:99px">
            {((v.side.item as any).lastModified ?? v.side.lastModifiedDate ?? '').slice(0, 10)}</span>
        </div>
        <div style="padding:15px 17px;font-size:13px;line-height:1.7;overflow:auto;max-height:220px;white-space:pre-wrap">
          {#if diff}
            {#each (v.sideId === 'left' ? diff.left : diff.right) as seg, si (si)}
              {#if seg.state === 'same'}<span>{seg.text}</span>
              {:else}<span style="background:{v.sideId === 'left' ? 'rgba(59,130,246,.22)' : 'rgba(245,158,11,.2)'};
                box-shadow:inset 0 -2px 0 {v.sideId === 'left' ? '#3b82f6' : '#f59e0b'};border-radius:3px">{seg.text}</span>{/if}
            {/each}
          {:else}{textOf(v.side, c.kind)}{/if}
        </div>
      </div>
    {/each}
    {#if isMergeChosen}
      <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:64%;height:100%;border-radius:18px;
                  background:rgba(46,16,101,.55);backdrop-filter:blur(14px);border:1px solid rgba(167,139,250,.5);
                  box-shadow:0 12px 48px rgba(139,92,246,.35);overflow:hidden;animation:pop .45s cubic-bezier(.22,1,.36,1)">
        <div style="padding:13px 16px;font-weight:700;font-size:13.5px;color:#fff;background:linear-gradient(135deg,#7c3aedee,#a855f788)">
          🧬 Merged note <span style="opacity:.75;font-weight:500;font-size:11px">both edits, editable</span></div>
        <textarea bind:value={mergedText}
          oninput={() => decide({ merged: { title: (c.left.item as any).title, content: mergedText } })}
          style="width:calc(100% - 34px);margin:12px 17px;height:190px;background:rgba(15,23,42,.5);
                 border:1px solid rgba(148,163,184,.2);border-radius:12px;color:#e2e8f0;font-size:13px;line-height:1.7;padding:12px;resize:none;font-family:inherit"></textarea>
      </div>
    {/if}
  </div>

  <div style="display:flex;gap:6px;margin-top:16px;background:rgba(148,163,184,.1);border-radius:14px;padding:5px;width:fit-content;flex-wrap:wrap">
    <button class="ghost" style="border:none;{current === 'left' ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : ''}" onclick={() => decide('left')}>Keep {sideName(c.left)}</button>
    <button class="ghost" style="border:none;{current === 'right' ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : ''}" onclick={() => decide('right')}>Keep {sideName(c.right)}</button>
    {#if canBoth}<button class="ghost" style="border:none;{current === 'both' ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : ''}" onclick={() => decide('both')}>🗂 Keep both</button>{/if}
    {#if canMergeText}<button class="ghost" style="border:none;{isMergeChosen ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff' : ''}" onclick={startMerge}>🧬 Merge</button>{/if}
    <button class="ghost" style="border:none" onclick={reset}>↩︎ Reset</button>
  </div>
  <div style="display:flex;align-items:center;margin-top:12px;min-height:22px">
    <span style="color:#6ee7b7;font-size:12.5px;font-weight:600">{verdict}</span>
    <span style="margin-left:auto;display:flex;gap:8px">
      <button class="ghost" disabled={idx === 0} onclick={() => idx--}>← Prev</button>
      <button class="primary" disabled={idx >= conflicts.length - 1} onclick={() => idx++}>Next →</button>
    </span>
  </div>

  <div class="card" style="margin-top:18px;border-style:dashed">
    <b style="font-size:13px">⚡ Bulk rules</b>
    <span style="color:#64748b;font-size:12px;margin-left:6px">apply to all conflicts you haven't decided yet — your manual choices are kept</span>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="ghost" onclick={() => bulk('newest')}>Newest wins</button>
      <button class="ghost" onclick={() => bulk('both')}>Always keep both</button>
      {#each devices as dev (dev)}
        <button class="ghost" onclick={() => bulk({ device: dev })}>{dev} wins</button>
      {/each}
      <button class="ghost" onclick={() => decisions.set({})}>Clear all decisions</button>
    </div>
  </div>
{/if}

<style>
  @keyframes pop {
    from { opacity: 0; transform: translateX(-50%) scale(.92); }
    to { opacity: 1; transform: translateX(-50%) scale(1); }
  }
</style>
