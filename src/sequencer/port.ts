import { batch, createSignal, onCleanup, type Accessor } from "solid-js";
import { createStore, type Store } from "solid-js/store";
import type { MidiSend } from "./midi";
import type { SequencerCommand, SequencerEvent } from "./protocol";

/** clipIndex -> index of the step currently sounding. */
export type Playhead = Record<number, number>;

export interface SequencerPort {
  send(command: SequencerCommand): void;
  playhead: Store<Playhead>;
  isRunning: Accessor<boolean>;
}

export interface SequencerPortOptions {
  /**
   * Worker factory. Injectable so tests can drive the port with a stub instead
   * of spawning a real worker, which jsdom cannot do.
   */
  createWorker?: () => Worker;
}

const defaultCreateWorker = () =>
  new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

/**
 * Owns the sequencer worker for the lifetime of the calling reactive scope:
 * spawns it, forwards MIDI events to the hardware, and surfaces the playhead as
 * reactive state.
 *
 * ## Two clock domains
 *
 * The worker stamps events with its own `performance.now()`, whose origin is
 * the moment the worker was created. `MIDIOutput.send` and the document both
 * use the page's origin. The difference between the two `timeOrigin` values -
 * both measured from the Unix epoch - converts exactly between them, and the
 * worker reports its origin in its first message.
 *
 * Without this correction every timestamp lands far in the past, which Web MIDI
 * treats as "send immediately". Playback still happens, but all scheduling
 * precision is lost and the sequencer jitters with `setTimeout`.
 */
export function createSequencerPort(
  midiSend: MidiSend,
  options: SequencerPortOptions = {}
): SequencerPort {
  const worker = (options.createWorker ?? defaultCreateWorker)();

  const [isRunning, setIsRunning] = createSignal(false);
  const [playhead, setPlayhead] = createStore<Playhead>({});

  /** Added to a worker timestamp to express it on the document's clock. */
  let clockOffset = 0;
  const toDocumentTime = (workerTime: number) => workerTime + clockOffset;

  /**
   * Step events arrive up to one lookahead window early so MIDI can be
   * scheduled ahead. The UI must not jump ahead with them, so they queue here
   * and are published on the frame where their ideal time actually arrives.
   */
  let pendingSteps: { clipIndex: number; stepIndex: number; at: number }[] = [];
  let frame: number | undefined;

  const drainSteps = () => {
    frame = undefined;
    const now = performance.now();
    let due = 0;
    while (due < pendingSteps.length && pendingSteps[due]!.at <= now) due++;

    if (due > 0) {
      const arrived = pendingSteps.slice(0, due);
      pendingSteps = pendingSteps.slice(due);
      // Per-clip writes inside one batch: only the clips that actually moved
      // re-render, and they do so once per frame rather than once per step.
      batch(() => {
        for (const step of arrived) setPlayhead(step.clipIndex, step.stepIndex);
      });
    }

    if (pendingSteps.length > 0) scheduleDrain();
  };

  const scheduleDrain = () => {
    if (frame === undefined && typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(drainSteps);
    }
  };

  worker.addEventListener("message", (event: MessageEvent<SequencerEvent>) => {
    const message = event.data;

    switch (message.type) {
      case "ready":
        // Both origins are epoch-relative, so their difference is the exact
        // shift between the two `performance.now()` timelines.
        clockOffset = message.timeOrigin - performance.timeOrigin;
        break;

      case "started":
        setIsRunning(true);
        midiSend.start(toDocumentTime(message.time));
        break;

      case "stopped":
        setIsRunning(false);
        midiSend.stop(toDocumentTime(message.time));
        pendingSteps = [];
        break;

      case "tick":
        midiSend.clock(toDocumentTime(message.time));
        break;

      case "note_on":
        midiSend.noteOn({
          channel: message.channel,
          midiNote: message.midiNote,
          velocity: message.velocity,
          time: toDocumentTime(message.time),
        });
        break;

      case "note_off":
        midiSend.noteOff({
          channel: message.channel,
          midiNote: message.midiNote,
          time: toDocumentTime(message.time),
        });
        break;

      case "step":
        pendingSteps.push({
          clipIndex: message.clipIndex,
          stepIndex: message.stepIndex,
          at: toDocumentTime(message.time),
        });
        scheduleDrain();
        break;
    }
  });

  const send = (command: SequencerCommand) => worker.postMessage(command);

  onCleanup(() => {
    // Terminating the worker strands every sounding note, and a queued "stop"
    // command would never be processed, so silence the port directly here.
    midiSend.panic();
    if (frame !== undefined) cancelAnimationFrame(frame);
    // Must stay wrapped: passing the bare `worker.terminate` reference loses
    // its receiver and throws "Illegal invocation".
    worker.terminate();
  });

  return { send, playhead, isRunning };
}
