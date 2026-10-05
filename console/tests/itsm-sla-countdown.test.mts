import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSlaStatus,
  formatSlaDuration,
  formatSlaDurationDetailed,
  type SlaTicketLike,
} from "../src/lib/itsm-sla.ts";

test("formatSlaDuration formats hours and minutes cleanly without negative values", () => {
  // >= 1 hour
  assert.equal(formatSlaDuration(5040), "01h 24m"); // 1 hour 24 minutes
  assert.equal(formatSlaDuration(7200), "02h 00m"); // 2 hours
  assert.equal(formatSlaDuration(3900), "01h 05m"); // 1 hour 5 minutes

  // < 1 hour
  assert.equal(formatSlaDuration(1800), "30m"); // 30 minutes
  assert.equal(formatSlaDuration(1200), "20m"); // 20 minutes
  assert.equal(formatSlaDuration(60), "1m"); // 1 minute
  assert.equal(formatSlaDuration(0), "0m"); // 0 minutes
  assert.equal(formatSlaDuration(-500), "0m"); // Negative clamped to 0
});

test("formatSlaDurationDetailed includes seconds for high-precision displays", () => {
  assert.equal(formatSlaDurationDetailed(5040), "01h 24m");
  assert.equal(formatSlaDurationDetailed(1215), "20m 15s");
  assert.equal(formatSlaDurationDetailed(45), "45s");
  assert.equal(formatSlaDurationDetailed(0), "0s");
});

test("GREEN state: less than 75% elapsed shows healthy on-track countdown", () => {
  const start = new Date("2026-10-01T10:00:00Z").getTime();
  const due = new Date("2026-10-01T14:00:00Z").getTime(); // 4 hours total (240m)
  const now = new Date("2026-10-01T11:00:00Z").getTime(); // 1 hour elapsed = 25% elapsed (< 75%)

  const ticket = {
    created_at: "2026-10-01T10:00:00Z",
    sla_resolution_due_at: "2026-10-01T14:00:00Z",
  };

  const res = calculateSlaStatus(ticket, now);
  assert.equal(res.state, "GREEN");
  assert.equal(res.hasSla, true);
  assert.equal(res.isBreached, false);
  assert.equal(res.stateLabel, "SLA on track");
  assert.equal(res.formattedRemaining, "03h 00m remaining");
  assert.equal(res.formattedShort, "03h 00m");
  assert.equal(res.elapsedPercentage, 25);
});

test("AMBER state: 75% or more elapsed shows warning countdown dynamically", () => {
  // Prompt example: SLA = 2 hours, 75% elapsed = 90 minutes elapsed, 30 minutes remaining -> Amber
  const start = new Date("2026-10-01T10:00:00Z").getTime();
  const due = new Date("2026-10-01T12:00:00Z").getTime(); // 2 hours total (120m)
  const now = new Date("2026-10-01T11:30:00Z").getTime(); // 90 minutes elapsed = 75% elapsed

  const ticket = {
    created_at: "2026-10-01T10:00:00Z",
    sla_resolution_due_at: "2026-10-01T12:00:00Z",
  };

  const res = calculateSlaStatus(ticket, now);
  assert.equal(res.state, "AMBER");
  assert.equal(res.hasSla, true);
  assert.equal(res.isBreached, false);
  assert.equal(res.stateLabel, "Warning: SLA breach approaching");
  assert.equal(res.formattedRemaining, "30m remaining");
  assert.equal(res.formattedShort, "30m");
  assert.equal(res.elapsedPercentage, 75);
});

test("AMBER state: very little time remaining before deadline", () => {
  const start = new Date("2026-10-01T10:00:00Z").getTime();
  const due = new Date("2026-10-01T12:00:00Z").getTime();
  const now = new Date("2026-10-01T11:55:00Z").getTime(); // 5 minutes remaining

  const ticket = {
    created_at: "2026-10-01T10:00:00Z",
    sla_resolution_due_at: "2026-10-01T12:00:00Z",
  };

  const res = calculateSlaStatus(ticket, now);
  assert.equal(res.state, "AMBER");
  assert.equal(res.isBreached, false);
  assert.equal(res.remainingSeconds, 300);
  assert.equal(res.formattedRemaining, "5m remaining");
});

test("RED state: deadline passed shows overdue duration without negative signs", () => {
  const start = new Date("2026-10-01T10:00:00Z").getTime();
  const due = new Date("2026-10-01T12:00:00Z").getTime();
  const now = new Date("2026-10-01T12:12:00Z").getTime(); // 12 minutes overdue

  const ticket = {
    created_at: "2026-10-01T10:00:00Z",
    sla_resolution_due_at: "2026-10-01T12:00:00Z",
  };

  const res = calculateSlaStatus(ticket, now);
  assert.equal(res.state, "RED");
  assert.equal(res.isBreached, true);
  assert.equal(res.stateLabel, "SLA breached");
  assert.equal(res.overdueSeconds, 720);
  assert.equal(res.formattedRemaining, "Breached: 12m overdue");
  assert.equal(res.formattedShort, "12m overdue");
  assert.equal(res.formattedOverdue, "Breached: 12m overdue");
});

test("PAUSED state: freezes remaining time and prevents countdown drift", () => {
  const start = new Date("2026-10-01T10:00:00Z").getTime();
  const due = new Date("2026-10-01T12:00:00Z").getTime();
  const pausedAt = "2026-10-01T10:30:00Z"; // Paused with 90m remaining

  const ticket = {
    created_at: "2026-10-01T10:00:00Z",
    sla_resolution_due_at: "2026-10-01T12:00:00Z",
    sla_paused_at: pausedAt,
    sla_status: "PAUSED",
  };

  // Even if current wall time is 4 hours later, the paused state uses paused_at
  const now = new Date("2026-10-01T14:00:00Z").getTime();
  const res = calculateSlaStatus(ticket, now);

  assert.equal(res.state, "PAUSED");
  assert.equal(res.isPaused, true);
  assert.equal(res.isBreached, false);
  assert.equal(res.remainingSeconds, 5400); // 90 minutes
  assert.equal(res.formattedShort, "Paused (01h 30m)");
});

test("NO_SLA state: ticket without SLA dates returns neutral state", () => {
  const ticket = {
    created_at: "2026-10-01T10:00:00Z",
    sla_resolution_due_at: null,
    sla_response_due_at: null,
    sla_status: "NO_SLA",
  };

  const res = calculateSlaStatus(ticket);
  assert.equal(res.state, "NO_SLA");
  assert.equal(res.hasSla, false);
  assert.equal(res.formattedRemaining, "No SLA");
  assert.equal(res.formattedShort, "No SLA");
});

test("Response vs Resolution SLA precedence", () => {
  const ticket: SlaTicketLike = {
    created_at: "2026-10-01T10:00:00Z",
    sla_response_due_at: "2026-10-01T10:30:00Z",
    sla_response_met_at: null,
    sla_resolution_due_at: "2026-10-01T14:00:00Z",
  };

  // When response SLA is not met, it is active
  const res1 = calculateSlaStatus(ticket, new Date("2026-10-01T10:10:00Z").getTime());
  assert.equal(res1.dueAt?.toISOString(), "2026-10-01T10:30:00.000Z");
  assert.equal(res1.remainingSeconds, 1200); // 20m

  // Once response SLA is met, resolution SLA becomes active
  ticket.sla_response_met_at = "2026-10-01T10:15:00Z";
  const res2 = calculateSlaStatus(ticket, new Date("2026-10-01T10:15:00Z").getTime());
  assert.equal(res2.dueAt?.toISOString(), "2026-10-01T14:00:00.000Z");
  assert.equal(res2.remainingSeconds, 13500); // 3h 45m
});
