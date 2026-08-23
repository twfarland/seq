import { vi } from "vitest";

/**
 * Test doubles shared by the port and component suites.
 *
 * jsdom provides neither `Worker` nor Web MIDI, and both are the seams this app
 * is built around - so they are stubbed here rather than mocked ad hoc.
 */

/** A `Worker` stand-in whose inbox and outbox the test drives directly. */
export class FakeWorker {
  static instances: FakeWorker[] = [];

  /** Commands the port sent to the worker, in order. */
  readonly posted: unknown[] = [];
  terminated = false;

  private readonly listeners: ((event: MessageEvent) => void)[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  static reset() {
    FakeWorker.instances.length = 0;
  }

  static get last(): FakeWorker {
    const worker = FakeWorker.instances.at(-1);
    if (!worker) throw new Error("no FakeWorker was constructed");
    return worker;
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners.push(listener);
  }

  terminate() {
    this.terminated = true;
  }

  /** Simulate a message arriving from the worker. */
  emit(data: unknown) {
    for (const listener of this.listeners) {
      listener({ data } as MessageEvent);
    }
  }
}

export function fakeMidiOutput(overrides: Partial<MIDIOutput> = {}) {
  const send = vi.fn<(data: number[], time?: number) => void>();
  const port = {
    id: "out-1",
    name: "Fake Output",
    manufacturer: "Test",
    send,
    ...overrides,
  } as unknown as MIDIOutput;
  return { send, port };
}

/**
 * Replace `requestAnimationFrame` with a queue the test flushes by hand, so
 * frame-scheduled work is deterministic rather than timing-dependent.
 */
export function stubAnimationFrames() {
  const queue: FrameRequestCallback[] = [];
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let nextHandle = 1;
  const handles = new Map<number, FrameRequestCallback>();

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const handle = nextHandle++;
    handles.set(handle, callback);
    queue.push(callback);
    return handle;
  }) as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = ((handle: number) => {
    const callback = handles.get(handle);
    if (!callback) return;
    handles.delete(handle);
    const index = queue.indexOf(callback);
    if (index !== -1) queue.splice(index, 1);
  }) as typeof cancelAnimationFrame;

  return {
    /** Run every queued callback once, at `time`. */
    flush(time: number) {
      const due = queue.splice(0, queue.length);
      for (const callback of due) callback(time);
    },
    get pending() {
      return queue.length;
    },
    restore() {
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
}

/** Pin `performance.now()` and `performance.timeOrigin` for the test. */
export function stubPerformanceClock(timeOrigin: number) {
  const now = vi.spyOn(performance, "now");
  now.mockReturnValue(0);
  const original = Object.getOwnPropertyDescriptor(performance, "timeOrigin");
  Object.defineProperty(performance, "timeOrigin", {
    value: timeOrigin,
    configurable: true,
  });

  return {
    setNow: (value: number) => now.mockReturnValue(value),
    restore() {
      now.mockRestore();
      if (original) Object.defineProperty(performance, "timeOrigin", original);
      else Reflect.deleteProperty(performance, "timeOrigin");
    },
  };
}
