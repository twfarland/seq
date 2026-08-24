import type { Proc, Self } from "@nonchalant/core";
import {
  addClip,
  addLane,
  removeClip,
  removeLane,
  renamePattern,
  toggleStep,
  updateClip,
  updateLane,
} from "~/domain/edits";
import { createSequencerEngine } from "~/domain/engine";
import { MIDI_CLOCK_PPQ, type Pattern } from "~/domain/pattern";
import type { SequencerMsg, SequencerState } from "./messages";
import type { Clock, EventSink, Timer } from "./ports";

/**
 * The sequencer as a nonchalant process. It runs in the worker and owns
 * everything the app can edit: tempo, resolution, and the pattern itself.
 *
 * Owning the pattern here rather than on the UI thread is the point. An edit is
 * a message in and a *patch* out, so toggling one step costs one small message
 * each way instead of a fresh copy of the whole pattern, and only the bindings
 * that read that step wake up.
 *
 * The generator body is the reducer, and nothing in it reads a clock, sets a
 * timer, or touches a port: those arrive as {@link SequencerDeps}. That is what
 * lets `sequencer.test.ts` drive a whole performance through a plain
 * `channel()` with no worker, no timers, and no DOM.
 */

/** Everything the process needs from the outside world. */
export interface SequencerDeps {
  /** Where MIDI events go. In the worker, the raw `postMessage` channel. */
  emit: EventSink;
  /** The clock the engine is stamped against. */
  clock: Clock;
  /** That clock's origin, published as state so a reader can translate. */
  timeOrigin: number;
  /**
   * Schedule the next wake-up. Deliberately a callback rather than a
   * `setTimeout` call in here: it must be a *timer*, because a mailbox loop
   * that casts to itself synchronously settles in microtasks and the event
   * loop never turns again - no port message and no other timer would ever be
   * heard.
   */
  arm: Timer;
  /** The pattern to open with. */
  initialPattern: Pattern;
}

export const sequencerProc = (
  deps: SequencerDeps
): Proc<SequencerState, SequencerMsg, void> =>
  async function* (self: Self<SequencerMsg>) {
    const engine = createSequencerEngine();

    let bpm = 120;
    let ppq = MIDI_CLOCK_PPQ;
    let pattern = deps.initialPattern;
    let running = false;

    engine.setBpm(bpm);
    engine.setPpq(ppq);
    engine.setPattern(pattern);

    const state = (): SequencerState => ({
      bpm,
      ppq,
      pattern,
      running,
      timeOrigin: deps.timeOrigin,
    });

    /**
     * One timer chain, never two. `start` after a `stop` that is still holding
     * an unfired wake-up would otherwise leave both chains re-arming each
     * other, doubling the pulse rate - the exact bug this app was born with.
     */
    let armed = false;
    const wake = () => {
      if (armed || self.signal.aborted) return;
      armed = true;
      deps.arm(() => self.cast({ type: "tick" }));
    };

    /** Push the edited pattern at the engine and publish it. */
    const repattern = (next: Pattern) => {
      pattern = next;
      engine.setPattern(pattern);
    };

    yield state();

    for await (const msg of self) {
      switch (msg.type) {
        case "tick": {
          armed = false;
          deps.emit(engine.advance(deps.clock()));
          if (engine.isRunning()) wake();
          continue; // the clock moving is not a state change
        }

        case "start": {
          if (running) continue;
          deps.emit(engine.start(deps.clock()));
          running = true;
          wake();
          break;
        }

        case "stop": {
          if (!running) continue;
          deps.emit(engine.stop(deps.clock()));
          running = false;
          break;
        }

        case "panic": {
          deps.emit(engine.panic(deps.clock()));
          continue; // silence now, transport untouched
        }

        case "set_bpm": {
          if (msg.bpm === bpm) continue;
          // The stored value is what the user typed; the engine does the
          // clamping. Storing the clamped value instead would fight anyone
          // typing their way towards a number below the minimum.
          bpm = msg.bpm;
          engine.setBpm(bpm);
          break;
        }

        case "set_ppq": {
          if (msg.ppq === ppq) continue;
          ppq = msg.ppq;
          engine.setPpq(ppq);
          break;
        }

        case "set_pattern": {
          repattern(msg.pattern);
          break;
        }

        case "rename_pattern": {
          const next = renamePattern(pattern, msg.name);
          if (next === pattern) continue;
          repattern(next);
          break;
        }

        case "add_clip": {
          repattern(addClip(pattern));
          break;
        }

        case "remove_clip": {
          const next = removeClip(pattern, msg.clipIndex);
          if (next === pattern) continue;
          repattern(next);
          break;
        }

        case "update_clip": {
          const next = updateClip(pattern, msg.clipIndex, msg.patch);
          if (next === pattern) continue;
          repattern(next);
          break;
        }

        case "add_lane": {
          const next = addLane(pattern, msg.clipIndex);
          if (next === pattern) continue;
          repattern(next);
          break;
        }

        case "remove_lane": {
          const next = removeLane(pattern, msg.clipIndex, msg.laneIndex);
          if (next === pattern) continue;
          repattern(next);
          break;
        }

        case "update_lane": {
          const next = updateLane(
            pattern,
            msg.clipIndex,
            msg.laneIndex,
            msg.patch
          );
          if (next === pattern) continue;
          repattern(next);
          break;
        }

        case "toggle_step": {
          const next = toggleStep(
            pattern,
            msg.clipIndex,
            msg.laneIndex,
            msg.stepIndex
          );
          if (next === pattern) continue;
          repattern(next);
          break;
        }
      }

      yield state();
    }
  };
