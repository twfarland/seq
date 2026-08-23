import { For, Show } from "solid-js";
import type { Lane } from "~/sequencer/pattern";
import { NumberField, TextField } from "./Fields";

export interface LaneEditorProps {
  lane: Lane;
  /** Number of steps in the owning clip's loop. */
  stepCount: number;
  /** Steps per beat, used to accent the downbeat of each beat in the grid. */
  subdivisionPerBeat: number;
  /** Step the clip is currently sounding, or `undefined` when stopped. */
  playheadStep: number | undefined;
  onRename: (instrument: string) => void;
  onRetune: (midiNote: number) => void;
  onToggleStep: (stepIndex: number) => void;
  /** Audition the lane's note. `true` on press, `false` on release. */
  onAudition: (on: boolean) => void;
  onRemove: () => void;
}

export function LaneEditor(props: LaneEditorProps) {
  const stepIndices = () => Array.from({ length: props.stepCount }, (_, i) => i);

  return (
    <div class="lane">
      <div class="lane__controls">
        <TextField
          label="Instrument"
          value={props.lane.instrument}
          onChange={props.onRename}
        />
        <NumberField
          label="Note"
          value={props.lane.midiNote}
          min={0}
          max={127}
          title="MIDI note number (36 = GM kick, 60 = middle C)"
          onChange={props.onRetune}
        />
        <button
          type="button"
          class="button button--audition"
          // Pointer capture keeps the release on this element even if the
          // pointer drifts off it mid-press. Without it, dragging away skips
          // pointerup entirely and the auditioned note sounds forever.
          //
          // It is best-effort: capture throws on a pointer id that is no longer
          // active, and a note that never sounds is worse than one that might
          // need a Panic.
          onPointerDown={(event) => {
            try {
              event.currentTarget.setPointerCapture?.(event.pointerId);
            } catch {
              /* capture unavailable; the plain pointerup path still works */
            }
            props.onAudition(true);
          }}
          onPointerUp={() => props.onAudition(false)}
          onPointerCancel={() => props.onAudition(false)}
        >
          Audition
        </button>
        <button
          type="button"
          class="button button--ghost"
          onClick={props.onRemove}
          aria-label={`Remove lane ${props.lane.instrument}`}
        >
          ✕
        </button>
      </div>

      <div
        class="lane__steps"
        role="group"
        aria-label={`${props.lane.instrument} steps`}
      >
        <For each={stepIndices()}>
          {(stepIndex) => {
            const step = () => props.lane.steps[stepIndex];
            const isBeatStart = () =>
              stepIndex % Math.max(1, props.subdivisionPerBeat) === 0;
            return (
              <button
                type="button"
                class="step"
                classList={{
                  "step--on": step() !== undefined,
                  "step--beat": isBeatStart(),
                  "step--playing": props.playheadStep === stepIndex,
                }}
                aria-pressed={step() !== undefined}
                aria-label={`Step ${stepIndex + 1}`}
                onClick={() => props.onToggleStep(stepIndex)}
              >
                <Show when={step()}>
                  <span class="step__velocity">{step()!.velocity}</span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
