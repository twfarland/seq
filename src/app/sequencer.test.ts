import { spawn } from "@nonchalant/core";
import { afterEach, describe, expect, it } from "vitest";
import { manualTimer } from "~/test/fakes";
import type { Pattern } from "~/domain/pattern";
import { fourOnTheFloor } from "~/domain/presets";
import type { SequencerEvent } from "~/domain/events";
import { sequencerProc } from "./sequencer";

/**
 * The sequencer process, driven directly.
 *
 * There is no worker here, no `postMessage`, and no real timer: the process
 * takes its clock, its timer and its output port as dependencies, so a whole
 * performance is a list of casts and a number that goes up.
 */

const WORKER_ORIGIN = 1_234;
const TIMER_INTERVAL_MS = 25;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const only = <T extends SequencerEvent["type"]>(
  events: SequencerEvent[],
  type: T
) =>
  events.filter(
    (e): e is Extract<SequencerEvent, { type: T }> => e.type === type
  );

const oneNote = (
  lengthInSteps: number,
  overrides: { channel?: number; midiNote?: number; velocity?: number } = {}
): Pattern => ({
  name: "One note",
  clips: [
    {
      name: "Clip",
      channel: overrides.channel ?? 1,
      beatsPerMeasure: 4,
      subdivisionPerBeat: 4,
      lanes: [
        {
          instrument: "note",
          midiNote: overrides.midiNote ?? 60,
          steps: { 0: { velocity: overrides.velocity ?? 90, lengthInSteps } },
        },
      ],
    },
  ],
});

const running: (() => void)[] = [];

function harness(initialPattern: Pattern = fourOnTheFloor()) {
  const emitted: SequencerEvent[] = [];
  const timer = manualTimer();
  let now = 0;

  const proc = spawn(
    sequencerProc({
      emit: (events) => emitted.push(...events),
      clock: () => now,
      timeOrigin: WORKER_ORIGIN,
      arm: timer.arm,
      initialPattern,
    }),
    undefined
  );
  running.push(() => proc[Symbol.dispose]());

  return {
    proc,
    emitted,
    timer,
    /** Let the mailbox drain. */
    settle,
    /** Move the clock forward, waking the timer as the worker's would. */
    async advance(ms: number) {
      const target = now + ms;
      while (now < target) {
        now = Math.min(target, now + TIMER_INTERVAL_MS);
        timer.fire();
        await settle();
      }
    },
  };
}

afterEach(() => {
  for (const dispose of running.splice(0)) dispose();
});

describe("the first snapshot", () => {
  it("publishes the worker's time origin, before anything can be played", async () => {
    const seq = harness();
    await seq.settle();

    expect(seq.proc()).toMatchObject({
      timeOrigin: WORKER_ORIGIN,
      running: false,
      bpm: 120,
    });
    expect(seq.emitted).toHaveLength(0);
  });

  it("opens with the pattern it was given", async () => {
    const seq = harness(oneNote(1));
    await seq.settle();
    expect(seq.proc()?.pattern.name).toBe("One note");
  });
});

describe("timer lifecycle", () => {
  it("keeps emitting pulses while running", async () => {
    const seq = harness();
    seq.proc.cast({ type: "start" });
    await seq.settle();

    const atStart = only(seq.emitted, "tick").length;
    expect(atStart).toBeGreaterThan(0);

    await seq.advance(500);
    expect(only(seq.emitted, "tick").length).toBeGreaterThan(atStart);
  });

  it("stops polling once stopped, leaving no timer behind", async () => {
    const seq = harness();
    seq.proc.cast({ type: "start" });
    await seq.advance(200);
    seq.proc.cast({ type: "stop" });
    await seq.settle();

    const afterStop = seq.emitted.length;
    // The wake-up already scheduled still fires; it must not re-arm.
    await seq.advance(5000);

    expect(seq.emitted).toHaveLength(afterStop);
    expect(seq.timer.pending).toBe(0);
  });

  it("does not stack a second timer when started twice", async () => {
    const seq = harness();
    seq.proc.cast({ type: "start" });
    seq.proc.cast({ type: "start" });
    await seq.settle();
    expect(seq.timer.pending).toBe(1);
  });

  it("can be restarted after stopping, still with one timer", async () => {
    const seq = harness();
    seq.proc.cast({ type: "start" });
    seq.proc.cast({ type: "stop" });
    seq.proc.cast({ type: "start" });
    await seq.settle();

    expect(only(seq.emitted, "started")).toHaveLength(2);
    expect(seq.timer.pending).toBe(1);

    const before = only(seq.emitted, "tick").length;
    await seq.advance(500);
    expect(only(seq.emitted, "tick").length).toBeGreaterThan(before);
  });
});

describe("transport", () => {
  it("applies tempo before starting", async () => {
    const slow = harness();
    slow.proc.cast({ type: "set_bpm", bpm: 60 });
    slow.proc.cast({ type: "start" });
    await slow.advance(1000);
    const slowTicks = only(slow.emitted, "tick").length;

    const fast = harness();
    fast.proc.cast({ type: "set_bpm", bpm: 240 });
    fast.proc.cast({ type: "start" });
    await fast.advance(1000);

    expect(only(fast.emitted, "tick").length).toBeGreaterThan(slowTicks * 2);
  });

  it("accepts a resolution change", async () => {
    const seq = harness();
    seq.proc.cast({ type: "set_ppq", ppq: 48 });
    seq.proc.cast({ type: "start" });
    await seq.advance(500);
    // Doubling the resolution doubles the pulse rate.
    expect(only(seq.emitted, "tick").length).toBeGreaterThan(40);
  });

  it("plays the pattern it holds", async () => {
    const seq = harness(oneNote(1, { channel: 3, midiNote: 64, velocity: 90 }));
    seq.proc.cast({ type: "start" });
    await seq.settle();

    expect(only(seq.emitted, "note_on")[0]).toMatchObject({
      channel: 3,
      midiNote: 64,
      velocity: 90,
    });
  });

  it("releases sounding notes on panic without stopping the clock", async () => {
    const seq = harness(oneNote(16));
    seq.proc.cast({ type: "start" });
    seq.proc.cast({ type: "panic" });
    await seq.settle();

    expect(only(seq.emitted, "note_off")).toHaveLength(1);
    expect(only(seq.emitted, "stopped")).toHaveLength(0);
    expect(seq.proc()?.running).toBe(true);
    expect(seq.timer.pending).toBe(1);
  });

  it("releases sounding notes when stopped, so nothing hangs", async () => {
    const seq = harness(oneNote(16));
    seq.proc.cast({ type: "start" });
    seq.proc.cast({ type: "stop" });
    await seq.settle();

    expect(seq.emitted.slice(-2).map((event) => event.type)).toEqual([
      "note_off",
      "stopped",
    ]);
    expect(seq.proc()?.running).toBe(false);
  });

  it("keeps the value the user typed, leaving the engine to clamp it", async () => {
    const seq = harness();
    seq.proc.cast({ type: "set_bpm", bpm: 1 });
    await seq.settle();
    // Below BPM_RANGE.min, but a field being typed into must not be rewritten
    // under the user's cursor.
    expect(seq.proc()?.bpm).toBe(1);
  });
});

describe("editing", () => {
  it("toggles a step on and off again", async () => {
    const seq = harness();
    const step = () => seq.proc()?.pattern.clips[0]?.lanes[0]?.steps[1];
    await seq.settle();
    expect(step()).toBeUndefined();

    seq.proc.cast({
      type: "toggle_step",
      clipIndex: 0,
      laneIndex: 0,
      stepIndex: 1,
    });
    await seq.settle();
    expect(step()).toMatchObject({ velocity: 100, lengthInSteps: 1 });

    seq.proc.cast({
      type: "toggle_step",
      clipIndex: 0,
      laneIndex: 0,
      stepIndex: 1,
    });
    await seq.settle();
    expect(step()).toBeUndefined();
  });

  it("plays an edit made while running, without stopping", async () => {
    const seq = harness(oneNote(1));
    seq.proc.cast({
      type: "update_lane",
      clipIndex: 0,
      laneIndex: 0,
      patch: { midiNote: 72 },
    });
    seq.proc.cast({ type: "start" });
    await seq.settle();

    expect(only(seq.emitted, "note_on")[0]).toMatchObject({ midiNote: 72 });
    expect(seq.proc()?.running).toBe(true);
  });

  it("ignores an edit to a clip that is not there", async () => {
    const seq = harness();
    await seq.settle();
    const before = seq.proc()?.pattern;

    seq.proc.cast({ type: "update_clip", clipIndex: 9, patch: { channel: 2 } });
    await seq.settle();

    // The same object, not an equal one: no diff, so nothing downstream wakes.
    expect(seq.proc()?.pattern).toBe(before);
  });

  it("adds and removes clips and lanes", async () => {
    const seq = harness();
    seq.proc.cast({ type: "add_clip" });
    await seq.settle();
    expect(seq.proc()?.pattern.clips).toHaveLength(2);

    seq.proc.cast({ type: "add_lane", clipIndex: 1 });
    await seq.settle();
    expect(seq.proc()?.pattern.clips[1]?.lanes).toHaveLength(2);

    seq.proc.cast({ type: "remove_lane", clipIndex: 1, laneIndex: 0 });
    seq.proc.cast({ type: "remove_clip", clipIndex: 0 });
    await seq.settle();
    expect(seq.proc()?.pattern.clips).toHaveLength(1);
    expect(seq.proc()?.pattern.clips[0]?.lanes).toHaveLength(1);
  });
});
