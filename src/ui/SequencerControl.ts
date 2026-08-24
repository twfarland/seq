import type { Process, VNode } from "@nonchalant/core";
import { button, div, header, section } from "@nonchalant/dom/tags";
import type { MidiMsg, MidiState } from "~/app/outputs";
import { BPM_RANGE, MIDI_CLOCK_PPQ, PPQ_RANGE } from "~/domain/pattern";
import { DEFAULT_VELOCITY } from "~/domain/presets";
import type { Session } from "~/app/session";
import { ClipEditor } from "./ClipEditor";
import type { Editor } from "./context";
import { NumberField, TextField } from "./Fields";

/**
 * The transport and the pattern.
 *
 * Nothing here holds state. The pattern lives in the worker, so every edit is a
 * `cast` and every displayed value is a binding on what comes back; the
 * transport buttons follow the worker's own `running` flag rather than a local
 * guess about whether the last command took effect.
 */

function Transport(session: Session, midi: Process<MidiState, MidiMsg>): VNode {
  const seq = session.sequencer;
  const running = () => seq()?.running === true;
  const ppq = () => seq()?.ppq ?? MIDI_CLOCK_PPQ;

  return section(
    { class: "panel transport" },
    NumberField({
      label: "BPM",
      value: () => seq()?.bpm ?? 120,
      min: BPM_RANGE.min,
      max: BPM_RANGE.max,
      onChange: (bpm) => seq.cast({ type: "set_bpm", bpm }),
    }),
    NumberField({
      label: "PPQ",
      value: ppq,
      min: PPQ_RANGE.min,
      max: PPQ_RANGE.max,
      title: `Clock resolution. External gear expects ${MIDI_CLOCK_PPQ}; other values still drive this app but desync anything syncing to our MIDI clock.`,
      suffix: () => (ppq() === MIDI_CLOCK_PPQ ? "" : "non-standard"),
      onChange: (value) => seq.cast({ type: "set_ppq", ppq: value }),
    }),

    button(
      {
        type: "button",
        class: "button button--primary",
        disabled: running,
        onclick: () => seq.cast({ type: "start" }),
      },
      "Start"
    ),
    button(
      {
        type: "button",
        class: "button",
        disabled: () => !running(),
        onclick: () => seq.cast({ type: "stop" }),
      },
      "Stop"
    ),
    button(
      {
        type: "button",
        class: "button button--ghost",
        title: "Send All Notes Off on every channel",
        onclick: () => {
          seq.cast({ type: "panic" });
          // Notes auditioned by press-and-hold are not known to the engine, so
          // the worker's panic alone would not cover them.
          midi().send?.panic();
        },
      },
      "Panic"
    )
  );
}

export function SequencerControl(
  session: Session,
  midi: Process<MidiState, MidiMsg>
): VNode {
  const seq = session.sequencer;

  const editor: Editor = {
    seq,
    playhead: session.playhead,
    audition: (clipIndex, laneIndex, on) => {
      const clip = seq()?.pattern.clips[clipIndex];
      const lane = clip?.lanes[laneIndex];
      const send = midi().send;
      if (!clip || !lane || !send) return;
      const message = { channel: clip.channel, midiNote: lane.midiNote };
      if (on) send.noteOn({ ...message, velocity: DEFAULT_VELOCITY });
      else send.noteOff(message);
    },
  };

  const clipCount = () => seq()?.pattern.clips.length ?? 0;

  return div(
    { class: "sequencer" },
    Transport(session, midi),

    section(
      { class: "panel" },
      header(
        { class: "panel__header" },
        TextField({
          label: "Pattern",
          value: () => seq()?.pattern.name ?? "",
          onChange: (name) => seq.cast({ type: "rename_pattern", name }),
        }),
        button(
          {
            type: "button",
            class: "button",
            onclick: () => seq.cast({ type: "add_clip" }),
          },
          "+ Clip"
        )
      ),

      () =>
        Array.from({ length: clipCount() }, (_, clipIndex) =>
          ClipEditor(editor, clipIndex)
        )
    )
  );
}
