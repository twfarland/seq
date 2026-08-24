import { connect, expose, memoryPair } from "@nonchalant/wire";
import { define, registry } from "@nonchalant/core";
import { vi } from "vitest";
import type { SequencerSchema } from "~/app/messages";
import type {
  Clock,
  MidiDirectory,
  MidiOut,
  MidiPermission,
  MidiPorts,
  OutputInfo,
  SequencerChannel,
} from "~/app/ports";
import { sequencerProc } from "~/app/sequencer";
import type { SequencerEvent } from "~/domain/events";
import type { Pattern } from "~/domain/pattern";
import { fourOnTheFloor } from "~/domain/presets";

/**
 * The other side of every port, for tests.
 *
 * There is nothing to mock here, which is the point of the ports: a clock is a
 * number that goes up when the test says so, a timer is a queue the test
 * fires, and a MIDI output is an object that remembers what it was told.
 */

// ---------- time ----------

/** A queue of scheduled callbacks the test fires by hand. */
export function manualTimer() {
  const queue: (() => void)[] = [];
  return {
    arm: (fn: () => void) => {
      queue.push(fn);
    },
    /** Fire every callback currently queued (callbacks may queue more). */
    fire() {
      const due = queue.splice(0, queue.length);
      for (const fn of due) fn();
    },
    get pending() {
      return queue.length;
    },
  };
}

/** Frames, driven by hand: `fire(t)` runs everything queued as at time `t`. */
export function manualFrames() {
  let queue: ((now: number) => void)[] = [];
  return {
    arm: (fn: (now: number) => void) => {
      queue.push(fn);
    },
    fire(now: number) {
      const due = queue;
      queue = [];
      for (const fn of due) fn(now);
    },
    get pending() {
      return queue.length;
    },
  };
}

// ---------- MIDI ----------

/**
 * A recording {@link MidiOut}.
 *
 * Deliberately a class, not an object literal: nonchalant tracks a class
 * instance as an atomic leaf and walks into a plain object, and this one is
 * held in process state. An object-literal fake would take a different path
 * through reconcile than the real `MidiSend` does, which is the sort of
 * difference that leaves a test green and an app broken.
 */
class RecordingMidiOut {
  clock = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  noteOn = vi.fn();
  noteOff = vi.fn();
  allNotesOff = vi.fn();
  panic = vi.fn();
}

export type FakeMidiOut = RecordingMidiOut & MidiOut;

export function fakeMidiOut(): FakeMidiOut {
  return new RecordingMidiOut() as FakeMidiOut;
}

const DEFAULT_PORT: OutputInfo = {
  id: "out-1",
  name: "Fake Output",
  manufacturer: "Test",
};

/**
 * A directory of ports the test can plug and unplug, handing out a recording
 * writer for each. `out(id)` returns the same object the app was given, so an
 * assertion about what was played is an assertion about that object.
 */
export function fakeMidiPorts(
  initial: OutputInfo[] = [DEFAULT_PORT],
  /** What the environment says it will do. Granted by default: most tests are
   * not about the prompt, and would otherwise all have to press the button. */
  permission: MidiPermission = "granted",
  /** Input ports, which seq never plays through but does report on. */
  initialInputs: OutputInfo[] = []
) {
  let attached = initial;
  let attachedInputs = initialInputs;
  const opened = new Map<string, FakeMidiOut>();
  const listeners: (() => void)[] = [];

  const directory: MidiDirectory = {
    list: () => attached.map((port) => ({ ...port })),
    inputs: () => attachedInputs.map((port) => ({ ...port })),
    open: (id) => {
      if (!attached.some((port) => port.id === id)) return undefined;
      const existing = opened.get(id);
      if (existing) return existing;
      const fresh = fakeMidiOut();
      opened.set(id, fresh);
      return fresh;
    },
    onChange: (fn) => {
      listeners.push(fn);
      return () => {
        const index = listeners.indexOf(fn);
        if (index !== -1) listeners.splice(index, 1);
      };
    },
  };

  return {
    ports: {
      available: () => true,
      permission: () => Promise.resolve(permission),
      open: () => Promise.resolve(directory),
    } satisfies MidiPorts,
    /** The writer the app was handed for `id`, if it ever asked for one. */
    out: (id = DEFAULT_PORT.id) => opened.get(id),
    firstId: initial[0]?.id ?? DEFAULT_PORT.id,
    /** Plug devices in or pull them out, then announce it. */
    setPorts(next: OutputInfo[]) {
      attached = next;
      for (const fn of [...listeners]) fn();
    },
    /** Change what is attached without announcing it - the case "Look again" exists for. */
    attachQuietly(next: OutputInfo[], nextInputs: OutputInfo[] = attachedInputs) {
      attached = next;
      attachedInputs = nextInputs;
    },
    get listenerCount() {
      return listeners.length;
    },
  };
}

/** No Web MIDI in this environment at all - not the same as refused. */
export const noMidiPorts: MidiPorts = {
  available: () => false,
  permission: () => Promise.resolve("denied"),
  open: () => Promise.reject(new Error("no MIDI here")),
};

/** A prompt that will be refused when it is finally asked for. */
export const refusedMidiPorts = (why: string): MidiPorts => ({
  available: () => true,
  permission: () => Promise.resolve("prompt"),
  open: () => Promise.reject(new Error(why)),
});

/** Blocked before we ever got here, so there is no prompt left to show. */
export const blockedMidiPorts: MidiPorts = {
  available: () => true,
  permission: () => Promise.resolve("denied"),
  open: () => Promise.reject(new Error("blocked")),
};

/** A raw `MIDIOutput` stand-in, for the adapter's own tests. */
export function fakeMidiOutput(overrides: Partial<MIDIOutput> = {}) {
  const send = vi.fn<(data: number[], time?: number) => void>();
  const port = {
    ...DEFAULT_PORT,
    send,
    ...overrides,
  } as unknown as MIDIOutput;
  return { send, port };
}

/** A `MIDIAccess` stand-in, for the adapter's own tests. */
export function fakeMidiAccess(outputs: MIDIOutput[] = []) {
  const listeners: (() => void)[] = [];
  const ports = new Map(outputs.map((output) => [output.id, output]));

  const access = {
    outputs: ports,
    addEventListener: (_type: "statechange", listener: () => void) => {
      listeners.push(listener);
    },
    removeEventListener: (_type: "statechange", listener: () => void) => {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    },
  } as unknown as MIDIAccess;

  return {
    access,
    setOutputs(next: MIDIOutput[]) {
      ports.clear();
      for (const output of next) ports.set(output.id, output);
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.length;
    },
  };
}

// ---------- the sequencer ----------

export interface MemoryChannelOptions {
  timeOrigin?: number;
  clock?: Clock;
  initialPattern?: Pattern;
}

/**
 * The real sequencer process, hosted in this thread over an in-memory
 * transport, with its MIDI event channel wired to the same subscribers a
 * worker's `postMessage` would feed.
 *
 * Everything the worker entry supplies is supplied here instead, so tests
 * against this exercise the actual process and the actual wire - only the
 * thread and the clock are fake.
 */
export function memoryChannel(options: MemoryChannelOptions = {}) {
  const pair = memoryPair();
  const listeners = new Set<(events: SequencerEvent[]) => void>();
  const timer = manualTimer();

  const emit = (events: SequencerEvent[]) => {
    if (events.length === 0) return;
    for (const listener of listeners) listener(events);
  };

  const stopHosting = expose(
    registry({
      sequencer: define(
        sequencerProc({
          emit,
          clock: options.clock ?? (() => 0),
          timeOrigin: options.timeOrigin ?? 0,
          arm: timer.arm,
          initialPattern: options.initialPattern ?? fourOnTheFloor(),
        })
      ),
    }),
    pair.host
  );

  const connection = connect<SequencerSchema>(pair.client);

  const channel: SequencerChannel = {
    sequencer: connection.lookup("sequencer"),
    onEvents: (handler) => {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    close: () => {
      connection.close();
      stopHosting();
    },
  };

  return { channel, emit, timer, settle: pair.settle };
}
