'use strict';
// Time rules. Everything the cafe does is Asia/Manila (UTC+8, no daylight saving).
// Pure functions (no I/O) so they are easy to test.

const MANILA_OFFSET_MS = 8 * 3600 * 1000;

/** { date: 'YYYY-MM-DD', time: 'HH:MM' } for a moment, in Manila local time. */
function manilaParts(ms = Date.now()) {
  const iso = new Date(ms + MANILA_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** True for a real calendar date written as YYYY-MM-DD. */
function isValidDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(text + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** The instant (ms since 1970) when a Manila local date + HH:MM starts. */
function slotStartMs(date, time) {
  return Date.parse(`${date}T${time}:00+08:00`);
}

/** The 24-hour rule: the slot must start at least `minHours` after `nowMs`. */
function meetsAdvanceRule(date, time, nowMs, minHours) {
  return slotStartMs(date, time) >= nowMs + minHours * 3600 * 1000;
}

/** Add whole days to a YYYY-MM-DD date. */
function addDays(date, days) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

module.exports = { manilaParts, isValidDate, slotStartMs, meetsAdvanceRule, addDays, MANILA_OFFSET_MS };
