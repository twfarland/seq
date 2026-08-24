import { define, registry } from "@nonchalant/core";
import { expose, portTransport, workerEndpoint } from "@nonchalant/wire";
import { sequencerProc } from "~/app/sequencer";
import { fourOnTheFloor } from "~/domain/presets";
import type { SequencerEvent } from "~/domain/events";
import { clock, documentOrigin, timer } from "../browser";

/**
 * The worker, in full: a registry with one process in it, served over the port
 * the tab already holds.
 *
 * The worker exists to keep the clock off the UI thread - `setTimeout` in a
 * dedicated worker is not throttled by rendering work or layout, so tempo stays
 * steady while the user drags a slider. Everything musical is in the domain,
 * and everything stateful is in the process; this file only supplies the three
 * things that are genuinely of this thread: a clock, a timer, and a port.
 */

/**
 * `lib.dom` is the right lib for the rest of the app, so the dedicated worker
 * global is not in scope. Declare the slice we use - which has the pleasant
 * side effect of type-checking every `postMessage` against the event type.
 */
interface WorkerScope {
  postMessage(message: SequencerEvent[]): void;
}

const ctx = self as unknown as WorkerScope;

expose(
  registry({
    sequencer: define(
      sequencerProc({
        // A batch of MIDI events, structured-cloned rather than encoded as a
        // wire frame. `portTransport` ignores anything that is not a string,
        // so the two kinds of traffic share this port without colliding.
        emit: (events) => {
          if (events.length > 0) ctx.postMessage(events);
        },
        clock,
        // A dedicated worker has its own `timeOrigin`, so its clock is offset
        // from the document's. Publishing it as state means the UI thread has
        // it before any event can arrive: the port delivers in order, and the
        // first yield happens at spawn.
        timeOrigin: documentOrigin(),
        arm: timer,
        initialPattern: fourOnTheFloor(),
      })
    ),
  }),
  portTransport(workerEndpoint())
);
