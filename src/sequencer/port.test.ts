import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeWorker,
  fakeMidiOutput,
  stubAnimationFrames,
  stubPerformanceClock,
} from "~/test/fakes";
import { MidiSend } from "./midi";
import { createSequencerPort, type SequencerPort } from "./port";
import type { SequencerEvent } from "./protocol";

/** The document's `performance.timeOrigin` for these tests. */
const DOC_ORIGIN = 1_000_000;
/** The worker starts 2.5s after the document, so its clock lags by that much. */
const WORKER_ORIGIN = DOC_ORIGIN + 2500;

let frames: ReturnType<typeof stubAnimationFrames>;
let clock: ReturnType<typeof stubPerformanceClock>;
let midi: ReturnType<typeof fakeMidiOutput>;
let dispose: () => void;
let port: SequencerPort;

function mount() {
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    port = createSequencerPort(new MidiSend(midi.port), {
      createWorker: () => new FakeWorker() as unknown as Worker,
    });
  });
}

/** Deliver a worker event, having first announced the worker's time origin. */
function emitReady() {
  FakeWorker.last.emit({
    type: "ready",
    timeOrigin: WORKER_ORIGIN,
  } satisfies SequencerEvent);
}

beforeEach(() => {
  FakeWorker.reset();
  frames = stubAnimationFrames();
  clock = stubPerformanceClock(DOC_ORIGIN);
  midi = fakeMidiOutput();
  mount();
});

afterEach(() => {
  dispose();
  frames.restore();
  clock.restore();
});

describe("commands", () => {
  it("forwards commands to the worker unchanged", () => {
    port.send({ type: "set_bpm", bpm: 140 });
    port.send({ type: "start" });
    expect(FakeWorker.last.posted).toEqual([
      { type: "set_bpm", bpm: 140 },
      { type: "start" },
    ]);
  });
});

describe("clock translation", () => {
  // Regression: a dedicated worker has its own `timeOrigin`, so its
  // `performance.now()` is offset from the document's. Sending those raw values
  // to MIDIOutput.send put every event in the past ("play immediately"), which
  // silently threw away all scheduling precision.
  it("shifts worker timestamps into the document clock domain", () => {
    emitReady();
    FakeWorker.last.emit({
      type: "note_on",
      channel: 1,
      midiNote: 60,
      velocity: 100,
      time: 500,
    } satisfies SequencerEvent);

    // Worker t=500 happened 2500ms after the document's origin, so it is
    // document t=3000.
    expect(midi.send).toHaveBeenCalledWith([0x90, 60, 100], 3000);
  });

  it("translates clock, note-off, start and stop alike", () => {
    emitReady();
    const worker = FakeWorker.last;
    worker.emit({ type: "started", time: 0 } satisfies SequencerEvent);
    worker.emit({ type: "tick", time: 10, pulse: 0 } satisfies SequencerEvent);
    worker.emit({
      type: "note_off",
      channel: 2,
      midiNote: 64,
      time: 20,
    } satisfies SequencerEvent);
    worker.emit({ type: "stopped", time: 30 } satisfies SequencerEvent);

    expect(midi.send.mock.calls).toEqual([
      [[0xfa], 2500],
      [[0xf8], 2510],
      [[0x81, 64, 0], 2520],
      [[0xfc], 2530],
    ]);
  });
});

describe("transport state", () => {
  it("tracks running state from the worker's own events", () => {
    expect(port.isRunning()).toBe(false);
    FakeWorker.last.emit({ type: "started", time: 0 } satisfies SequencerEvent);
    expect(port.isRunning()).toBe(true);
    FakeWorker.last.emit({ type: "stopped", time: 0 } satisfies SequencerEvent);
    expect(port.isRunning()).toBe(false);
  });
});

describe("playhead", () => {
  const step = (clipIndex: number, stepIndex: number, time: number) =>
    ({ type: "step", clipIndex, stepIndex, time }) satisfies SequencerEvent;

  it("holds a step until its scheduled time actually arrives", () => {
    emitReady();
    // Worker t=0 is document t=2500; the UI must not jump there early.
    FakeWorker.last.emit(step(0, 5, 0));

    clock.setNow(2000);
    frames.flush(2000);
    expect(port.playhead[0]).toBeUndefined();

    clock.setNow(2500);
    frames.flush(2500);
    expect(port.playhead[0]).toBe(5);
  });

  it("applies several clips' steps in the same frame", () => {
    emitReady();
    FakeWorker.last.emit(step(0, 1, 0));
    FakeWorker.last.emit(step(1, 7, 0));

    clock.setNow(2500);
    frames.flush(2500);
    expect(port.playhead[0]).toBe(1);
    expect(port.playhead[1]).toBe(7);
  });

  it("advances through queued steps in order as time passes", () => {
    emitReady();
    FakeWorker.last.emit(step(0, 0, 0));
    FakeWorker.last.emit(step(0, 1, 100));
    FakeWorker.last.emit(step(0, 2, 200));

    clock.setNow(2500);
    frames.flush(2500);
    expect(port.playhead[0]).toBe(0);

    clock.setNow(2600);
    frames.flush(2600);
    expect(port.playhead[0]).toBe(1);

    clock.setNow(2900);
    frames.flush(2900);
    expect(port.playhead[0]).toBe(2);
  });

  it("drops queued steps on stop so the playhead cannot drift on after", () => {
    emitReady();
    FakeWorker.last.emit(step(0, 9, 1000));
    FakeWorker.last.emit({ type: "stopped", time: 0 } satisfies SequencerEvent);

    clock.setNow(10_000);
    frames.flush(10_000);
    expect(port.playhead[0]).toBeUndefined();
  });
});

describe("teardown", () => {
  it("terminates the worker and silences every channel", () => {
    const worker = FakeWorker.last;
    dispose();
    dispose = () => {};

    expect(worker.terminated).toBe(true);
    // 16 channels x (all-notes-off + all-sound-off).
    expect(midi.send).toHaveBeenCalledTimes(32);
  });

  it("does not throw when terminating - the bare method loses its receiver", () => {
    // Regression: `onCleanup(worker.terminate)` unbinds `terminate`, which
    // throws "Illegal invocation" in a real browser.
    expect(() => dispose()).not.toThrow();
    dispose = () => {};
  });
});
