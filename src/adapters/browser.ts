import type { Clock, Frames, Timer } from "~/app/ports";

/**
 * The browser, behind the ports.
 *
 * Four one-liners, and the reason every process above them is deterministic
 * under test: this is the only file that reads a clock or sets a timer.
 */

export const clock: Clock = () => performance.now();

/** This document's clock origin, to translate the worker's against. */
export const documentOrigin = (): number => performance.timeOrigin;

/**
 * How often the engine is woken. Must stay well under the engine's lookahead so
 * every pulse is scheduled before its ideal time arrives.
 */
export const TIMER_INTERVAL_MS = 25;

export const timer: Timer = (fn) => {
  setTimeout(fn, TIMER_INTERVAL_MS);
};

export const frames: Frames = (fn) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
};
