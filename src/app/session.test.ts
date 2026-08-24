import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SequencerEvent } from "~/domain/events";
import {
  fakeMidiOut,
  manualFrames,
  memoryChannel,
  type FakeMidiOut,
} from "~/test/fakes";
import { createSession, type Session } from "./session";

/**
 * The interface's side: two clock domains, and a playhead that must not run
 * ahead of the music.
 *
 * The sequencer here is the real process, hosted in this thread over an
 * in-memory transport - so the origin these tests translate by is the one the
 * process actually published, not a value poked in.
 */

/** This side's clock origin. */
const DOC_ORIGIN = 1_000_000;
/** The worker started 2.5s later, so its clock lags by that much. */
const WORKER_ORIGIN = DOC_ORIGIN + 2500;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let channel: ReturnType<typeof memoryChannel>;
let out: FakeMidiOut;
let frames: ReturnType<typeof manualFrames>;
let session: Session;

/** A cast has to reach the host, be handled, yield, and come back as a patch. */
const sync = async () => {
  for (let round = 0; round < 4; round++) {
    await channel.settle();
    await settle();
  }
};

/** Deliver a batch of events on the raw channel. */
const emit = (...events: SequencerEvent[]) => channel.emit(events);

/** Run every queued animation frame, as at `time`. */
const frame = async (time: number) => {
  frames.fire(time);
  await settle();
};

beforeEach(async () => {
  channel = memoryChannel({ timeOrigin: WORKER_ORIGIN });
  out = fakeMidiOut();
  frames = manualFrames();

  session = createSession({
    channel: channel.channel,
    output: () => out,
    frames: frames.arm,
    documentOrigin: DOC_ORIGIN,
  });

  // Wait for the first snapshot: the clock origin travels with it.
  await sync();
});

afterEach(() => {
  session[Symbol.dispose]();
});

describe("state over the wire", () => {
  it("arrives as a snapshot, clock origin included", () => {
    expect(session.sequencer()).toMatchObject({
      timeOrigin: WORKER_ORIGIN,
      running: false,
    });
  });

  it("follows the sequencer's own transport state rather than guessing", async () => {
    expect(session.sequencer()?.running).toBe(false);
    session.sequencer.cast({ type: "start" });
    await sync();
    expect(session.sequencer()?.running).toBe(true);
  });

  it("carries an edit there and the result back", async () => {
    session.sequencer.cast({
      type: "toggle_step",
      clipIndex: 0,
      laneIndex: 0,
      stepIndex: 1,
    });
    await sync();
    expect(
      session.sequencer()?.pattern.clips[0]?.lanes[0]?.steps[1]
    ).toMatchObject({ velocity: 100 });
  });
});

describe("clock translation", () => {
  // Regression: a dedicated worker has its own clock origin, so its timestamps
  // are offset from the document's. Passing those raw to Web MIDI put every
  // event in the past ("play immediately"), silently discarding all scheduling
  // precision.
  it("shifts sequencer timestamps into this side's clock domain", () => {
    emit({
      type: "note_on",
      channel: 1,
      midiNote: 60,
      velocity: 100,
      time: 500,
    });

    // Worker t=500 happened 2500ms after this side's origin: t=3000.
    expect(out.noteOn).toHaveBeenCalledWith({
      channel: 1,
      midiNote: 60,
      velocity: 100,
      time: 3000,
    });
  });

  it("translates clock, note-off, start and stop alike", () => {
    emit(
      { type: "started", time: 0 },
      { type: "tick", time: 10, pulse: 0 },
      { type: "note_off", channel: 2, midiNote: 64, time: 20 },
      { type: "stopped", time: 30 }
    );

    expect(out.start).toHaveBeenCalledWith(2500);
    expect(out.clock).toHaveBeenCalledWith(2510);
    expect(out.noteOff).toHaveBeenCalledWith({
      channel: 2,
      midiNote: 64,
      time: 2520,
    });
    expect(out.stop).toHaveBeenCalledWith(2530);
  });
});

describe("playhead", () => {
  it("holds a step until its scheduled time actually arrives", async () => {
    emit({ type: "step", clipIndex: 0, stepIndex: 2, time: 1_000 });
    await settle();

    await frame(3_000);
    expect(session.playhead()[0]).toBeUndefined();

    // Worker t=1000 is this side's t=3500.
    await frame(3_500);
    expect(session.playhead()[0]).toBe(2);
  });

  it("applies several clips' steps in the same frame", async () => {
    emit(
      { type: "step", clipIndex: 0, stepIndex: 1, time: 0 },
      { type: "step", clipIndex: 1, stepIndex: 5, time: 0 }
    );
    await settle();

    await frame(2_500);
    expect(session.playhead()).toEqual({ 0: 1, 1: 5 });
  });

  it("drops queued steps on stop so the playhead cannot drift on after", async () => {
    emit(
      { type: "step", clipIndex: 0, stepIndex: 1, time: 0 },
      { type: "step", clipIndex: 0, stepIndex: 2, time: 100 }
    );
    await settle();
    await frame(2_500);
    expect(session.playhead()[0]).toBe(1);

    emit({ type: "stopped", time: 50 });
    await settle();
    await frame(9_999);

    expect(session.playhead()[0]).toBe(1);
  });
});

describe("teardown", () => {
  it("silences the output and closes the channel", () => {
    session[Symbol.dispose]();
    expect(out.panic).toHaveBeenCalled();
  });
});
