// In-memory event bus for run progress. Late subscribers get the full history replayed.
const runs = new Map(); // runId -> { events: [], listeners: Set<fn>, done: boolean }
const activeByUser = new Map(); // userId -> runId

export function createRun(runId, userId) {
  runs.set(runId, { events: [], listeners: new Set(), done: false });
  activeByUser.set(userId, runId);
}

export const activeRunFor = (userId) => activeByUser.get(userId) || null;

export function emit(runId, event) {
  const r = runs.get(runId);
  if (!r) return;
  const e = { id: r.events.length, ...event };
  r.events.push(e);
  for (const fn of r.listeners) fn(e);
}

export function finishRun(runId, userId) {
  const r = runs.get(runId);
  if (r) {
    r.done = true;
    // keep history for a while so a reconnecting browser can still read the end of the run
    setTimeout(() => runs.delete(runId), 10 * 60 * 1000).unref();
  }
  if (activeByUser.get(userId) === runId) activeByUser.delete(userId);
}

/** Replays history to `fn`. Returns { done, unsubscribe }; when done is true no more events will arrive. */
export function subscribe(runId, fn) {
  const r = runs.get(runId);
  if (!r) return null;
  r.events.forEach(fn);
  if (r.done) return { done: true, unsubscribe: () => {} };
  r.listeners.add(fn);
  return { done: false, unsubscribe: () => r.listeners.delete(fn) };
}

export const runExists = (runId) => runs.has(runId);
