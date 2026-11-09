const assert = require('node:assert/strict');
const { test } = require('node:test');
const { windowBounds } = require('../desktop/window-layout.cjs');

test('window and minimum size fit scaled work areas, including the Windows taskbar', () => {
  for (const scale of [1, 1.25, 1.5, 2]) {
    for (const [physicalWidth, physicalHeight] of [[1366, 768], [1920, 1080], [2560, 1440]]) {
      const area = { x: 0, y: 0, width: Math.floor(physicalWidth / scale), height: Math.floor(physicalHeight / scale) - 48 };
      const bounds = windowBounds(area);
      assert.ok(bounds.width <= area.width && bounds.height <= area.height, JSON.stringify({ scale, area, bounds }));
      assert.ok(bounds.minWidth <= bounds.width && bounds.minHeight <= bounds.height);
      assert.ok(bounds.x >= area.x && bounds.y >= area.y);
      assert.ok(bounds.x + bounds.width <= area.x + area.width);
      assert.ok(bounds.y + bounds.height <= area.y + area.height);
    }
  }
});

test('opens centered on the selected display, including monitors at negative coordinates', () => {
  for (const area of [{ x: -1536, y: -100, width: 1536, height: 824 }, { x: 1920, y: 40, width: 1280, height: 672 }]) {
    const bounds = windowBounds(area);
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - (area.x + area.width / 2)) <= 0.5);
    assert.ok(Math.abs(bounds.y + bounds.height / 2 - (area.y + area.height / 2)) <= 0.5);
  }
  assert.deepEqual(windowBounds({ x: 0, y: 0, width: 2560, height: 1392 }), {
    x: 570, y: 236, width: 1420, height: 920, minWidth: 960, minHeight: 600
  });
});
