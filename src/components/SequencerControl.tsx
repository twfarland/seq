import { For, createEffect, createSignal, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  BPM_RANGE,
  MIDI_CLOCK_PPQ,
  PPQ_RANGE,
  type Pattern,
} from "~/sequencer/pattern";
import { MidiSend } from "~/sequencer/midi";
import { DEFAULT_VELOCITY, emptyClip, emptyLane, fourOnTheFloor, makeStep } from "~/sequencer/patterns";
import { createSequencerPort } from "~/sequencer/port";
import { ClipEditor } from "./ClipEditor";
import { NumberField, TextField } from "./Fields";

export interface SequencerControlProps {
  midiOutput: MIDIOutput;
}

export function SequencerControl(props: SequencerControlProps) {
  // Read once: the parent mounts this component `keyed` on the output, so a
  // different device produces a fresh component rather than a mutated one.
  const midiSend = new MidiSend(props.midiOutput);
  const port = createSequencerPort(midiSend);

  const [bpm, setBpm] = createSignal(120);
  const [ppq, setPpq] = createSignal(MIDI_CLOCK_PPQ);
  const [pattern, setPattern] = createStore<Pattern>(fourOnTheFloor());

  createEffect(() => port.send({ type: "set_bpm", bpm: bpm() }));
  createEffect(() => port.send({ type: "set_ppq", ppq: ppq() }));

  createEffect(() => {
    // The JSON round-trip does double duty: reading every property deep-tracks
    // the store (so any nested edit re-runs this effect), and the result is
    // already the plain, structured-cloneable object postMessage needs - a
    // store proxy would otherwise be cloned property-by-property anyway.
    const snapshot = JSON.parse(JSON.stringify(pattern)) as Pattern;
    port.send({ type: "set_pattern", pattern: snapshot });
  });

  onCleanup(() => {
    // Notes auditioned by press-and-hold are not tracked by the engine, so the
    // port's own panic on teardown would not cover them.
    midiSend.panic();
  });

  const auditionLane = (clipIndex: number, laneIndex: number, on: boolean) => {
    const clip = pattern.clips[clipIndex];
    const lane = clip?.lanes[laneIndex];
    if (!clip || !lane) return;
    const message = { channel: clip.channel, midiNote: lane.midiNote };
    if (on) midiSend.noteOn({ ...message, velocity: DEFAULT_VELOCITY });
    else midiSend.noteOff(message);
  };

  const toggleStep = (
    clipIndex: number,
    laneIndex: number,
    stepIndex: number
  ) =>
    setPattern(
      "clips",
      clipIndex,
      "lanes",
      laneIndex,
      "steps",
      produce((steps) => {
        // Sparse map: deleting is what makes a step a rest.
        if (steps[stepIndex]) delete steps[stepIndex];
        else steps[stepIndex] = makeStep();
      })
    );

  return (
    <div class="sequencer">
      <section class="panel transport">
        <NumberField
          label="BPM"
          value={bpm()}
          min={BPM_RANGE.min}
          max={BPM_RANGE.max}
          onChange={setBpm}
        />
        <NumberField
          label="PPQ"
          value={ppq()}
          min={PPQ_RANGE.min}
          max={PPQ_RANGE.max}
          title={`Clock resolution. External gear expects ${MIDI_CLOCK_PPQ}; other values still drive this app but desync anything syncing to our MIDI clock.`}
          suffix={ppq() === MIDI_CLOCK_PPQ ? "" : "non-standard"}
          onChange={setPpq}
        />

        <button
          type="button"
          class="button button--primary"
          disabled={port.isRunning()}
          onClick={() => port.send({ type: "start" })}
        >
          Start
        </button>
        <button
          type="button"
          class="button"
          disabled={!port.isRunning()}
          onClick={() => port.send({ type: "stop" })}
        >
          Stop
        </button>
        <button
          type="button"
          class="button button--ghost"
          title="Send All Notes Off on every channel"
          onClick={() => {
            port.send({ type: "panic" });
            midiSend.panic();
          }}
        >
          Panic
        </button>
      </section>

      <section class="panel">
        <header class="panel__header">
          <TextField
            label="Pattern"
            value={pattern.name}
            onChange={(name) => setPattern("name", name)}
          />
          <button
            type="button"
            class="button"
            onClick={() =>
              setPattern(
                "clips",
                produce((clips) => {
                  clips.push(emptyClip(`Clip ${clips.length + 1}`, 1));
                })
              )
            }
          >
            + Clip
          </button>
        </header>

        <For each={pattern.clips}>
          {(clip, clipIndex) => (
            <ClipEditor
              clip={clip}
              ppq={ppq()}
              playheadStep={
                port.isRunning() ? port.playhead[clipIndex()] : undefined
              }
              onUpdate={(patch) => setPattern("clips", clipIndex(), patch)}
              onUpdateLane={(laneIndex, patch) =>
                setPattern("clips", clipIndex(), "lanes", laneIndex, patch)
              }
              onToggleStep={(laneIndex, stepIndex) =>
                toggleStep(clipIndex(), laneIndex, stepIndex)
              }
              onAuditionLane={(laneIndex, on) =>
                auditionLane(clipIndex(), laneIndex, on)
              }
              onAddLane={() =>
                setPattern(
                  "clips",
                  clipIndex(),
                  "lanes",
                  produce((lanes) => {
                    lanes.push(emptyLane());
                  })
                )
              }
              onRemoveLane={(laneIndex) =>
                setPattern(
                  "clips",
                  clipIndex(),
                  "lanes",
                  produce((lanes) => {
                    lanes.splice(laneIndex, 1);
                  })
                )
              }
              onRemove={() =>
                setPattern(
                  "clips",
                  produce((clips) => {
                    clips.splice(clipIndex(), 1);
                  })
                )
              }
            />
          )}
        </For>
      </section>
    </div>
  );
}
