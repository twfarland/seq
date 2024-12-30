import { createMetronomePort } from "./MetronomePort";
import { createEffect, createSignal, For } from "solid-js";
import { MidiSend } from "./MidiSend";
import { Pattern } from "./Pattern";

export type MetronomeControlProps = {
  midiOutput: MIDIOutput;
};

export function MetronomeControl({ midiOutput }: MetronomeControlProps) {
  const midiSend = new MidiSend(midiOutput);
  const { input, output } = createMetronomePort(midiSend);
  const [bpm, setBpm] = createSignal(120);
  const [ppq, setPpq] = createSignal(24);
  const [beats, setBeats] = createSignal(4);
  const [steps, setSteps] = createSignal(16);
  const [pattern, setPattern] = createSignal<Pattern>(blankPattern());
  const [playhead, setPlayhead] = createSignal(0);

  const startSequencer = () => input({ type: "start" });
  const stopSequencer = () => input({ type: "stop" });

  createEffect(() => {
    input({ type: "set_bpm", bpm: bpm() });
  });

  createEffect(() => {
    input({ type: "set_ppq", ppq: ppq() });
  });

  createEffect(() => {
    input({ type: "set_pattern", pattern: pattern() });
  });

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
        <label>Pattern: {pattern().name}</label>

        <div>
          <For each={pattern().clips}>
            {(clip) => (
              <div>
                <h5>{clip.name}</h5>
                <sub>
                  {clip.beats}/{clip.stepsPerBeat}, Ch. {clip.channel}
                </sub>
              </div>
            )}
          </For>

          <For each={Object.entries(pattern())}>
            {([index, notes]) => (
              // use checkboxes to toggle notes in pattern
              <input
                type="checkbox"
                checked={notes.length > 0}
                onClick={() =>
                  setPattern((prev) => {
                    const newPattern = { ...prev };
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

const blankPattern = (): Pattern => {
  const beats = 4;
  const stepsPerBeat = 4;
  const steps = beats * stepsPerBeat;
  return {
    name: "Blank",
    clips: [
      {
        name: "Drums",
        channel: 10,
        beats,
        stepsPerBeat,
        lanes: [
          {
            instrument: "kick",
            midiNote: 36,
            // 4 to the floor
            steps: new Map([
              [0, { velocity: 127, lengthInSteps: 1 }],
              [4, { velocity: 127, lengthInSteps: 1 }],
              [8, { velocity: 127, lengthInSteps: 1 }],
              [12, { velocity: 127, lengthInSteps: 1 }],
            ]),
          },
          {
            instrument: "snare",
            midiNote: 37,
            // on the 2 and 4
            steps: new Map([
              [4, { velocity: 127, lengthInSteps: 1 }],
              [12, { velocity: 127, lengthInSteps: 1 }],
            ]),
          },
          {
            instrument: "closed hihat",
            midiNote: 42,
            // on the 16ths
            steps: new Map(
              Array.from({ length: steps }, (_, i) => [
                i,
                { velocity: 127, lengthInSteps: 1 },
              ])
            ),
          },
        ],
      },
    ],
  };
};
