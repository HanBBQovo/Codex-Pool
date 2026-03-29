/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const APP_LAYOUT_PATH = new URL("./AppLayout.tsx", import.meta.url);
const PAGE_HEADER_CONTEXT_PATH = new URL(
  "./page-header-context.tsx",
  import.meta.url,
);

test("AppLayout renders a dedicated page-context header row", async () => {
  const source = await readFile(APP_LAYOUT_PATH, "utf8");

  assert.match(
    source,
    /pageHeaderBodyVisible/,
    "AppLayout should track whether the page intro is still visible",
  );
  assert.match(
    source,
    /setPageHeaderBodyVisible/,
    "AppLayout should expose body-visibility updates to child pages",
  );
  assert.match(
    source,
    /pageHeader\?\.mode === ["']dock-on-scroll["']/,
    "AppLayout should support a dock-on-scroll header mode",
  );
  assert.match(
    source,
    /data-app-scroll-root/,
    "AppLayout should mark the page scroll container for page-header docking",
  );
  assert.match(
    source,
    /!pageHeaderBodyVisible/,
    "AppLayout should only pin the compact title after the body intro scrolls away",
  );
  assert.match(
    source,
    /activeNavigationContext/,
    "AppLayout should derive the active navigation context for the compact shell header",
  );
  assert.match(
    source,
    /compactHeaderTitle\s*=\s*pageHeader\?\.title\s*\?\?\s*activeNavigationContext\?\.itemLabel\s*\?\?\s*null/,
    "AppLayout should fall back to the active navigation item label when no explicit page header title is present",
  );
  assert.match(
    source,
    /showDockedPageActions\s*=\s*pageHeader\?\.mode === ["']dock-on-scroll["'] && !pageHeaderBodyVisible/,
    "AppLayout should only surface page actions in the top bar after the docked header state is active",
  );
  assert.match(
    source,
    /showDockedPageActions && pageHeader\?\.actions/,
    "AppLayout should reuse page actions in the compact top bar when the intro docks away",
  );
  assert.doesNotMatch(
    source,
    /Codex Pool/,
    "AppLayout should not fall back to a hard-coded product name in the compact shell title",
  );
});

test("page header docking should follow the real scroll container instead of IntersectionObserver", async () => {
  const source = await readFile(PAGE_HEADER_CONTEXT_PATH, "utf8");

  assert.match(
    source,
    /addEventListener\('scroll'/,
    "page header docking should listen to the real scroll container",
  );
  assert.match(
    source,
    /getBoundingClientRect\(\)/,
    "page header docking should measure intro visibility from live layout geometry",
  );
  assert.match(
    source,
    /useState/,
    "page header docking should react when the intro anchor mounts after loading states resolve",
  );
  assert.match(
    source,
    /return setNode/,
    "page header docking should expose a callback ref so delayed intro mounts still register listeners",
  );
  assert.doesNotMatch(
    source,
    /IntersectionObserver/,
    "page header docking should no longer depend on an IntersectionObserver chain",
  );
});
