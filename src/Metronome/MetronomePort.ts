import { Input, Output } from "./MetronomeMessage";
import { createSignal, onCleanup } from "solid-js";

export function createMetronomePort(midiOutput: MIDIOutput) {
  const worker = new Worker(new URL("./MetronomeWorker.ts", import.meta.url));
  const [output, setOutput] = createSignal<Output>({ type: "initial" });

  worker.onmessage = (event: MessageEvent<Output>) => {
    setOutput(event.data);
    handleMidi(event.data, midiOutput);
  };

  const send = (message: Input) => {
    worker.postMessage(message);
  };

  onCleanup(worker.terminate);

  return { send, output };
}

function handleMidi(message: Output, midiOutput: MIDIOutput) {
  switch (message.type) {
    case "tick":
      midiOutput.send([0xf8], message.time); // MIDI Timing Clock message
      break;
    case "started":
      midiOutput.send([0xfa]); // MIDI Start message
      break;
    case "stopped":
      midiOutput.send([0xfc]); // MIDI Stop message
      break;
    case "note_on":
      midiOutput.send(
        [0x90 + (message.channel - 1), message.note, message.velocity],
        message.time
      );
      break;
    case "note_off":
      midiOutput.send(
        [0x80 + (message.channel - 1), message.note, 0x00],
        message.time
      );
      break;
  }
}
