import type { Cast, Proc, Self } from "@nonchalant/core";
import type { Frames } from "./ports";

/** clipIndex -> index of the step currently sounding. */
export type Playhead = Record<number, number>;

/** A step event, already translated into the document's clock domain. */
export interface PendingStep {
  clipIndex: number;
  stepIndex: number;
  /** Document-clock time at which this step should appear to sound. */
  at: number;
}

export type PlayheadMsg =
  | Cast<{ type: "steps"; steps: PendingStep[] }>
  /** An animation frame arrived. `now` is document-clock milliseconds. */
  | Cast<{ type: "frame"; now: number }>
  /** Transport stopped: drop anything queued so the playhead cannot drift on. */
  | Cast<{ type: "clear" }>;

export interface PlayheadDeps {
  /** Schedule one animation frame. */
  arm: Frames;
}

/**
 * The playhead, on the UI thread.
 *
 * Step events arrive up to a full lookahead window early - that is what lets
 * MIDI be scheduled ahead of time - so the display must not run ahead with
 * them. They queue here and are published on the frame where their ideal time
 * actually arrives.
 *
 * The queue is a plain local, not state: it is a working set, and it would be
 * pure noise in a diff. State is only the small thing anyone reads, so a frame
 * on which two clips advance is one yield and exactly two wakes - the other
 * clips' step buttons sleep through it.
 */
export const playheadProc = (
  deps: PlayheadDeps
): Proc<Playhead, PlayheadMsg, void> =>
  async function* (self: Self<PlayheadMsg>) {
    let playhead: Playhead = {};
    /** Sorted by arrival, which is time order: the engine emits in time order. */
    let pending: PendingStep[] = [];

    let armed = false;
    const wake = () => {
      if (armed || self.signal.aborted || pending.length === 0) return;
      armed = true;
      deps.arm((now) => self.cast({ type: "frame", now }));
    };

    yield playhead;

    for await (const msg of self) {
      switch (msg.type) {
        case "steps": {
          pending = [...pending, ...msg.steps];
          wake();
          continue; // queued, not shown: no state change yet
        }

        case "clear": {
          pending = [];
          // The last position stays put; the view already gates it on the
          // transport running, and blanking it here would only churn the DOM.
          continue;
        }

        case "frame": {
          armed = false;
          let due = 0;
          while (due < pending.length && pending[due]!.at <= msg.now) due++;
          if (due === 0) {
            wake();
            continue;
          }

          const arrived = pending.slice(0, due);
          pending = pending.slice(due);
          // One object for the whole frame, so several clips advancing costs
          // one yield rather than one per step.
          const next: Playhead = { ...playhead };
          for (const step of arrived) next[step.clipIndex] = step.stepIndex;
          playhead = next;
          wake();
          break;
        }
      }

      yield playhead;
    }
  };
