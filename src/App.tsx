import { MidiOutputPicker } from "./components/MidiOutputPicker";
import { SequencerControl } from "./components/SequencerControl";

export function App() {
  return (
    <main class="app">
      <h1>seq</h1>
      <p class="app__tagline">A MIDI step sequencer with a worker-driven clock.</p>

      <MidiOutputPicker>
        {(midiOutput) => <SequencerControl midiOutput={midiOutput} />}
      </MidiOutputPicker>
    </main>
  );
}
