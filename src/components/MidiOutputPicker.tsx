import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";

type Status =
  | { kind: "idle" }
  | { kind: "unsupported" }
  | { kind: "denied"; message: string }
  | { kind: "ready" };

export interface MidiOutputPickerProps {
  /** Rendered only once an output is chosen, keyed so it remounts on change. */
  children: (output: MIDIOutput) => JSX.Element;
}

/**
 * Requests Web MIDI access and lets the user pick an output port.
 *
 * Ports are keyed by `MIDIPort.id`, not by name: names are not unique (two of
 * the same interface report identically) and can be empty on some drivers.
 */
export function MidiOutputPicker(props: MidiOutputPickerProps) {
  const [status, setStatus] = createSignal<Status>({ kind: "idle" });
  const [outputs, setOutputs] = createSignal<MIDIOutput[]>([]);
  const [selectedId, setSelectedId] = createSignal("");

  const selected = () => outputs().find((output) => output.id === selectedId());

  onMount(() => {
    if (typeof navigator.requestMIDIAccess !== "function") {
      setStatus({ kind: "unsupported" });
      return;
    }

    let access: MIDIAccess | undefined;

    // `sysex` is deliberately not requested: it triggers a stricter permission
    // prompt and this app only ever sends channel-voice and real-time messages.
    navigator.requestMIDIAccess().then(
      (granted) => {
        access = granted;
        const refresh = () => {
          const ports = Array.from(granted.outputs.values());
          setOutputs(ports);
          // A port can disappear while selected (cable pulled, app closed).
          // Drop the selection so the render prop unmounts and the sequencer
          // stops writing to a dead port.
          if (!ports.some((port) => port.id === selectedId())) setSelectedId("");
        };
        granted.addEventListener("statechange", refresh);
        refresh();
        setStatus({ kind: "ready" });
      },
      (error: unknown) => {
        setStatus({
          kind: "denied",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    );

    onCleanup(() => {
      // MIDIAccess has no removeAllListeners; dropping the reference is enough
      // once the component is gone, but clear it explicitly for clarity.
      access = undefined;
      void access;
    });
  });

  return (
    <section class="panel">
      <header class="panel__header">
        <h2>MIDI output</h2>
      </header>

      <Switch>
        <Match when={status().kind === "unsupported"}>
          <p class="notice notice--error">
            This browser does not support the Web MIDI API. Chrome, Edge and
            Opera do; Firefox and Safari currently do not.
          </p>
        </Match>

        <Match when={status().kind === "denied"}>
          <p class="notice notice--error">
            MIDI access was refused:{" "}
            {(status() as Extract<Status, { kind: "denied" }>).message}
          </p>
        </Match>

        <Match when={status().kind === "ready"}>
          <Show
            when={outputs().length > 0}
            fallback={
              <p class="notice">
                No MIDI outputs found. Connect a device or start a virtual port,
                then reload.
              </p>
            }
          >
            <select
              class="field__input"
              value={selectedId()}
              onChange={(event) => setSelectedId(event.currentTarget.value)}
            >
              <option value="">Select an output…</option>
              <For each={outputs()}>
                {(output) => (
                  <option value={output.id}>
                    {output.name || output.id}
                    {output.manufacturer ? ` — ${output.manufacturer}` : ""}
                  </option>
                )}
              </For>
            </select>
          </Show>
        </Match>
      </Switch>

      {/* `keyed` matters: switching output must tear down the old sequencer
          port (terminating its worker and silencing its notes) rather than
          quietly re-pointing it at different hardware. */}
      <Show when={selected()} keyed>
        {props.children}
      </Show>
    </section>
  );
}
