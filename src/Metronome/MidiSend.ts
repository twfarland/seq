export class MidiSend {
  constructor(private midiOutput: MIDIOutput) {}

  tick(time: number) {
    this.midiOutput.send([0xf8], time);
  }

  start() {
    this.midiOutput.send([0xfa]);
  }

  stop() {
    this.midiOutput.send([0xfc]);
  }

  noteOn({
    channel,
    midiNote,
    velocity,
    time,
  }: {
    channel: number;
    midiNote: number;
    velocity: number;
    time: number;
  }) {
    this.midiOutput.send([0x90 + (channel - 1), midiNote, velocity], time);
  }

  noteOff({
    channel,
    midiNote,
    time,
  }: {
    channel: number;
    midiNote: number;
    time: number;
  }) {
    this.midiOutput.send([0x80 + (channel - 1), midiNote, 0x00], time);
  }
}
