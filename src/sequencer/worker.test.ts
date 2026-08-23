import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SequencerCommand, SequencerEvent } from "./protocol";

/**
 * Exercises the worker's timer shell.
 *
 * The module wires itself to the worker global on import, so each test installs
 * a fake `self`, resets the module registry and re-imports to get a clean
 * instance. Timers are faked so "how long does it keep polling" is an assertion
 * rather than a wait.
 */

interface Harness {
  emitted: SequencerEvent[];
  send(command: SequencerCommand): void;
}

let originalSelf: PropertyDescriptor | undefined;

async function loadWorker(): Promise<Harness> {
  const emitted: SequencerEvent[] = [];
  let listener: ((event: MessageEvent<SequencerCommand>) => void) | undefined;

  const fakeSelf = {
    postMessage: (message: SequencerEvent) => emitted.push(message),
    addEventListener: (
      _type: "message",
      handler: (event: MessageEvent<SequencerCommand>) => void
    ) => {
      listener = handler;
    },
  };

  Object.defineProperty(globalThis, "self", {
    value: fakeSelf,
    configurable: true,
    writable: true,
  });

  vi.resetModules();
  await import("./worker");

  return {
    emitted,
    send(command) {
      if (!listener) throw new Error("worker registered no message listener");
      listener({ data: command } as MessageEvent<SequencerCommand>);
    },
  };
}

const only = <T extends SequencerEvent["type"]>(
  events: SequencerEvent[],
  type: T
) =>
  events.filter((e): e is Extract<SequencerEvent, { type: T }> => e.type === type);

beforeEach(() => {
  originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalSelf) Object.defineProperty(globalThis, "self", originalSelf);
});

describe("handshake", () => {
  it("publishes its time origin before anything else", async () => {
    const worker = await loadWorker();
    expect(worker.emitted[0]).toEqual({
      type: "ready",
      timeOrigin: performance.timeOrigin,
    });
  });
});

describe("timer lifecycle", () => {
  it("keeps emitting pulses while running", async () => {
    const worker = await loadWorker();
    worker.send({ type: "start" });

    const atStart = only(worker.emitted, "tick").length;
    expect(atStart).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(only(worker.emitted, "tick").length).toBeGreaterThan(atStart);
  });

  it("stops polling once stopped, leaving no timer behind", async () => {
    const worker = await loadWorker();
    worker.send({ type: "start" });
    await vi.advanceTimersByTimeAsync(200);
    worker.send({ type: "stop" });

    const afterStop = worker.emitted.length;
    await vi.advanceTimersByTimeAsync(5000);

    expect(worker.emitted.length).toBe(afterStop);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not stack a second timer when started twice", async () => {
    const worker = await loadWorker();
    worker.send({ type: "start" });
    worker.send({ type: "start" });
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("can be restarted after stopping", async () => {
    const worker = await loadWorker();
    worker.send({ type: "start" });
    worker.send({ type: "stop" });
    worker.send({ type: "start" });

    expect(only(worker.emitted, "started")).toHaveLength(2);
    const before = only(worker.emitted, "tick").length;
    await vi.advanceTimersByTimeAsync(500);
    expect(only(worker.emitted, "tick").length).toBeGreaterThan(before);
  });
});

describe("commands", () => {
  it("applies tempo before starting", async () => {
    const slow = await loadWorker();
    slow.send({ type: "set_bpm", bpm: 60 });
    slow.send({ type: "start" });
    await vi.advanceTimersByTimeAsync(1000);
    const slowTicks = only(slow.emitted, "tick").length;

    const fast = await loadWorker();
    fast.send({ type: "set_bpm", bpm: 240 });
    fast.send({ type: "start" });
    await vi.advanceTimersByTimeAsync(1000);

    expect(only(fast.emitted, "tick").length).toBeGreaterThan(slowTicks * 2);
  });

  it("plays the pattern it is given", async () => {
    const worker = await loadWorker();
    worker.send({
      type: "set_pattern",
      pattern: {
        name: "One note",
        clips: [
          {
            name: "Clip",
            channel: 3,
            beatsPerMeasure: 4,
            subdivisionPerBeat: 4,
            lanes: [
              {
                instrument: "note",
                midiNote: 64,
                steps: { 0: { velocity: 90, lengthInSteps: 1 } },
              },
            ],
          },
        ],
      },
    });
    worker.send({ type: "start" });

    expect(only(worker.emitted, "note_on")[0]).toMatchObject({
      channel: 3,
      midiNote: 64,
      velocity: 90,
    });
  });

  it("releases sounding notes on panic without stopping the clock", async () => {
    const worker = await loadWorker();
    worker.send({
      type: "set_pattern",
      pattern: {
        name: "Held",
        clips: [
          {
            name: "Clip",
            channel: 1,
            beatsPerMeasure: 4,
            subdivisionPerBeat: 4,
            lanes: [
              {
                instrument: "pad",
                midiNote: 60,
                steps: { 0: { velocity: 90, lengthInSteps: 16 } },
              },
            ],
          },
        ],
      },
    });
    worker.send({ type: "start" });
    worker.send({ type: "panic" });

    expect(only(worker.emitted, "note_off")).toHaveLength(1);
    expect(only(worker.emitted, "stopped")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("releases sounding notes when stopped, so nothing hangs", async () => {
    const worker = await loadWorker();
    worker.send({
      type: "set_pattern",
      pattern: {
        name: "Held",
        clips: [
          {
            name: "Clip",
            channel: 1,
            beatsPerMeasure: 4,
            subdivisionPerBeat: 4,
            lanes: [
              {
                instrument: "pad",
                midiNote: 60,
                steps: { 0: { velocity: 90, lengthInSteps: 16 } },
              },
            ],
          },
        ],
      },
    });
    worker.send({ type: "start" });
    worker.send({ type: "stop" });

    const tail = worker.emitted.slice(-2).map((e) => e.type);
    expect(tail).toEqual(["note_off", "stopped"]);
  });

  it("accepts a resolution change", async () => {
    const worker = await loadWorker();
    worker.send({ type: "set_ppq", ppq: 48 });
    worker.send({ type: "start" });
    await vi.advanceTimersByTimeAsync(500);
    // Doubling the resolution doubles the pulse rate.
    expect(only(worker.emitted, "tick").length).toBeGreaterThan(40);
  });
});
