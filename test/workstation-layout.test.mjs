import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");
const start = source.indexOf("  function workspacePanelGeometry(");
const end = source.indexOf("\n  const workstationPanelSelector", start);
const geometry = vm.runInNewContext(`(${source.slice(start, end).trim()})`);

test("small content regions never consume the conversation's flex space", () => {
  for (const available of [240, 380, 680, 900, 979]) {
    for (const preferred of [0, 420, 680, 1159, 4000, NaN]) {
      const result = geometry(available, preferred);
      assert.equal(result.mode, "collapsed");
      assert.ok(result.width <= available && result.width <= 680);
      assert.equal(result.width, 0);
    }
  }
});

test("docked layout reserves usable conversation space even with an old oversized preference", () => {
  for (const available of [980, 1029, 1240, 1400, 2000]) {
    for (const preferred of [420, 680, 1159, 4000]) {
      const result = geometry(available, preferred);
      assert.equal(result.mode, "docked");
      assert.ok(available - result.width >= 560);
      assert.ok(result.width >= 420);
    }
  }
});

test("resizing back to a wide screen restores the preference without overwriting it", () => {
  assert.equal(geometry(1800, 1000).width, 1000);
  assert.equal(geometry(800, 1000).width, 0);
  assert.equal(geometry(1800, 1000).width, 1000);
});

test("native sibling panels reduce the available conversation region before docking", () => {
  // Reproduces a 1201px native host with an 814px file/browser aside.
  assert.equal(geometry(1201, 585, 814).mode, "collapsed");
  assert.equal(geometry(1201, 585, 814).width, 0);
  for (const reserved of [180, 420, 814, 1201]) {
    for (const remaining of [0, 387, 979]) {
      const result = geometry(reserved + remaining, 680, reserved);
      assert.equal(result.mode, "collapsed");
      assert.equal(result.width, 0);
    }
  }
  assert.equal(geometry(1000, 680, 1200).width, 0);
});

test("docking beside native panels keeps 560px for conversation after all reserved widths", () => {
  for (const reserved of [0, 180, 420, 814]) {
    for (const remaining of [980, 1240, 1800]) {
      for (const preferred of [420, 680, 1159, 4000]) {
        const available = reserved + remaining;
        const result = geometry(available, preferred, reserved);
        assert.equal(result.mode, "docked");
        assert.ok(result.width >= 420);
        assert.ok(available - reserved - result.width >= 560);
      }
    }
  }
  assert.equal(geometry(1794, 680, 814).width, 420);
  assert.equal(geometry(1793, 680, 814).mode, "collapsed");
});

test("closing a native panel restores the saved preference without changing default geometry", () => {
  assert.deepEqual(geometry(1800, 1000, 0), geometry(1800, 1000));
  assert.equal(geometry(1800, 1000, 814).width, 426);
  assert.equal(geometry(1201, 1000, 814).width, 0);
  assert.equal(geometry(1800, 1000, 0).width, 1000);
});


test("modern native panes share space without erasing either preferred width", () => {
  for (const available of [1400, 1440, 1692, 2100, 3200]) {
    for (const workstation of [420, 680, 1044, 4000]) {
      for (const native of [420, 680, 1122, 4000]) {
        const result = geometry(available, workstation, 0, native);
        assert.equal(result.mode, "docked");
        assert.ok(result.width >= 420);
        assert.ok(result.nativeWidth >= 420 && result.nativeWidth <= native);
        assert.ok(result.width + result.nativeWidth + 560 <= available);
      }
    }
  }
  assert.ok(geometry(1692, 1044, 0, 1122).width < 712);
  assert.ok(geometry(1692, 1044, 0, 1122).nativeWidth > 420);
  assert.equal(geometry(1692, 1044, 0, 630, "native").width, 502);
  assert.equal(geometry(1692, 600, 0, 1122, "workstation").width, 600);
  assert.equal(geometry(1692, 1044).width, 1044);
  assert.equal(geometry(1399, 680, 0, 1122).mode, "collapsed");
  assert.equal(geometry(1160, 680, 0, 180).width, 420);
});
