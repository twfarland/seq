import { connect, portTransport } from "@nonchalant/wire";
import type { SequencerChannel } from "~/app/ports";
import type { SequencerSchema } from "~/app/messages";
import type { SequencerEvent } from "~/domain/events";

/**
 * A dedicated worker, behind {@link SequencerChannel}.
 *
 * Both kinds of traffic ride one port and neither needs framing to tell them
 * apart. nonchalant's `portTransport` looks only at string payloads, so its
 * wire frames and our structured-cloned event batches pass each other
 * untouched; each side simply ignores what is not its own.
 *
 * Everything above this file - the session, the playhead, the views - is
 * written against the interface, so the same code runs against an in-memory
 * channel in the tests without knowing the difference.
 */
export function workerChannel(
  createWorker: () => Worker = () =>
    new Worker(new URL("./entry.ts", import.meta.url), { type: "module" })
): SequencerChannel {
  const worker = createWorker();
  const connection = connect<SequencerSchema>(portTransport(worker));

  return {
    sequencer: connection.lookup("sequencer"),

    onEvents: (handler) => {
      const listener = (event: MessageEvent<unknown>) => {
        if (typeof event.data === "string") return; // a wire frame, not ours
        handler(event.data as SequencerEvent[]);
      };
      worker.addEventListener("message", listener);
      return () => worker.removeEventListener("message", listener);
    },

    close: () => {
      connection.close();
      // Must stay wrapped: passing the bare `worker.terminate` reference loses
      // its receiver and throws "Illegal invocation".
      worker.terminate();
    },
  };
}
