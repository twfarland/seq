import { MetronomeControl } from "./Metronome/MetronomeControl";
import { MidiManager } from "./MidiManager";
import "./app.css";

export default function App() {
  return (
    <main>
      <MidiManager>
        {(midiOutput) => <MetronomeControl midiOutput={midiOutput} />}
      </MidiManager>
    </main>
  );
}
