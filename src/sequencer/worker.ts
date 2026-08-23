import { createSequencerEngine } from "./engine";
import type { SequencerCommand, SequencerEvent } from "./protocol";

/**
 * Timer shell around {@link createSequencerEngine}.
 *
 * The worker exists purely to keep the clock off the UI thread: `setTimeout` in
 * a dedicated worker is not throttled by rendering work or layout, so tempo
 * stays steady while the user drags a slider. All musical logic lives in the
 * engine, which this file only feeds timestamps to.
 */

/**
 * `lib.dom` is the right lib for the rest of the app, so the dedicated worker
 * global is not in scope. Declare the slice we use - which has the pleasant
 * side effect of type-checking every `postMessage` against the protocol.
 */
interface WorkerScope {
  postMessage(message: SequencerEvent): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<SequencerCommand>) => void
  ): void;
}

const ctx = self as unknown as WorkerScope;

/**
 * How often the engine is woken. Must stay well under the engine's lookahead so
 * every pulse is scheduled before its ideal time arrives.
 */
const TIMER_INTERVAL_MS = 25;

const engine = createSequencerEngine();

let timer: ReturnType<typeof setTimeout> | undefined;

const emit = (events: SequencerEvent[]) => {
  for (const event of events) ctx.postMessage(event);
};

const tick = () => {
  emit(engine.advance(performance.now()));
  if (engine.isRunning()) timer = setTimeout(tick, TIMER_INTERVAL_MS);
  else timer = undefined;
};

const startTimer = () => {
  if (timer === undefined) timer = setTimeout(tick, TIMER_INTERVAL_MS);
};

const stopTimer = () => {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
};

ctx.addEventListener("message", (event) => {
  const command = event.data;

  switch (command.type) {
    case "set_bpm":
      engine.setBpm(command.bpm);
      break;

    case "set_ppq":
      engine.setPpq(command.ppq);
      break;

    case "set_pattern":
      engine.setPattern(command.pattern);
      break;

    case "start":
      emit(engine.start(performance.now()));
      startTimer();
      break;

    case "stop":
      emit(engine.stop(performance.now()));
      stopTimer();
      break;

    case "panic":
      emit(engine.panic(performance.now()));
      break;
  }
});

// A dedicated worker has its own `timeOrigin`, so its `performance.now()` is
// offset from the document's. Publish the origin immediately - before any event
// can be emitted - so the UI thread can translate every timestamp it receives.
ctx.postMessage({ type: "ready", timeOrigin: performance.timeOrigin });
