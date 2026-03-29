/// <reference types="node" />

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const IMPORT_JOBS_PATH = new URL("./ImportJobs.tsx", import.meta.url);

test("ImportJobs normalizes optional summary collections before reading UI metrics", async () => {
  const source = await readFile(IMPORT_JOBS_PATH, "utf8");

  assert.match(
    source,
    /const errorSummary = selectedSummary\?\.error_summary \?\? \[\];/,
    "ImportJobs should normalize missing error_summary to an empty array before reading length or slicing",
  );

  assert.match(
    source,
    /const admissionCounts = selectedSummary\?\.admission_counts \?\? \{\s*ready: 0,\s*needs_refresh: 0,\s*no_quota: 0,\s*failed: 0,\s*\};/s,
    "ImportJobs should normalize missing admission_counts so the page keeps rendering when the backend omits defaulted fields",
  );
});

test("ImportJobs gives HeroUI select items explicit textValue labels", async () => {
  const source = await readFile(IMPORT_JOBS_PATH, "utf8");

  assert.match(
    source,
    /<SelectItem\s+key="refresh_token"\s+textValue=\{t\("importJobs\.credentialMode\.refreshToken"\)\}\s*>/s,
    "Credential mode options should provide textValue for accessibility",
  );

  assert.match(
    source,
    /<SelectItem\s+key=\{option\.value\}\s+textValue=\{option\.label\}\s*>/s,
    "Dynamic import status options should provide textValue for accessibility",
  );

  assert.match(
    source,
    /<SelectItem\s+key="all"\s+textValue=\{t\("importJobs\.detail\.filters\.allAdmissions"\)\}\s*>/s,
    "Admission filter options should provide textValue for accessibility",
  );
});
