/**
 * T817: multiWayDiff contract tests — array and JSON-string input.
 *
 * Verifies the Defect-2 fix: multiWayDiff now accepts both shapes for the
 * `versions` parameter without crashing in the WASM shim:
 *   1. Array input (primary path) returns a valid MultiDiffResult.
 *   2. JSON-string input (legacy back-compat path) returns an identical result.
 *   3. Empty-array edge case is handled gracefully (no crash).
 *   4. Single-element array returns a valid result.
 *
 * Test runner: node:test (native, no vitest dependency).
 * Run with:
 *   node --import tsx/esm --test src/__tests__/multiwaydiff.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { multiWayDiff } from "../wasm.js";
import type { MultiDiffResult } from "../wasm.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = "line one\nline two\nline three\n";
const V1 = "line one\nline TWO\nline three\n";
const V2 = "LINE ONE\nline two\nline three\n";

function assertValidResult(result: MultiDiffResult, label: string): void {
  assert.ok(result, `${label}: result must be truthy`);
  assert.ok(
    typeof result.versionCount === "number",
    `${label}: versionCount must be a number`,
  );
  assert.ok(
    typeof result.baseVersion === "number",
    `${label}: baseVersion must be a number`,
  );
  assert.ok(Array.isArray(result.lines), `${label}: lines must be an array`);
  assert.ok(result.stats, `${label}: stats must be present`);
  assert.ok(
    typeof result.stats.totalLines === "number",
    `${label}: stats.totalLines must be a number`,
  );
}

// ── Test 1: array input (primary path) ───────────────────────────────────────

describe("multiWayDiff — array input (T817 Defect-2 fix)", () => {
  it("accepts string[] and returns a valid MultiDiffResult", () => {
    const result = multiWayDiff(BASE, [V1, V2]);
    assertValidResult(result, "array input");
    // The WASM core counts base + all additional versions, so passing 2
    // additional versions yields versionCount === 3 (base is version 1).
    assert.strictEqual(
      result.versionCount,
      3,
      "versionCount should equal base + number of versions passed (base counts as 1)",
    );
  });
});

// ── Test 2: JSON-string input (legacy back-compat path) ──────────────────────

describe("multiWayDiff — JSON-string input (back-compat)", () => {
  it("accepts JSON-encoded string and returns byte-equivalent result to array input", () => {
    const arrayResult = multiWayDiff(BASE, [V1, V2]);
    const jsonStringResult = multiWayDiff(BASE, JSON.stringify([V1, V2]));

    assertValidResult(jsonStringResult, "JSON-string input");

    // Both paths must produce identical JSON-serialisable output.
    assert.strictEqual(
      JSON.stringify(arrayResult),
      JSON.stringify(jsonStringResult),
      "Array and JSON-string inputs must produce byte-equivalent results",
    );
  });
});

// ── Test 3: empty array edge case ────────────────────────────────────────────

describe("multiWayDiff — empty array edge case", () => {
  it("handles empty versions array without crashing", () => {
    // The WASM core may return a valid result with versionCount=0, or it may
    // throw with a clear error message. Either is acceptable as a regression
    // guard — we assert the observed behavior so future changes are flagged.
    let result: MultiDiffResult | undefined;
    let thrown: Error | undefined;

    try {
      result = multiWayDiff(BASE, []);
    } catch (err) {
      thrown = err as Error;
    }

    if (thrown !== undefined) {
      // If it throws, the message must be informative (not a WASM shim crash).
      assert.ok(
        thrown.message.length > 0,
        "thrown error must have a non-empty message",
      );
      // Must NOT be the raw WASM shim error that indicates the bug has regressed.
      assert.ok(
        !thrown.message.includes("charCodeAt is not a function"),
        `WASM shim crash indicates Defect-2 regression: ${thrown.message}`,
      );
    } else {
      // If it returns, it must be a valid (possibly zero-variant) result.
      assert.ok(result !== undefined, "result must not be undefined");
      assertValidResult(result!, "empty array result");
    }
  });
});

// ── Test 4: single-element array ─────────────────────────────────────────────

describe("multiWayDiff — single-element array", () => {
  it("returns a valid result for a single version", () => {
    const result = multiWayDiff(BASE, [V1]);
    assertValidResult(result, "single-element array");
    // WASM crate counts base as version 1; single additional version = 2 total.
    assert.strictEqual(
      result.versionCount,
      2,
      "versionCount must be 2 for a single-element array (base + 1 version)",
    );
  });
});
