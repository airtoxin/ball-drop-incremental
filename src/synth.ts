import * as Tone from "tone";

const chords = [
  // Section A: 明るく穏やかな導入
  ["C", "E", "G"], // C
  ["G", "B", "D"], // G
  ["A", "C", "E"], // Am
  ["E", "G", "B"], // Em
  ["F", "A", "C"], // F
  ["C", "E", "G"], // C
  ["D", "F", "A"], // Dm
  ["G", "B", "D"], // G

  // Section B: 少し切ない展開
  ["A", "C", "E"], // Am
  ["E", "G", "B"], // Em
  ["F", "A", "C"], // F
  ["G", "B", "D"], // G
  ["C", "E", "G"], // C
  ["A", "C", "E"], // Am
  ["D", "F", "A"], // Dm
  ["G", "B", "D"], // G

  // Section C: 浮遊感のあるブリッジ
  ["F", "A", "C"], // F
  ["F", "Ab", "C"], // Fm (借用和音)
  ["C", "E", "G"], // C
  ["E", "G#", "B"], // E (セカンダリードミナント)
  ["A", "C", "E"], // Am
  ["D", "F#", "A"], // D (セカンダリードミナント)
  ["G", "B", "D"], // G
  ["G", "B", "D"], // G (サスペンス)

  // Section D: 壮大なクライマックスと解決
  ["F", "A", "C"], // F
  ["G", "B", "D"], // G
  ["E", "G#", "B"], // E
  ["A", "C", "E"], // Am
  ["F", "A", "C"], // F
  ["D", "F", "A"], // Dm
  ["G", "B", "D"], // G
  ["C", "E", "G"], // C (解決)
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

const purchaseSynth = new Tone.PolySynth(Tone.Synth, {
  volume: -6,
  oscillator: { type: "triangle" },
  envelope: {
    attack: 0.001,
    decay: 0.12,
    sustain: 0,
    release: 0.18,
  },
}).connect(limiter);

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

export function setKickVolume(db: number): void {
  kick.volume.value = db;
}

export function setHihatVolume(db: number): void {
  hihat.volume.value = db;
}

export function setSynthVolume(db: number): void {
  synth.volume.value = db;
}

export function setPurchaseVolume(db: number): void {
  purchaseSynth.volume.value = db;
}

export function playPurchase(): void {
  if (!initialized) return;
  const now = Tone.now();
  const notes = ["C6", "E6", "G6", "C7"];
  notes.forEach((note, i) => {
    purchaseSynth.triggerAttackRelease(note, "16n", now + i * 0.04, 0.7);
  });
}

export async function initAudio(): Promise<void> {
  if (initialized) return;
  await Tone.start();

  const transport = Tone.getTransport();
  transport.bpm.value = 120;

  new Tone.Loop(() => {
    chordIndex = (chordIndex + 1) % chords.length;
  }, "2m").start(0);

  new Tone.Loop((time) => {
    kick.triggerAttackRelease("C0", "32n", time);
  }, "4n").start(0);

  new Tone.Loop((time) => {
    hihat.triggerAttackRelease("C5", "32n", time);
  }, "4n").start("8n");

  transport.start();
  initialized = true;
}
