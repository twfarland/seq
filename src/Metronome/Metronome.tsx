import { createSignal, createEffect, Show, onCleanup, on } from "solid-js";

type MetronomeProps = {
  midiOutput: MIDIOutput;
};

export function Metronome({ midiOutput }: MetronomeProps) {
  const [bpm, setBpm] = createSignal(120);
  const [isRunning, setIsRunning] = createSignal(false);
  const [playhead, setPlayhead] = createSignal(0); // Current playhead position in ticks

  let timer: number | null = null;
  const ppq = 24; // Pulses per quarter note
  const tickInterval = () => 60 / bpm() / ppq;

  const startMetronome = () => {
    if (isRunning()) return;

    setIsRunning(true);
    sendStart();

    let nextTickTime = performance.now() / 1000;

    const scheduleTicks = () => {
      if (!isRunning()) return;

      const currentTime = performance.now() / 1000;

      while (nextTickTime < currentTime + 0.1) {
        sendTick(nextTickTime);
        nextTickTime += tickInterval();
        setPlayhead((p) => (p + 1) % (ppq * 4)); // Loop playhead every measure (4/4 time)
      }

      timer = requestAnimationFrame(scheduleTicks);
    };

    scheduleTicks();
  };

  const stopMetronome = () => {
    if (!isRunning()) return;

    setIsRunning(false);
    setPlayhead(0);
    sendStop();
    if (timer) {
      cancelAnimationFrame(timer);
      timer = null;
    }
  };

  const sendTick = (time: number) => {
    midiOutput.send([0xf8], time * 1000); // MIDI Timing Clock message
  };

  const sendStart = () => {
    midiOutput.send([0xfa]); // MIDI Start message
  };

  const sendStop = () => {
    midiOutput.send([0xfc]); // MIDI Stop message
  };

  onCleanup(stopMetronome);

  return (
    <div>
      <h1>Metronome</h1>

      <div>
        <label>BPM:</label>
        <input
          type="number"
          min="30"
          max="300"
          value={bpm()}
          onInput={(e) => setBpm(parseInt(e.currentTarget.value, 10))}
        />
      </div>

      <div>
        <button onClick={startMetronome} disabled={isRunning()}>
          Start
        </button>
        <button onClick={stopMetronome} disabled={!isRunning()}>
          Stop
        </button>
      </div>

      <Show when={isRunning()}>
        <div>
          <p>Running...</p>
          <p>Playhead: {playhead()}</p>
        </div>
      </Show>
    </div>
  );
}
