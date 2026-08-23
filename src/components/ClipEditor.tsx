import { For, Show } from "solid-js";
import {
  clipTimingError,
  stepsPerLoop,
  type Clip,
  type Lane,
} from "~/sequencer/pattern";
import { NumberField, TextField } from "./Fields";
import { LaneEditor } from "./LaneEditor";

export interface ClipEditorProps {
  clip: Clip;
  /** Current clock resolution, needed to validate the clip's subdivision. */
  ppq: number;
  playheadStep: number | undefined;
  onUpdate: (patch: Partial<Omit<Clip, "lanes">>) => void;
  onUpdateLane: (laneIndex: number, patch: Partial<Omit<Lane, "steps">>) => void;
  onToggleStep: (laneIndex: number, stepIndex: number) => void;
  onAuditionLane: (laneIndex: number, on: boolean) => void;
  onAddLane: () => void;
  onRemoveLane: (laneIndex: number) => void;
  onRemove: () => void;
}

export function ClipEditor(props: ClipEditorProps) {
  const stepCount = () => stepsPerLoop(props.clip);
  const timingError = () => clipTimingError(props.clip, props.ppq);

  return (
    <article class="clip">
      <header class="clip__header">
        <TextField
          label="Clip"
          value={props.clip.name}
          onChange={(name) => props.onUpdate({ name })}
        />
        <NumberField
          label="Channel"
          value={props.clip.channel}
          min={1}
          max={16}
          title="1-based MIDI channel. 10 is the General MIDI drum channel."
          onChange={(channel) => props.onUpdate({ channel })}
        />
        <NumberField
          label="Beats"
          value={props.clip.beatsPerMeasure}
          min={1}
          max={32}
          title="Beats per loop"
          onChange={(beatsPerMeasure) => props.onUpdate({ beatsPerMeasure })}
        />
        <NumberField
          label="Subdivision"
          value={props.clip.subdivisionPerBeat}
          min={1}
          max={32}
          title="Steps per beat. Must divide PPQ evenly."
          onChange={(subdivisionPerBeat) =>
            props.onUpdate({ subdivisionPerBeat })
          }
        />
        <span class="clip__meta">{stepCount()} steps</span>
        <button
          type="button"
          class="button button--ghost"
          onClick={props.onRemove}
          aria-label={`Remove clip ${props.clip.name}`}
        >
          ✕
        </button>
      </header>

      {/* Clips loop independently, so an unplayable subdivision silences just
          this clip rather than the whole pattern - worth saying out loud. */}
      <Show when={timingError()}>
        {(message) => <p class="notice notice--warn">{message()}</p>}
      </Show>

      <For each={props.clip.lanes}>
        {(lane, laneIndex) => (
          <LaneEditor
            lane={lane}
            stepCount={stepCount()}
            subdivisionPerBeat={props.clip.subdivisionPerBeat}
            playheadStep={props.playheadStep}
            onRename={(instrument) =>
              props.onUpdateLane(laneIndex(), { instrument })
            }
            onRetune={(midiNote) => props.onUpdateLane(laneIndex(), { midiNote })}
            onToggleStep={(stepIndex) =>
              props.onToggleStep(laneIndex(), stepIndex)
            }
            onAudition={(on) => props.onAuditionLane(laneIndex(), on)}
            onRemove={() => props.onRemoveLane(laneIndex())}
          />
        )}
      </For>

      <button type="button" class="button" onClick={props.onAddLane}>
        + Lane
      </button>
    </article>
  );
}
