/**
 * The Studio's voice.
 *
 * Every sound here is synthesized at runtime — there are no audio assets to ship, license, or
 * keep in sync with a build. That constraint is also what makes the palette coherent: each voice
 * is drawn from one A-minor pentatonic set, so no two sounds can ever clash no matter how fast a
 * user works.
 *
 * Levels are deliberately low. A UI sound that you *notice* is a UI sound you will turn off by
 * the end of the week; these sit just under the threshold of attention and mostly register as
 * the interface feeling physical.
 *
 * Rules the engine enforces so this stays true:
 *   - Nothing plays before a real user gesture (browsers require this anyway; we lean into it).
 *   - Per-voice rate limiting, so holding an arrow key is a texture and not a machine gun.
 *   - Full duck during a render, so an export is silent and the completion chime lands.
 */

import { feelPreferences } from "./preferences";

/** A minor pentatonic — the whole instrument. */
const NOTE = {
  A2: 110.0,
  E3: 164.81,
  A3: 220.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
} as const;

export type SoundVoice =
  /** Generic affirmative press. */
  | "tap"
  /** Something became selected. */
  | "select"
  /** A frame step, a snap, a magnetic detent. */
  | "detent"
  /** A panel or drawer opening. */
  | "open"
  /** A panel or drawer closing. */
  | "close"
  /** An edit was written to source. */
  | "commit"
  /** A render or bake finished. */
  | "chime"
  /** Something went wrong. */
  | "alert"
  /** Transport started. */
  | "play"
  /** Transport stopped. */
  | "pause"
  /** The Studio finished booting. */
  | "boot";

type VoiceOptions = {
  /** 0–1 position used by pitched voices (the scrub detent maps playhead position to pitch). */
  position?: number;
  /** Extra attenuation for this one call. */
  gain?: number;
};

/** Minimum milliseconds between two firings of the same voice. */
const RATE_LIMIT_MS: Record<SoundVoice, number> = {
  tap: 40,
  select: 50,
  detent: 28,
  open: 90,
  close: 90,
  commit: 120,
  chime: 400,
  alert: 300,
  play: 80,
  pause: 80,
  boot: 4000,
};

export class StudioSound {
  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  #delaySend: GainNode | null = null;
  #unlocked = false;
  #ducked = false;
  #noiseBuffer: AudioBuffer | null = null;
  readonly #lastPlayed = new Map<SoundVoice, number>();
  readonly #preferences = feelPreferences();
  #disposed = false;

  /**
   * Arm the engine. Audio hardware is not touched until the user's first real gesture, which is
   * both the browser's rule and the polite one.
   */
  unlock(): void {
    if (this.#unlocked || this.#disposed || typeof window === "undefined") return;
    this.#unlocked = true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const context = new Ctor({ latencyHint: "interactive" });
      const master = context.createGain();
      master.gain.value = 0;

      // A gentle limiter. UI sound should never be the loudest thing on a user's machine.
      const safety = context.createDynamicsCompressor();
      safety.threshold.value = -18;
      safety.knee.value = 12;
      safety.ratio.value = 8;
      safety.attack.value = 0.003;
      safety.release.value = 0.15;

      // A short feedback delay stands in for a reverb: it costs nothing, needs no impulse
      // response file, and gives every voice a little room to decay into.
      const delay = context.createDelay(0.5);
      delay.delayTime.value = 0.11;
      const feedback = context.createGain();
      feedback.gain.value = 0.22;
      const damp = context.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 2400;
      const send = context.createGain();
      send.gain.value = 1;

      send.connect(delay);
      delay.connect(damp);
      damp.connect(feedback);
      feedback.connect(delay);
      damp.connect(master);

      master.connect(safety);
      safety.connect(context.destination);

      this.#context = context;
      this.#master = master;
      this.#delaySend = send;
      this.#applyLevel(0);
      void context.resume().catch(() => undefined);
    } catch {
      this.#context = null;
    }
  }

  /** Silence everything while a render runs, so the export is clean and the chime lands. */
  setDucked(ducked: boolean): void {
    if (this.#ducked === ducked) return;
    this.#ducked = ducked;
    this.#applyLevel(0.12);
  }

  play(voice: SoundVoice, options: VoiceOptions = {}): void {
    if (this.#disposed) return;
    const preferences = this.#preferences.get();
    if (!preferences.sound) return;
    this.unlock();
    const context = this.#context;
    const master = this.#master;
    if (!context || !master) return;
    if (context.state === "suspended") void context.resume().catch(() => undefined);

    const now = context.currentTime;
    const wallClock = now * 1000;
    const last = this.#lastPlayed.get(voice) ?? -Infinity;
    if (wallClock - last < RATE_LIMIT_MS[voice]) return;
    this.#lastPlayed.set(voice, wallClock);

    this.#applyLevel(0.05);
    const level = options.gain ?? 1;

    switch (voice) {
      case "tap":
        // A soft mallet. Detuned a few cents per press so repeated taps never sound looped.
        this.#pluck(now, NOTE.E5 * (1 + (Math.random() - 0.5) * 0.01), { peak: 0.05 * level, decay: 0.1, type: "triangle" });
        this.#transient(now, 0.02 * level, 3200);
        break;
      case "select":
        // Root then a minor third above: the sound of something snapping into focus.
        this.#pluck(now, NOTE.A4, { peak: 0.045 * level, decay: 0.16, type: "sine" });
        this.#pluck(now + 0.045, NOTE.C5, { peak: 0.038 * level, decay: 0.2, type: "sine" });
        break;
      case "detent": {
        // The workhorse: every frame step, every snap. Pitch rides the playhead so scrubbing a
        // timeline has a shape you can hear.
        const position = Math.min(1, Math.max(0, options.position ?? 0.5));
        this.#transient(now, 0.028 * level, 1500 + position * 2600, 0.012);
        break;
      }
      case "open":
        this.#sweep(now, { from: 380, to: 2900, duration: 0.19, peak: 0.03 * level });
        break;
      case "close":
        this.#sweep(now, { from: 2600, to: 320, duration: 0.16, peak: 0.026 * level });
        break;
      case "commit":
        // A minor triad, arpeggiated fast enough to read as one warm event.
        this.#pluck(now, NOTE.A4, { peak: 0.04 * level, decay: 0.26, type: "sine" });
        this.#pluck(now + 0.03, NOTE.C5, { peak: 0.034 * level, decay: 0.28, type: "sine" });
        this.#pluck(now + 0.06, NOTE.E5, { peak: 0.03 * level, decay: 0.34, type: "sine" });
        break;
      case "chime":
        // Reserved for finished work. The only voice allowed to be genuinely pretty.
        this.#pluck(now, NOTE.A4, { peak: 0.05 * level, decay: 0.5, type: "sine", send: 0.5 });
        this.#pluck(now + 0.09, NOTE.C5, { peak: 0.048 * level, decay: 0.55, type: "sine", send: 0.5 });
        this.#pluck(now + 0.18, NOTE.E5, { peak: 0.046 * level, decay: 0.7, type: "sine", send: 0.6 });
        this.#pluck(now + 0.27, NOTE.A5, { peak: 0.042 * level, decay: 0.9, type: "sine", send: 0.7 });
        break;
      case "alert":
        // Falling, never harsh. A problem is information, not a punishment.
        this.#pluck(now, NOTE.E4, { peak: 0.045 * level, decay: 0.2, type: "triangle" });
        this.#pluck(now + 0.09, NOTE.C4, { peak: 0.04 * level, decay: 0.34, type: "triangle" });
        break;
      case "play":
        this.#pluck(now, NOTE.D5, { peak: 0.036 * level, decay: 0.13, type: "sine" });
        this.#transient(now, 0.018 * level, 2600);
        break;
      case "pause":
        this.#pluck(now, NOTE.G4, { peak: 0.034 * level, decay: 0.15, type: "sine" });
        break;
      case "boot":
        this.#bootChord(now, level);
        break;
    }
  }

  dispose(): void {
    this.#disposed = true;
    const context = this.#context;
    this.#context = null;
    this.#master = null;
    this.#delaySend = null;
    void context?.close().catch(() => undefined);
  }

  /** Ramp the master toward the level the current preferences and duck state imply. */
  #applyLevel(rampSeconds: number): void {
    const context = this.#context;
    const master = this.#master;
    if (!context || !master) return;
    const preferences = this.#preferences.get();
    const target = this.#ducked || !preferences.sound ? 0 : preferences.volume;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    if (rampSeconds <= 0) master.gain.setValueAtTime(target, now);
    else master.gain.linearRampToValueAtTime(target, now + rampSeconds);
  }

  /** One decaying pitched note. */
  #pluck(
    at: number,
    frequency: number,
    { peak, decay, type, send = 0.25 }: { peak: number; decay: number; type: OscillatorType; send?: number },
  ): void {
    const context = this.#context;
    const master = this.#master;
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(peak, at + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + decay);

    // Rolling off the top keeps sines from sounding like a hold-music synth.
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.setValueAtTime(Math.min(9000, frequency * 6), at);

    oscillator.connect(envelope);
    envelope.connect(tone);
    tone.connect(master);
    if (this.#delaySend && send > 0) {
      const sendGain = context.createGain();
      sendGain.gain.value = send * peak * 3;
      tone.connect(sendGain);
      sendGain.connect(this.#delaySend);
    }

    oscillator.start(at);
    oscillator.stop(at + decay + 0.05);
  }

  /** A band-passed noise click — the physical part of a press or a snap. */
  #transient(at: number, peak: number, frequency: number, duration = 0.03): void {
    const context = this.#context;
    const master = this.#master;
    if (!context || !master) return;
    const source = context.createBufferSource();
    source.buffer = this.#noise(context);

    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(frequency, at);
    band.Q.value = 1.6;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(peak, at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    source.connect(band);
    band.connect(envelope);
    envelope.connect(master);
    source.start(at);
    source.stop(at + duration + 0.02);
  }

  /** Filtered noise with a moving cutoff — a panel's worth of air. */
  #sweep(at: number, { from, to, duration, peak }: { from: number; to: number; duration: number; peak: number }): void {
    const context = this.#context;
    const master = this.#master;
    if (!context || !master) return;
    const source = context.createBufferSource();
    source.buffer = this.#noise(context);

    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), at + duration);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(peak, at + duration * 0.28);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    source.start(at);
    source.stop(at + duration + 0.05);
  }

  /** The Studio waking up: a wide, slow A-minor pad that arrives and gets out of the way. */
  #bootChord(at: number, level: number): void {
    const context = this.#context;
    const master = this.#master;
    if (!context || !master) return;
    const voices = [NOTE.A2, NOTE.E3, NOTE.A3, NOTE.C4, NOTE.E4];
    const bus = context.createGain();
    bus.gain.setValueAtTime(0, at);
    bus.gain.linearRampToValueAtTime(0.05 * level, at + 0.9);
    bus.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);

    const shape = context.createBiquadFilter();
    shape.type = "lowpass";
    shape.frequency.setValueAtTime(300, at);
    shape.frequency.exponentialRampToValueAtTime(2200, at + 1.3);

    bus.connect(shape);
    shape.connect(master);
    if (this.#delaySend) {
      const sendGain = context.createGain();
      sendGain.gain.value = 0.4;
      shape.connect(sendGain);
      sendGain.connect(this.#delaySend);
    }

    voices.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, at);
      // A few cents of drift per voice keeps the chord from sounding synthetic.
      oscillator.detune.setValueAtTime((index - 2) * 4, at);
      const voiceGain = context.createGain();
      voiceGain.gain.value = 1 / (index + 1.6);
      oscillator.connect(voiceGain);
      voiceGain.connect(bus);
      oscillator.start(at);
      oscillator.stop(at + 2.8);
    });

    // A single high note at the end: the studio saying it is ready.
    this.#pluck(at + 1.05, NOTE.E5, { peak: 0.03 * level, decay: 1.1, type: "sine", send: 0.8 });
  }

  /** One second of white noise, generated once and reused by every noise-based voice. */
  #noise(context: AudioContext): AudioBuffer {
    if (this.#noiseBuffer) return this.#noiseBuffer;
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) channel[index] = Math.random() * 2 - 1;
    this.#noiseBuffer = buffer;
    return buffer;
  }
}

let singleton: StudioSound | null = null;

export function studioSound(): StudioSound {
  return (singleton ??= new StudioSound());
}
