import { Input, Output } from "./MetronomeMessage";
import { createSignal, onCleanup } from "solid-js";
import { MidiSend } from "./MidiSend";

export function createMetronomePort(midiSend: MidiSend) {
  const worker = new Worker(new URL("./MetronomeWorker.ts", import.meta.url));
  const [output, setOutput] = createSignal<Output>({ type: "initial" });

  worker.onmessage = (event: MessageEvent<Output>) => {
    const message = event.data;

    switch (message.type) {
      case "tick":
        midiSend.tick(message.time);
        break;
      case "started":
        midiSend.start();
        break;
      case "stopped":
        midiSend.stop();
        break;
      case "note_on":
        midiSend.noteOn(message);
        break;
      case "note_off":
        midiSend.noteOff(message);
        break;
      case "step":
        setOutput(message);
        break;
    }

    // TODO - separate midi and UI messages. some are both
  };

  const input = (message: Input) => {
    worker.postMessage(message);
  };

  onCleanup(worker.terminate);

  return { input, output };
}
