import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTiledRects,
  DEFAULT_TILING_CONFIG,
  evaluateHyprctlCommand,
  parseTilingConf,
  serializeTilingConf,
  type VcaOsWindow,
} from './vcaOsEngine';

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

test('computeTiledRects lays out single and multiple windows in BSP with zero overlap', () => {
  const bounds = { width: 1200, height: 800 };
  const single = computeTiledRects(['w1'], bounds, DEFAULT_TILING_CONFIG, {
    top: 38,
    bottom: 8,
    left: 0,
    right: 0,
  });
  assert.equal(single.w1.x, 12);
  assert.equal(single.w1.y, 50);
  assert.equal(single.w1.w, 1200 - 24);

  const ids = ['w1', 'w2', 'w3', 'w4'];
  const rects = computeTiledRects(ids, bounds, DEFAULT_TILING_CONFIG);
  assert.equal(Object.keys(rects).length, 4);

  for (let i = 0; i < ids.length; i++) {
    const r = rects[ids[i]];
    assert.ok(r.w > 80 && r.h > 80, `window ${ids[i]} should have positive bounds`);
    for (let j = i + 1; j < ids.length; j++) {
      assert.equal(rectsOverlap(r, rects[ids[j]]), false, `${ids[i]} and ${ids[j]} must not overlap`);
    }
  }
});

test('computeTiledRects supports master-stack layout', () => {
  const rects = computeTiledRects(
    ['master', 'stack-a', 'stack-b'],
    { width: 1000, height: 600 },
    { ...DEFAULT_TILING_CONFIG, layout: 'master-stack', gapsInner: 10, gapsOuter: 10, splitRatio: 0.6 },
  );
  assert.ok(rects.master.w > rects['stack-a'].w);
  assert.equal(rects['stack-a'].x, rects['stack-b'].x);
  assert.ok(rects['stack-b'].y > rects['stack-a'].y + rects['stack-a'].h);
});

test('parseTilingConf and serializeTilingConf round-trip live compositor configuration', () => {
  const conf = serializeTilingConf({
    ...DEFAULT_TILING_CONFIG,
    layout: 'master-stack',
    gapsInner: 16,
    gapsOuter: 20,
    splitRatio: 0.65,
    borderWidth: 3,
  });
  const parsed = parseTilingConf(conf);
  assert.equal(parsed.layout, 'master-stack');
  assert.equal(parsed.gapsInner, 16);
  assert.equal(parsed.gapsOuter, 20);
  assert.equal(parsed.splitRatio, 0.65);
  assert.equal(parsed.borderWidth, 3);
});

test('evaluateHyprctlCommand mutates workspaces, layout, and desktop mode cleanly', () => {
  const windows: VcaOsWindow[] = [
    {
      id: 'win-1',
      appId: 'agents',
      title: 'Agents',
      workspace: 1,
      x: 40,
      y: 40,
      w: 500,
      h: 400,
      minimized: false,
      maximized: false,
      floating: false,
      zIndex: 1,
    },
  ];
  const ctx = {
    mode: 'tiling' as const,
    activeWorkspace: 1,
    tilingConfig: DEFAULT_TILING_CONFIG,
    windows,
    focusedWindowId: 'win-1',
  };

  const wsRes = evaluateHyprctlCommand('hyprctl dispatch workspace 4', ctx);
  assert.equal(wsRes.handled, true);
  assert.equal(wsRes.patch?.activeWorkspace, 4);

  const modeRes = evaluateHyprctlCommand('hyprctl dispatch mode macos', ctx);
  assert.equal(modeRes.patch?.mode, 'macos');

  const ratioRes = evaluateHyprctlCommand('hyprctl keyword split_ratio 0.68', ctx);
  assert.equal(ratioRes.patch?.tilingConfig?.splitRatio, 0.68);
});
