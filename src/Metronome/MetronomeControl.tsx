import { c } from "vinxi/dist/types/lib/logger";
import { createMetronomePort } from "./MetronomePort";
import { createEffect, createSignal, For } from "solid-js";

export type MetronomeControlProps = {
  midiOutput: MIDIOutput;
};

export function MetronomeControl({ midiOutput }: MetronomeControlProps) {
  const { send, output } = createMetronomePort(midiOutput);
  const [bpm, setBpm] = createSignal(120);
  const [ppq, setPpq] = createSignal(24);
  const [beats, setBeats] = createSignal(4);
  const [steps, setSteps] = createSignal(16);
  const [pattern, setPattern] = createSignal<Record<number, number[]>>(
    blankPattern(steps())
  );
  const [playhead, setPlayhead] = createSignal(0);

  const startSequencer = () => send({ type: "start" });
  const stopSequencer = () => send({ type: "stop" });

  // Update worker when BPM or PPQ changes
  createEffect(() => {
    send({ type: "set_bpm", bpm: bpm() });
    send({ type: "set_ppq", ppq: ppq() });
  });

  // Update worker when pattern changes
  createEffect(() => {
    send({ type: "set_pattern", pattern: pattern() });
  });

  // React to worker output
  createEffect(() => {
    const message = output();
    if (message?.type === "step") {
      // update playhead position
      setPlayhead(message.stepIndex);
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

      <div>
        <label>Pattern:</label>
        <div>
          <For each={Object.entries(pattern())}>
            {([index, notes]) => (
              // use checkboxes to toggle notes in pattern
              <input
                type="checkbox"
                checked={notes.length > 0}
                onClick={() =>
                  setPattern((prev) => {
                    const newPattern = { ...prev };
                    newPattern[Number(index)] = notes.length > 0 ? [] : [36];
                    return newPattern;
                  })
                }
                style={
                  String(playhead()) == index ? "border: 1px solid red" : ""
                }
              />
            )}
          </For>
        </div>
        <div>
          <For each={Object.entries(pattern())}>
            {([index]) => (
              <input
                type="checkbox"
                disabled
                checked={String(playhead()) == index}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

const blankPattern = (steps: number) => {
  const pattern: Record<number, number[]> = {};
  for (let i = 0; i < steps; i++) {
    pattern[i] = [];
  }
  return pattern;
};
