/// <reference types="node" />

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadDurationFormat() {
  return import("./duration-format.ts");
}

test("formatDurationMs keeps millisecond values under one second", async () => {
  const module = await loadDurationFormat();

  assert.equal(module.formatDurationMs(999, { locale: "en-US" }), "999ms");
  assert.equal(module.formatDurationMs(12, { locale: "zh-CN" }), "12ms");
});

test("formatDurationMs promotes one second or more to compact second notation", async () => {
  const module = await loadDurationFormat();

  assert.equal(module.formatDurationMs(1_000, { locale: "en-US" }), "1.00s");
  assert.equal(module.formatDurationMs(1_532, { locale: "en-US" }), "1.53s");
});

test("formatDashboardDurationSeconds delegates to the shared ms-to-s formatter", async () => {
  const source = await readFile(
    new URL("./dashboard-number-format.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /return formatDurationMs\(value \* 1_000, \{/,
    "dashboard duration formatting should reuse the shared ms-to-s rule by converting seconds back to milliseconds first",
  );
});
