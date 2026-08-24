import { spawn } from "@nonchalant/core";
import type { Process } from "@nonchalant/core";
import type { SequencerMsg, SequencerState } from "./messages";
import { playheadProc, type Playhead, type PlayheadMsg } from "./playhead";
import type { Frames, MidiOut, SequencerChannel } from "./ports";

/**
 * A running sequencer, as the interface sees it: state to read, and a playhead
 * that keeps time with what is actually being heard.
 *
 * ## Two clock domains
 *
 * The sequencer stamps its events with its own clock, whose origin is whenever
 * it started. The display and the MIDI hardware use the document's. The
 * difference between the two origins - both measured from the Unix epoch -
 * converts exactly between them, and the sequencer publishes its origin as
 * state.
 *
 * Without this correction every timestamp lands far in the past, which Web MIDI
 * treats as "send immediately". Playback still happens, but all scheduling
 * precision is lost and the sequencer jitters with its timer.
 *
 * This file is where that translation lives, and it is the only place in the
 * app that knows there is more than one clock.
 */

export interface SessionDeps {
  /** How the sequencer is reached. A worker port in the app, memory in tests. */
  channel: SequencerChannel;
  /**
   * Where MIDI bytes go right now. Read per batch rather than captured, so
   * changing the output device needs no rewiring here.
   */
  output: () => MidiOut | undefined;
  /** Schedules one animation frame. */
  frames: Frames;
  /** The clock origin of *this* side, to translate the sequencer's against. */
  documentOrigin: number;
}

export interface Session {
  /** `undefined` until the first snapshot arrives. */
  sequencer: Process<SequencerState | undefined, SequencerMsg>;
  playhead: Process<Playhead, PlayheadMsg>;
  [Symbol.dispose](): void;
}

export function createSession(deps: SessionDeps): Session {
  const { sequencer } = deps.channel;
  const playhead = spawn(playheadProc({ arm: deps.frames }), undefined, {
    initial: {} as Playhead,
  });

  /** Added to a sequencer timestamp to express it on this side's clock. */
  const offset = () => {
    const origin = sequencer()?.timeOrigin;
    return origin === undefined ? 0 : origin - deps.documentOrigin;
  };

  const unsubscribe = deps.channel.onEvents((events) => {
    const midi = deps.output();
    const shift = offset();
    const steps: { clipIndex: number; stepIndex: number; at: number }[] = [];

    for (const event of events) {
      const time = event.time + shift;

      switch (event.type) {
        case "started":
          midi?.start(time);
          break;

        case "stopped":
          midi?.stop(time);
          playhead.cast({ type: "clear" });
          break;

        case "tick":
          midi?.clock(time);
          break;

        case "note_on":
          midi?.noteOn({
            channel: event.channel,
            midiNote: event.midiNote,
            velocity: event.velocity,
            time,
          });
          break;

        case "note_off":
          midi?.noteOff({
            channel: event.channel,
            midiNote: event.midiNote,
            time,
          });
          break;

        case "step":
          steps.push({
            clipIndex: event.clipIndex,
            stepIndex: event.stepIndex,
            at: time,
          });
          break;
      }
    }

    // One cast for the batch: the queue is drained by frame, not by message.
    if (steps.length > 0) playhead.cast({ type: "steps", steps });
  });

  return {
    sequencer,
    playhead,
    [Symbol.dispose]: () => {
      // Closing the channel strands every sounding note, and a queued "stop"
      // would never be processed, so silence the output directly here.
      deps.output()?.panic();
      unsubscribe();
      playhead[Symbol.dispose]();
      deps.channel.close();
    },
  };
}
