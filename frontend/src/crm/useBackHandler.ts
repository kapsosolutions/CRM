// Browser Back / swipe-back for in-app screens.
//
// The CRM keeps its screens in React state (an open order, the template
// composer, a drawer…), not in the URL, so the browser didn't know any of them
// existed: Back skipped straight out of the whole site. This gives every open
// layer its own history entry, so Back closes the top-most one — exactly like
// the arrow / ✕ on screen.
//
//   useBackHandler(isOpen, close)            // a page, drawer or modal
//   useBackHandler(true, askToLeave, { base: true })   // the app's root guard
//
// How it works: a stack of open layers mirrors a run of same-URL history
// entries (each tagged with its depth). Opening a layer pushes an entry;
// Back pops one and runs the top layer's handler; closing a layer on screen
// rewinds the now-surplus entry so the two stay in step. The handler can
// refuse (e.g. "Discard changes?" → Keep editing): the layer then simply
// re-arms itself with a fresh entry.
import { useEffect, useRef, useState } from 'react';

interface Entry {
  id: number;
  run: () => void;
}

const stack: Entry[] = []; // index 0 is the base guard, when there is one
let seq = 0;
let baseline = -1; // history depth tag when the app loaded (entries before it aren't ours)
let histDepth = 0; // our entries currently in the browser's history
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let rewinding = false; // a history.go() we started is in flight
let exiting = false; // leaving the app on purpose: don't intercept

const depthOf = (state: unknown): number => {
  const d = (state as { crmNav?: unknown } | null)?.crmNav;
  return typeof d === 'number' ? d : 0;
};

function pushEntry() {
  histDepth += 1;
  history.pushState({ crmNav: baseline + histDepth }, '');
}

function onPop(e: PopStateEvent) {
  // If no in-app layers are open, let normal browser navigation work completely untouched
  if (stack.length === 0) {
    histDepth = 0;
    return;
  }
  const target = Math.max(0, depthOf(e.state) - baseline);
  histDepth = target;
  if (exiting) return;
  if (rewinding) {
    // Our own rewind arriving. Never run handlers for it; if a layer opened
    // while it was in flight, give that layer its entry back.
    rewinding = false;
    while (histDepth < stack.length) pushEntry();
    return;
  }
  // The user went back (possibly several steps): close that many layers,
  // top-most first.
  const closing: Entry[] = [];
  while (stack.length > target) closing.push(stack.pop()!);
  for (const entry of closing) entry.run();
  // Forward button into entries we no longer have a layer for.
  if (histDepth > stack.length) scheduleSync();
}

function init() {
  if (baseline >= 0) return;
  baseline = depthOf(history.state);
  window.addEventListener('popstate', onPop);
}

/** Drop surplus history entries left by layers closed on screen. */
function scheduleSync() {
  if (stack.length === 0) return; // Never rewind history when no layers are registered
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const extra = histDepth - stack.length;
    if (extra > 0 && !exiting && !rewinding && stack.length > 0) {
      rewinding = true;
      history.go(-extra);
    }
  }, 0);
}

function register(run: () => void, base: boolean): number {
  init();
  const entry = { id: ++seq, run };
  if (base) stack.unshift(entry);
  else stack.push(entry);
  // Re-use a surplus entry if one is still there; otherwise add one.
  if (histDepth < stack.length) pushEntry();
  return entry.id;
}

function unregister(id: number) {
  const i = stack.findIndex((e) => e.id === id);
  if (i < 0) return; // already popped by Back
  stack.splice(i, 1);
  scheduleSync();
}

/**
 * Leave the app for real (the root guard's "Leave"): step back past all of
 * our entries to wherever the user came from.
 */
export function exitApp() {
  exiting = true;
  history.go(-(histDepth + 1));
  // Still here (no earlier page, or it was this same app)? Resume intercepting.
  setTimeout(() => {
    exiting = false;
    if (histDepth < stack.length) while (histDepth < stack.length) pushEntry();
  }, 600);
}

/**
 * Fully reset and disarm the in-app history stack upon explicit user logout.
 * Prevents any popstate events from triggering in-app back handlers (like "Discard changes?").
 */
export function resetBackHandler() {
  exiting = true;
  stack.length = 0;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  rewinding = false;
  histDepth = 0;
  baseline = 0;
  setTimeout(() => {
    exiting = false;
  }, 100);
}

/**
 * While `active`, the browser's Back closes this layer by calling `onBack`.
 * `base` marks the app's root guard, which always sits underneath every
 * other layer.
 */
export function useBackHandler(active: boolean, onBack: () => void, opts: { base?: boolean } = {}) {
  const fn = useRef(onBack);
  fn.current = onBack;
  // Bumped when Back consumes this layer's entry, so it re-arms if the
  // handler decided to stay open.
  const [epoch, setEpoch] = useState(0);
  const base = !!opts.base;

  useEffect(() => {
    if (!active) return undefined;
    const id = register(() => {
      setEpoch((n) => n + 1);
      fn.current();
    }, base);
    return () => unregister(id);
  }, [active, epoch, base]);
}
