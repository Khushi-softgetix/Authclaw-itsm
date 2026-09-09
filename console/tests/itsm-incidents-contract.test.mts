import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVED_TRANSITIONS,
  itsmAllowedTransitions,
  itsmPriorityConfig,
  itsmStatusConfig,
} from "../src/lib/itsm-format.ts";

test("ITSM status transitions match approved Phase 3.2 lifecycle", () => {
  assert.deepEqual(itsmAllowedTransitions("NEW"), ["ASSIGNED", "IN_PROGRESS", "CANCELLED"]);
  assert.deepEqual(itsmAllowedTransitions("ASSIGNED"), ["IN_PROGRESS", "CANCELLED"]);
  assert.deepEqual(itsmAllowedTransitions("IN_PROGRESS"), ["PENDING", "RESOLVED", "CANCELLED"]);
  assert.deepEqual(itsmAllowedTransitions("PENDING"), ["IN_PROGRESS", "RESOLVED", "CANCELLED"]);
  assert.deepEqual(itsmAllowedTransitions("RESOLVED"), ["CLOSED", "IN_PROGRESS"]);
  assert.deepEqual(itsmAllowedTransitions("CLOSED"), []);
  assert.deepEqual(itsmAllowedTransitions("CANCELLED"), []);
  assert.deepEqual(itsmAllowedTransitions("UNKNOWN_STATE"), []);
});

test("ITSM priority config maps P1-P4 without inventing P5", () => {
  const p1 = itsmPriorityConfig("P1");
  assert.match(p1.label, /P1/);
  assert.match(p1.badge, /red/);

  const p2 = itsmPriorityConfig("P2");
  assert.match(p2.label, /P2/);
  assert.match(p2.badge, /orange/);

  const p3 = itsmPriorityConfig("P3");
  assert.match(p3.label, /P3/);
  assert.match(p3.badge, /yellow/);

  const p4 = itsmPriorityConfig("P4");
  assert.match(p4.label, /P4/);
  assert.match(p4.badge, /blue/);

  const normCritical = itsmPriorityConfig("P1_CRITICAL");
  assert.match(normCritical.label, /P1/);

  // Fallback for unknown
  const unknown = itsmPriorityConfig("P5");
  assert.equal(unknown.label, "P5");
  assert.match(unknown.badge, /slate/);
});

test("ITSM status config handles all approved lifecycle statuses", () => {
  const statuses = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED", "CANCELLED"];
  for (const st of statuses) {
    const config = itsmStatusConfig(st);
    assert.ok(config.label.length > 0);
    assert.ok(config.badge.length > 0);
    assert.ok(config.dot.length > 0);
  }
});
