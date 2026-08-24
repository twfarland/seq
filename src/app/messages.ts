import type { Cast, Definition } from "@nonchalant/core";
import type { ClipPatch, LanePatch } from "~/domain/edits";
import type { Pattern } from "~/domain/pattern";

/**
 * The sequencer's public face: what it holds, and what you may say to it.
 *
 * This is a contract between threads, so everything here is JSON-shaped. State
 * crosses as nonchalant patches and messages cross as wire frames; neither
 * survives a `Date`, a `Map`, or a class instance. Keeping that constraint in
 * the type is what makes it impossible to forget.
 *
 * Note what is *not* here: MIDI events. Those are a stream that must be
 * delivered exactly once, and a process's value stream is deliberately lossy -
 * always the latest, never a backlog. They travel beside the wire instead, on
 * the raw port. See `app/ports.ts`.
 */

/** Everything the sequencer owns, as anyone reading it sees it. */
export interface SequencerState {
  bpm: number;
  ppq: number;
  pattern: Pattern;
  running: boolean;
  /**
   * The clock origin of wherever the sequencer is running, published with the
   * first yield so timestamps can be translated into the reader's own domain.
   *
   * It cannot arrive late: a port delivers in order, and the first yield
   * happens when the process spawns - before anything can be told to play.
   */
  timeOrigin: number;
}

export type { ClipPatch, LanePatch };

export type SequencerMsg =
  // ---------- transport ----------
  | Cast<{ type: "set_bpm"; bpm: number }>
  | Cast<{ type: "set_ppq"; ppq: number }>
  | Cast<{ type: "start" }>
  | Cast<{ type: "stop" }>
  /** Silence everything immediately without changing transport state. */
  | Cast<{ type: "panic" }>
  /**
   * Self-cast by the timer, once per wake-up. Routed through the mailbox like
   * everything else, so a test can drive the clock by hand.
   */
  | Cast<{ type: "tick" }>
  // ---------- pattern editing ----------
  | Cast<{ type: "rename_pattern"; name: string }>
  | Cast<{ type: "add_clip" }>
  | Cast<{ type: "remove_clip"; clipIndex: number }>
  | Cast<{ type: "update_clip"; clipIndex: number; patch: ClipPatch }>
  | Cast<{ type: "add_lane"; clipIndex: number }>
  | Cast<{ type: "remove_lane"; clipIndex: number; laneIndex: number }>
  | Cast<{
      type: "update_lane";
      clipIndex: number;
      laneIndex: number;
      patch: LanePatch;
    }>
  | Cast<{
      type: "toggle_step";
      clipIndex: number;
      laneIndex: number;
      stepIndex: number;
    }>
  /** Replace the whole pattern - used by tests and, later, by loading a file. */
  | Cast<{ type: "set_pattern"; pattern: Pattern }>;

/**
 * What a host serves and a client looks up. Both sides are typed against this,
 * so an edit that does not fit the message union fails to compile on both
 * threads at once.
 */
export type SequencerSchema = {
  sequencer: Definition<SequencerState, SequencerMsg, void>;
};
