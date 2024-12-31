import { createMetronomePort } from "./MetronomePort";
import { createEffect, createSignal, For } from "solid-js";
import { MidiSend } from "./MidiSend";
import { produce } from "immer";

export function MetronomeControl(props: { midiOutput: MIDIOutput }) {
  const midiSend = new MidiSend(props.midiOutput);
  const { input, output } = createMetronomePort(midiSend);
  const [bpm, setBpm] = createSignal(120);
  const [ppq, setPpq] = createSignal(24);
  const [pattern, setPattern] = createSignal(blankPattern()); // TODO more granular reactive/store

  const startSequencer = () => input({ type: "start" });
  const stopSequencer = () => input({ type: "stop" });

  const toggleStep = (
    clipIndex: number,
    laneIndex: number,
    stepIndex: number
  ) => {
    setPattern((prevPattern) =>
      produce(prevPattern, (draft) => {
        const steps = draft.clips[clipIndex].lanes[laneIndex].steps;

        if (steps[stepIndex]) {
          delete steps[stepIndex];
        } else {
          steps[stepIndex] = { velocity: 127, lengthInSteps: 1 };
        }
      })
    );
  };

  createEffect(() => {
    input({ type: "set_bpm", bpm: bpm() });
  });

  createEffect(() => {
    input({ type: "set_ppq", ppq: ppq() });
  });

  createEffect(() => {
    input({ type: "set_pattern", pattern: pattern() });
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
          <For each={Array.from(pattern().clips.entries())}>
            {([clipIndex, clip]) => {
              const {
                name,
                beatsPerMeasure,
                subdivisionPerBeat,
                lanes,
                channel,
              } = clip;
              const clipSteps = beatsPerMeasure * subdivisionPerBeat;

              return (
                <div>
                  <h5>{name}</h5>
                  <label>Channel</label>
                  <input
                    type="number"
                    value={channel}
                    step={1}
                    onChange={(e) => {
                      setPattern((prevPattern) =>
                        produce(prevPattern, (draft) => {
                          draft.clips[clipIndex].channel =
                            +e.currentTarget.value;
                        })
                      );
                    }}
                  />
                  <label>Time Signature:</label>
                  <sub>
                    <input
                      type="number"
                      value={beatsPerMeasure}
                      step={1}
                      onChange={(e) => {
                        setPattern((prevPattern) =>
                          produce(prevPattern, (draft) => {
                            draft.clips[clipIndex].beatsPerMeasure =
                              +e.currentTarget.value;
                          })
                        );
                      }}
                    />
                    /
                    <input
                      type="number"
                      value={subdivisionPerBeat}
                      step={1}
                      onChange={(e) => {
                        setPattern((prevPattern) =>
                          produce(prevPattern, (draft) => {
                            draft.clips[clipIndex].subdivisionPerBeat =
                              +e.currentTarget.value;
                          })
                        );
                      }}
                    />
                  </sub>

                  <For each={Array.from(lanes.entries())}>
                    {([laneIndex, { instrument, midiNote, steps }]) => (
                      <div>
                        <input
                          value={instrument}
                          onChange={(e) => {
                            setPattern((prevPattern) =>
                              produce(prevPattern, (draft) => {
                                draft.clips[clipIndex].lanes[
                                  laneIndex
                                ].instrument = e.currentTarget.value;
                              })
                            );
                          }}
                        />

                        <input
                          type="number"
                          value={midiNote}
                          step={1}
                          onChange={(e) => {
                            setPattern((prevPattern) =>
                              produce(prevPattern, (draft) => {
                                draft.clips[clipIndex].lanes[
                                  laneIndex
                                ].midiNote = +e.currentTarget.value;
                              })
                            );
                          }}
                        />

                        <For
                          each={new Array(clipSteps).fill(0).map((_, i) => i)}
                        >
                          {(
                            stepIndex // @TODO velocity control, not just boolean
                          ) => (
                            <input
                              type="checkbox"
                              checked={steps[stepIndex] !== undefined}
                              onClick={(e) => {
                                e.preventDefault();
                                toggleStep(clipIndex, laneIndex, stepIndex); // TODO: implement as message to worker?
                              }}
                            />
                          )}
                        </For>

                        <MidiNoteTrigger
                          midiNote={midiNote}
                          midiSend={midiSend}
                          channel={channel}
                        />
                      </div>
                    )}
                  </For>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}

function MidiNoteTrigger(props: {
  midiNote: number;
  midiSend: MidiSend;
  channel: number;
}) {
  return (
    <button
      onPointerDown={() => {
        props.midiSend.noteOn({
          channel: props.channel,
          midiNote: props.midiNote,
          velocity: 127,
          time: performance.now() + 100,
        });
      }}
      onPointerUp={() => {
        props.midiSend.noteOff({
          channel: props.channel,
          midiNote: props.midiNote,
          time: performance.now(),
        });
      }}
    >
      Trigger
    </button>
  );
}

const blankPattern = () => {
  const beatsPerMeasure = 4;
  const subdivisionPerBeat = 4;
  const steps = beatsPerMeasure * subdivisionPerBeat;
  return {
    name: "Blank",
    clips: [
      {
        name: "Drums",
        channel: 10,
        beatsPerMeasure,
        subdivisionPerBeat,
        lanes: [
          {
            instrument: "kick",
            midiNote: 36,
            // 4 to the floor
            steps: {
              0: { velocity: 127, lengthInSteps: 1 },
              4: { velocity: 127, lengthInSteps: 1 },
              8: { velocity: 127, lengthInSteps: 1 },
              12: { velocity: 127, lengthInSteps: 1 },
            },
          },
          {
            instrument: "snare",
            midiNote: 37,
            // on the 2 and 4
            steps: {
              4: { velocity: 127, lengthInSteps: 1 },
              12: { velocity: 127, lengthInSteps: 1 },
            },
          },
          {
            instrument: "closed hihat",
            midiNote: 42,
            // on the 16ths
            steps: Object.fromEntries(
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
