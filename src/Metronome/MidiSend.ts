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
    note,
    velocity,
    time,
  }: {
    channel: number;
    note: number;
    velocity: number;
    time: number;
  }) {
    this.midiOutput.send([0x90 + (channel - 1), note, velocity], time);
  }

  noteOff({
    channel,
    note,
    time,
  }: {
    channel: number;
    note: number;
    time: number;
  }) {
    this.midiOutput.send([0x80 + (channel - 1), note, 0x00], time);
  }
}
