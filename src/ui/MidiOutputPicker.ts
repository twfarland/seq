import type { Process, VNode } from "@nonchalant/core";
import { h2, header, option, p, section, select } from "@nonchalant/dom/tags";
import type { MidiMsg, MidiState } from "~/app/outputs";

/**
 * Permission, the port list, and the choice of output.
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

export function MidiOutputPicker(midi: Process<MidiState, MidiMsg>): VNode {
  return section(
    { class: "panel" },
    header({ class: "panel__header" }, h2({}, "MIDI output")),

    // Reads `status` and the port *count*: appearing and disappearing
    // devices are a structural change, but choosing one is not.
    () => {
      switch (midi().status) {
        case "idle":
          return null;

        case "unsupported":
          return p(
            { class: "notice notice--error" },
            "This browser does not support the Web MIDI API. Chrome, Edge and Opera do; Firefox and Safari currently do not."
          );

        case "denied":
          return p({ class: "notice notice--error" }, () =>
            `MIDI access was refused: ${midi().message}`
          );

        case "ready":
          return midi().outputs.length > 0
            ? OutputSelect(midi)
            : p(
                { class: "notice" },
                "No MIDI outputs found. Connect a device or start a virtual port, then reload."
              );
      }
    }
  );
}
