import { createSignal, For, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";

export function MidiManager({
  children,
}: {
  children: (midiOutput: MIDIOutput) => JSX.Element;
}) {
  const [midiOutputs, setMidiOutputs] = createSignal<MIDIOutputMap>(new Map());
  const [selectedOutputName, setSelectedOutputName] = createSignal<
    string | undefined
  >();
  const selectedOutput = () => {
    const name = selectedOutputName();
    return name ? midiOutputs().get(name) : undefined;
  };

  onMount(() => {
    navigator.requestMIDIAccess({ sysex: true }).then((midiAccess) => {
      setMidiOutputs(midiAccess.outputs);
    });
  });

  return (
    <div>
      <h1>Midi</h1>

      <div>
        <select
          onChange={(e) => {
            setSelectedOutputName(e.currentTarget.value);
          }}
        >
          <option value="">Select MIDI Output</option>
          <For each={Array.from(midiOutputs().keys())}>
            {(name) => (
              <option value={name}>{midiOutputs().get(name)!.name}</option>
            )}
          </For>
        </select>
      </div>

      <Show when={selectedOutput()} keyed>
        {children}
      </Show>
    </div>
  );
}
