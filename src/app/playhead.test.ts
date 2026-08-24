import { spawn } from "@nonchalant/core";
import { afterEach, describe, expect, it } from "vitest";
import { manualFrames } from "~/test/fakes";
import { playheadProc, type Playhead } from "./playhead";

/**
 * The playhead has one job that is easy to get wrong: step events arrive up to
 * a full lookahead window *early*, because that is what lets MIDI be scheduled
 * ahead of time. The display must not run early with them.
 */

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const disposers: (() => void)[] = [];

function harness() {
  const frames = manualFrames();
  const proc = spawn(
    playheadProc({ arm: frames.arm }),
    undefined,
    { initial: {} as Playhead }
  );
  disposers.push(() => proc[Symbol.dispose]());

  return {
    proc,
    frames,
    /** Run every queued frame callback, as at `time`. */
    async frame(time: number) {
      frames.fire(time);
      await settle();
    },
  };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("scheduling", () => {
  it("holds a step until its time actually arrives", async () => {
    const playhead = harness();
    playhead.proc.cast({
      type: "steps",
      steps: [{ clipIndex: 0, stepIndex: 3, at: 1_000 }],
    });
    await settle();

    await playhead.frame(900);
    expect(playhead.proc()[0]).toBeUndefined();

    await playhead.frame(1_000);
    expect(playhead.proc()[0]).toBe(3);
  });

  it("advances through queued steps in order as time passes", async () => {
    const playhead = harness();
    playhead.proc.cast({
      type: "steps",
      steps: [
        { clipIndex: 0, stepIndex: 0, at: 100 },
        { clipIndex: 0, stepIndex: 1, at: 200 },
        { clipIndex: 0, stepIndex: 2, at: 300 },
      ],
    });
    await settle();

    await playhead.frame(150);
    expect(playhead.proc()[0]).toBe(0);

    await playhead.frame(250);
    expect(playhead.proc()[0]).toBe(1);

    await playhead.frame(1_000);
    expect(playhead.proc()[0]).toBe(2);
  });

  it("applies several clips in one frame", async () => {
    const playhead = harness();
    playhead.proc.cast({
      type: "steps",
      steps: [
        { clipIndex: 0, stepIndex: 4, at: 100 },
        { clipIndex: 1, stepIndex: 7, at: 100 },
      ],
    });
    await settle();

    await playhead.frame(100);
    expect(playhead.proc()).toEqual({ 0: 4, 1: 7 });
  });

  it("keeps asking for frames while anything is still queued", async () => {
    const playhead = harness();
    playhead.proc.cast({
      type: "steps",
      steps: [{ clipIndex: 0, stepIndex: 1, at: 500 }],
    });
    await settle();

    await playhead.frame(0);
    expect(playhead.frames.pending).toBe(1);

    await playhead.frame(500);
    // Nothing left to wait for.
    expect(playhead.frames.pending).toBe(0);
  });
});

describe("stopping", () => {
  it("drops queued steps so the playhead cannot drift on after", async () => {
    const playhead = harness();
    playhead.proc.cast({
      type: "steps",
      steps: [
        { clipIndex: 0, stepIndex: 1, at: 100 },
        { clipIndex: 0, stepIndex: 2, at: 200 },
      ],
    });
    await settle();
    await playhead.frame(100);
    expect(playhead.proc()[0]).toBe(1);

    playhead.proc.cast({ type: "clear" });
    await settle();
    await playhead.frame(1_000);

    // Still on the last step it actually reached, not the one that was queued.
    expect(playhead.proc()[0]).toBe(1);
  });
});
