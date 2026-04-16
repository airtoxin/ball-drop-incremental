import * as Tone from "tone";

const chords = [
  ["C", "E", "G"],
  ["A", "C", "E"],
  ["D", "F", "A"],
  ["G", "B", "D"],
];

let chordIndex = 0;
let initialized = false;

const limiter = new Tone.Limiter(-3).toDestination();

const synth = new Tone.PolySynth(Tone.Synth, {
  volume: -8,
  oscillator: { type: "triangle8" },
  envelope: {
    attack: 0.001,
    decay: 0.1,
    sustain: 0.01,
    release: 0.1,
  },
}).connect(limiter);

const kick = new Tone.MembraneSynth({ volume: -4 }).connect(limiter);
const hihat = new Tone.PluckSynth({ volume: -10 }).connect(limiter);

function generateRandomNote(): string {
  const keys = chords[chordIndex];
  const key = keys[Math.floor(Math.random() * keys.length)];
  const octave = 4 + Math.floor(Math.random() * 3);
  return `${key}${octave}`;
}

const durations = ["2n", "4n", "8n", "16n"] as const;

function randomDuration(): string {
  return durations[Math.floor(Math.random() * durations.length)];
}

export function getDuration(): string {
  return randomDuration();
}

export function play(duration: string, velocity: number): void {
  if (!initialized) return;
  const note = generateRandomNote();
  Tone.getTransport().schedule((time) => {
    synth.triggerAttackRelease(note, duration, time, velocity);
  }, Tone.TransportTime("@16n"));
}

export async function initAudio(): Promise<void> {
  if (initialized) return;
  await Tone.start();

  const transport = Tone.getTransport();
  transport.bpm.value = 120;

  new Tone.Loop(() => {
    chordIndex = (chordIndex + 1) % chords.length;
  }, "1m").start(0);

  new Tone.Loop((time) => {
    kick.triggerAttackRelease("C0", "32n", time);
  }, "4n").start(0);

  new Tone.Loop((time) => {
    hihat.triggerAttackRelease("C5", "32n", time);
  }, "4n").start("8n");

  transport.start();
  initialized = true;
}
