/// <reference types="node" />

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT =
  "/Users/wangnov/Codex-Pool/.worktrees/frontend-antigravity/frontend/src";

test("Accounts consolidates operator-facing table columns and actions", async () => {
  const source = await readFile(`${ROOT}/pages/Accounts.tsx`, "utf8");

  assert.match(
    source,
    /<TableColumn>\{t\('accountPool\.columns\.operationalStatus'\)\}<\/TableColumn>/,
    "Accounts should expose the consolidated operational status column",
  );
  assert.match(
    source,
    /<TableColumn>\{t\('accountPool\.columns\.recentSignal'\)\}<\/TableColumn>/,
    "Accounts should expose the recent signal column",
  );
  assert.doesNotMatch(
    source,
    /<TableColumn>\{t\('accountPool\.columns\.reason'\)\}<\/TableColumn>|<TableColumn>\{t\('accountPool\.columns\.credentials'\)\}<\/TableColumn>/,
    "Accounts should no longer keep reason and credentials as standalone list columns",
  );
  assert.match(
    source,
    /<DropdownMenu[\s\S]*accountPool\.actions\.reprobe[\s\S]*accountPool\.actions\.restore[\s\S]*accountPool\.actions\.delete/,
    "Accounts should collapse secondary row actions into a HeroUI dropdown menu",
  );
  assert.match(
    source,
    /accountPool\.actions\.more/,
    "Accounts should label the row action dropdown through i18n",
  );
  assert.match(
    source,
    /isIconOnly[\s\S]*accountPool\.actions\.inspect[\s\S]*<Eye className="h-4 w-4" \/>/,
    "Accounts row inspect action should collapse to an icon-only button",
  );
  assert.match(
    source,
    /isIconOnly[\s\S]*accountPool\.actions\.more[\s\S]*<MoreHorizontal className="h-4 w-4" \/>/,
    "Accounts row overflow action should collapse to an icon-only button",
  );
});

test("Accounts summary cards can drive state and reason filters", async () => {
  const source = await readFile(`${ROOT}/pages/Accounts.tsx`, "utf8");

  assert.match(
    source,
    /setStateFilter\(\(current\) => \(current === card\.key \? 'all' : card\.key\)\)/,
    "Accounts state overview cards should toggle the state filter directly",
  );
  assert.match(
    source,
    /setReasonClassFilter\(\(current\) => \(current === card\.key \? 'all' : card\.key\)\)/,
    "Accounts reason overview cards should toggle the reason-class filter directly",
  );
  assert.match(
    source,
    /isPressable/,
    "Accounts overview cards should become pressable filter surfaces",
  );
});

test("Accounts list avoids showing raw account ids in the secondary identity line", async () => {
  const source = await readFile(`${ROOT}/pages/Accounts.tsx`, "utf8");

  assert.doesNotMatch(
    source,
    /const accountId = record\.chatgpt_account_id\?\.trim\(\)|record\.chatgpt_account_id \?\? '-'/,
    "Accounts list should not expose raw ChatGPT account ids in the secondary identity line",
  );
});
