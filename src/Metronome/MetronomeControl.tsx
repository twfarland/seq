import { createMetronomePort } from "./MetronomePort";
import { createEffect, createSignal } from "solid-js";

export type MetronomeControlProps = {
  midiOutput: MIDIOutput;
};

export function MetronomeControl({ midiOutput }: MetronomeControlProps) {
  const { send, output } = createMetronomePort(midiOutput);
  const [bpm, setBpm] = createSignal(120);
  const [ppq, setPpq] = createSignal(24);

  const startSequencer = () => send({ type: "start" });
  const stopSequencer = () => send({ type: "stop" });

  // Update worker when BPM or PPQ changes
  createEffect(() => {
    send({ type: "set_bpm", bpm: bpm() });
    send({ type: "set_ppq", ppq: ppq() });
  });

  // React to worker output
  createEffect(() => {
    const message = output();
    if (message?.type === "tick") {
      // Send MIDI message or handle other actions
    }
  });

  return (
    <div>
      <label>
        BPM:
        <input
          type="number"
          value={bpm()}
          onInput={(e) => setBpm(+e.currentTarget.value)}
        />
      </label>
      <label>
        PPQ:
        <input
          type="number"
          value={ppq()}
          onInput={(e) => setPpq(+e.currentTarget.value)}
        />
      </label>
      <button onClick={startSequencer}>Start</button>
      <button onClick={stopSequencer}>Stop</button>
    </div>
  );
}
