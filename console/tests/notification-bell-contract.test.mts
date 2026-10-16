import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/components/notification-bell.tsx", import.meta.url),
  "utf8",
);

test("notification panel supports predictable dismiss interactions", () => {
  assert.match(source, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(source, /containerRef\.current\?\.contains\(event\.target as Node\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /triggerRef\.current\?\.focus\(\)/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls="notification-panel"/);
  assert.match(source, /aria-hidden=\{!open\}/);
  assert.match(source, /aria-label="Close notifications"/);
  assert.doesNotMatch(source, /fixed inset-0 z-30/);
});
