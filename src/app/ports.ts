import type { Process } from "@nonchalant/core";
import type { SequencerEvent } from "~/domain/events";
import type { SequencerMsg, SequencerState } from "./messages";

/**
 * The holes in this application, and their shapes.
 *
 * Everything in `app/` is written against these and nothing else. No file here
 * knows what a `MIDIOutput` is, that time comes from `performance.now()`, that
 * frames come from `requestAnimationFrame`, or that the sequencer is reached
 * over a worker port. `adapters/` fills each hole once; the tests fill them
 * with something simpler, which is the whole point of their being holes.
 */

// ---------- time ----------

/** Milliseconds on some monotonic clock. Which one is the adapter's business. */
export type Clock = () => number;

/** Schedule a wake-up. A *timer*, not a microtask: see `app/sequencer.ts`. */
export type Timer = (fn: () => void) => void;

/** Schedule one frame, called with the time it is being painted for. */
export type Frames = (fn: (now: number) => void) => void;

// ---------- MIDI ----------

export interface NoteOnMessage {
  /** 1-based MIDI channel, 1..16. */
  channel: number;
  midiNote: number;
  velocity: number;
  /** When to sound it, on the caller's clock. Omitted means "now". */
  time?: number;
}

export interface NoteOffMessage {
  channel: number;
  midiNote: number;
  time?: number;
}

/** Somewhere to write MIDI. The engine's output, made audible. */
export interface MidiOut {
  clock(time?: number): void;
  start(time?: number): void;
  stop(time?: number): void;
  noteOn(message: NoteOnMessage): void;
  noteOff(message: NoteOffMessage): void;
  allNotesOff(channel: number, time?: number): void;
  /** Last-resort silence on every channel. */
  panic(time?: number): void;
}

/** A port, as far as anyone choosing between them needs to know. */
export interface OutputInfo {
  id: string;
  name: string;
  manufacturer: string;
}

/** The set of MIDI ports currently attached, and a way to open one. */
export interface MidiDirectory {
  list(): OutputInfo[];
  /** `undefined` if that port has since gone away. */
  open(id: string): MidiOut | undefined;
  /** Called when devices appear or disappear. Returns an unsubscribe. */
  onChange(fn: () => void): () => void;
}

export interface MidiPorts {
  /**
   * Ask for access. `undefined` means this environment has no MIDI at all,
   * which is a different answer from a rejected promise (refused permission).
   */
  open(): Promise<MidiDirectory> | undefined;
}

// ---------- the sequencer, wherever it is ----------

/**
 * A way to reach a sequencer and hear what it plays.
 *
 * Two channels, because the traffic is two kinds. `sequencer` is state, which
 * wants latest-value semantics and arrives as patches. `onEvents` is a stream
 * of scheduled notes, which wants exactly-once delivery and so cannot be state.
 * An adapter carries both; nothing in `app/` cares how.
 */
export interface SequencerChannel {
  /** `undefined` until the first snapshot arrives. */
  sequencer: Process<SequencerState | undefined, SequencerMsg>;
  /** Subscribe to MIDI event batches. Returns an unsubscribe function. */
  onEvents(handler: (events: SequencerEvent[]) => void): () => void;
  close(): void;
}

/** Where the sequencer sends what it plays, from the inside. */
export type EventSink = (events: SequencerEvent[]) => void;
