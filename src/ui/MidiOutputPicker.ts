import type { Process, VNode } from "@nonchalant/core";
import { button, div, h2, header, option, p, section, select } from "@nonchalant/dom/tags";
import type { MidiMsg, MidiState } from "~/app/outputs";

/**
 * Permission, the port list, and the choice of output.
 *
 * Every status renders something. An earlier version drew nothing at all while
 * the process was deciding, which looked exactly like a broken app on any
 * browser that took its time over the permission prompt - or declined to show
 * one.
 *
 * The `<option>` elements carry their own `selected` binding rather than the
 * `<select>` carrying a `value` one. Attributes are applied before children are
 * appended, so a `value` set on an empty `<select>` would have nothing to
 * match and would simply be dropped.
 */

function OutputSelect(midi: Process<MidiState, MidiMsg>): VNode {
  const label = (output: MidiState["outputs"][number]) =>
    `${output.name || output.id}${
      output.manufacturer ? ` — ${output.manufacturer}` : ""
    }`;

  return select(
    {
      class: "field__input",
      onchange: (event: Event) =>
        midi.cast({
          type: "select",
          id: (event.currentTarget as HTMLSelectElement).value,
        }),
    },
    option(
      { value: "", selected: () => midi().selectedId === "" },
      "Select an output…"
    ),
    () =>
      midi().outputs.map((output) =>
        option(
          {
            key: output.id,
            value: output.id,
            selected: () => midi().selectedId === output.id,
          },
          label(output)
        )
      )
  );
}

/**
 * Nothing to play through. The input list is the diagnosis: an interface with
 * MIDI usually exposes an In and an Out together, so seeing the device's input
 * here means the browser can see the hardware and something else is holding its
 * output - on Windows a MIDI output can only be open in one application at a
 * time. Seeing nothing at all means the browser cannot see the device.
 */
function NoOutputs(midi: Process<MidiState, MidiMsg>): VNode {
  return div(
    { class: "midi-empty" },
    p(
      { class: "notice" },
      "No MIDI outputs found. Connect a device or start a virtual port (loopMIDI on Windows, IAC on macOS), then look again."
    ),
    () => {
      const seen = midi().inputs;
      return seen.length === 0
        ? null
        : p(
            { class: "notice notice--warn" },
            `The browser can see ${seen
              .map((port) => port.name || port.id)
              .join(", ")} as a MIDI input but reports no output. On Windows a MIDI output can only be open in one application at a time - close any DAW or MIDI tool holding it, then look again.`
          );
    },
    button(
      {
        type: "button",
        class: "button",
        onclick: () => midi.cast({ type: "rescan" }),
      },
      "Look again"
    )
  );
}

/**
 * Browsers prompt for MIDI whether or not sysex is asked for, and may suppress
 * a prompt that no interaction asked for. So the asking is a button.
 */
function EnableMidi(midi: Process<MidiState, MidiMsg>): VNode {
  return div(
    { class: "midi-enable" },
    p(
      { class: "notice" },
      "seq needs permission to use your MIDI devices. Your browser will ask once."
    ),
    button(
      {
        type: "button",
        class: "button button--primary",
        onclick: () => midi.cast({ type: "request" }),
      },
      "Enable MIDI"
    )
  );
}

export function MidiOutputPicker(midi: Process<MidiState, MidiMsg>): VNode {
  return section(
    { class: "panel" },
    header({ class: "panel__header" }, h2({}, "MIDI output")),

    // Reads `status` and the port *count*: devices appearing and disappearing
    // is a structural change, but choosing one is not.
    () => {
      switch (midi().status) {
        case "idle":
          return p({ class: "notice" }, "Looking for MIDI support…");

        case "unsupported":
          return p(
            { class: "notice notice--error" },
            "This browser does not support the Web MIDI API. Chrome, Edge and Opera do; Firefox and Safari currently do not."
          );

        case "prompt":
          return EnableMidi(midi);

        case "asking":
          return p(
            { class: "notice" },
            "Waiting for permission. Answer the browser's prompt to continue - if none appeared, check for a blocked-permission icon in the address bar."
          );

        case "denied":
          return div(
            { class: "midi-enable" },
            p({ class: "notice notice--error" }, () =>
              `MIDI access was refused: ${midi().message}`
            ),
            button(
              {
                type: "button",
                class: "button",
                onclick: () => midi.cast({ type: "request" }),
              },
              "Try again"
            )
          );

        case "ready":
          return midi().outputs.length > 0
            ? OutputSelect(midi)
            : NoOutputs(midi);
      }
    }
  );
}
