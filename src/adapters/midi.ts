import type {
  MidiDirectory,
  MidiOut,
  MidiPorts,
  NoteOffMessage,
  NoteOnMessage,
  OutputInfo,
} from "~/app/ports";

/**
 * Web MIDI, behind the ports in `app/ports.ts`.
 *
 * {@link MidiSend} is a thin, validating wrapper over a `MIDIOutput`.
 *
 * Every method clamps its arguments before packing them into status bytes. Web
 * MIDI throws `TypeError` on out-of-range data, which inside the message pump
 * would tear down the whole transport - so an out-of-range channel yields a
 * wrong-but-playing note rather than a dead sequencer.
 */

/** MIDI System Real-Time messages. */
const CLOCK = 0xf8;
const START = 0xfa;
const CONTINUE = 0xfb;
const STOP = 0xfc;

/** Channel Voice status nibbles, OR-ed with a 0-based channel. */
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;

/** Channel Mode messages sent as CC numbers. */
const CC_ALL_SOUND_OFF = 120;
const CC_ALL_NOTES_OFF = 123;

const clampByte = (value: number, max: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value)));
};

/** Convert a 1-based channel (1..16) into its 0-based wire nibble. */
const channelNibble = (channel: number) =>
  clampByte((Number.isFinite(channel) ? channel : 1) - 1, 15);

export class MidiSend implements MidiOut {
  constructor(private readonly output: MIDIOutput) {}

  /**
   * Timestamps are document-clock milliseconds (`performance.now()`), matching
   * what `MIDIOutput.send` expects. A time in the past means "send now"; a time
   * in the future is delivered by the browser with sub-millisecond accuracy,
   * which is why the sequencer schedules ahead rather than firing on the beat.
   */
  private send(data: number[], time?: number) {
    this.output.send(data, time);
  }

  /** MIDI clock pulse - 24 per quarter note, per the MIDI spec. */
  clock(time?: number) {
    this.send([CLOCK], time);
  }

  start(time?: number) {
    this.send([START], time);
  }

  continue_(time?: number) {
    this.send([CONTINUE], time);
  }

  stop(time?: number) {
    this.send([STOP], time);
  }

  noteOn({ channel, midiNote, velocity, time }: NoteOnMessage) {
    this.send(
      [
        NOTE_ON | channelNibble(channel),
        clampByte(midiNote, 127),
        clampByte(velocity, 127),
      ],
      time
    );
  }

  noteOff({ channel, midiNote, time }: NoteOffMessage) {
    // Velocity 0 is the conventional release velocity and is what most gear
    // expects; some devices only recognise note-on-with-velocity-0 instead.
    this.send([NOTE_OFF | channelNibble(channel), clampByte(midiNote, 127), 0], time);
  }

  /** Silence one channel. */
  allNotesOff(channel: number, time?: number) {
    const status = CONTROL_CHANGE | channelNibble(channel);
    this.send([status, CC_ALL_NOTES_OFF, 0], time);
    this.send([status, CC_ALL_SOUND_OFF, 0], time);
  }

  /**
   * Last-resort silence: All Notes Off on all sixteen channels. Cheap enough to
   * fire on teardown, and the only reliable cure for a note stuck by a crash.
   */
  panic(time?: number) {
    for (let channel = 1; channel <= 16; channel++) {
      this.allNotesOff(channel, time);
    }
  }
}

/** How a `MIDIOutput` describes itself to whoever is choosing between them. */
const describe = (output: MIDIPort): OutputInfo => ({
  id: output.id,
  name: output.name ?? "",
  manufacturer: output.manufacturer ?? "",
});

/**
 * Ports are keyed by `MIDIPort.id`, not by name: names are not unique (two of
 * the same interface report identically) and can be empty on some drivers.
 */
export function midiDirectory(access: MIDIAccess): MidiDirectory {
  return {
    list: () => Array.from(access.outputs.values(), describe),
    inputs: () => Array.from(access.inputs.values(), describe),
    open: (id) => {
      const output = access.outputs.get(id);
      return output ? new MidiSend(output) : undefined;
    },
    onChange: (fn) => {
      access.addEventListener("statechange", fn);
      return () => access.removeEventListener("statechange", fn);
    },
  };
}

export const webMidi: MidiPorts = {
  available: () => typeof navigator.requestMIDIAccess === "function",

  /**
   * Chrome answers this without prompting; other browsers throw on an unknown
   * permission name, and Firefox and Safari have no MIDI at all. Anything we
   * cannot establish is reported as "prompt", which is the answer that puts a
   * person in charge of asking.
   */
  permission: async () => {
    try {
      const status = await navigator.permissions?.query({
        name: "midi" as PermissionName,
      });
      return status?.state ?? "prompt";
    } catch {
      return "prompt";
    }
  },

  // `sysex` is deliberately not requested - for least privilege, not for a
  // quieter prompt. Chrome asks for permission either way, which is what the
  // console notice ("Web MIDI will ask a permission to use even if the sysex
  // is not specified in the MIDIOptions since around M82") is telling you.
  // That notice cannot be silenced by anything except asking for *more*
  // access, so it stays. This app only ever sends channel-voice and real-time
  // messages; sysex would hand it a device's firmware as well.
  open: () => navigator.requestMIDIAccess().then(midiDirectory),
};
