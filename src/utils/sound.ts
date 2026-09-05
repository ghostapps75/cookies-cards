/**
 * Every sound in the game is synthesised on the fly with the Web Audio API:
 * no audio files to download, no licensing, and the whole engine is a few KB.
 *
 * Card sounds are short bursts of filtered noise (which is genuinely what a
 * riffling card sounds like); the rewards are simple bell tones.
 */

type Ctx = AudioContext & { __noise?: AudioBuffer };

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let enabled = true;

const STORAGE_KEY = 'cookie-solitaire-sound';

try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) enabled = saved === 'on';
} catch {
    /* private browsing: just leave sound on */
}

export const isSoundEnabled = (): boolean => enabled;

export const setSoundEnabled = (on: boolean): void => {
    enabled = on;
    try {
        localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
        /* ignore */
    }
    if (on) void unlockAudio();
};

const getCtx = (): Ctx | null => {
    if (!enabled) return null;
    if (!ctx) {
        const AC =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        ctx = new AC() as Ctx;
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
    }
    return ctx;
};

/** Browsers keep audio suspended until a real gesture, so call this from one. */
export const unlockAudio = async (): Promise<void> => {
    const c = getCtx();
    if (c && c.state === 'suspended') {
        try {
            await c.resume();
        } catch {
            /* ignore */
        }
    }
};

const noiseBuffer = (c: Ctx): AudioBuffer => {
    if (!c.__noise) {
        const length = Math.floor(c.sampleRate * 0.6);
        const buffer = c.createBuffer(1, length, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        c.__noise = buffer;
    }
    return c.__noise;
};

interface NoiseOptions {
    duration: number;
    gain: number;
    type?: BiquadFilterType;
    from: number;
    to?: number;
    q?: number;
    delay?: number;
    attack?: number;
}

const noiseBurst = (o: NoiseOptions): void => {
    const c = getCtx();
    if (!c || !master) return;
    const t = c.currentTime + (o.delay ?? 0);

    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.playbackRate.value = 0.8 + Math.random() * 0.4;

    const filter = c.createBiquadFilter();
    filter.type = o.type ?? 'bandpass';
    filter.Q.value = o.q ?? 1;
    filter.frequency.setValueAtTime(o.from, t);
    if (o.to !== undefined) filter.frequency.exponentialRampToValueAtTime(o.to, t + o.duration);

    const gain = c.createGain();
    const attack = o.attack ?? 0.004;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(o.gain, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.duration);

    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + o.duration + 0.05);
};

interface ToneOptions {
    freq: number;
    duration: number;
    gain: number;
    type?: OscillatorType;
    delay?: number;
    glideTo?: number;
}

const tone = (o: ToneOptions): void => {
    const c = getCtx();
    if (!c || !master) return;
    const t = c.currentTime + (o.delay ?? 0);

    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(o.glideTo, t + o.duration);

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(o.gain, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.duration);

    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + o.duration + 0.05);
};

/** A card is picked up off the felt. */
export const playPickup = (): void => {
    noiseBurst({ duration: 0.06, gain: 0.09, from: 2600, to: 4200, q: 0.9 });
};

/** A card lands on another card. */
export const playPlace = (): void => {
    noiseBurst({ duration: 0.1, gain: 0.16, from: 3200, to: 900, q: 0.7 });
    tone({ freq: 150, glideTo: 78, duration: 0.11, gain: 0.1, type: 'triangle' });
};

/** A card turns over. */
export const playFlip = (): void => {
    noiseBurst({ duration: 0.075, gain: 0.14, from: 1400, to: 3600, q: 1.2, type: 'highpass' });
};

/** One card sliding out of the deck. */
export const playDeal = (delay = 0): void => {
    noiseBurst({ duration: 0.13, gain: 0.11, from: 5200, to: 700, q: 0.6, delay });
};

/** Shuffling a fresh deck. */
export const playShuffle = (): void => {
    for (let i = 0; i < 9; i++) {
        noiseBurst({
            duration: 0.11,
            gain: 0.075,
            from: 2200 + Math.random() * 2600,
            to: 700,
            q: 0.8,
            delay: i * 0.045,
        });
    }
};

/** Turning the waste pile back into the stock. */
export const playRecycle = (): void => {
    noiseBurst({ duration: 0.34, gain: 0.11, from: 500, to: 3400, q: 1.4 });
    tone({ freq: 300, glideTo: 620, duration: 0.3, gain: 0.05, type: 'sine' });
};

/** That move is not allowed. Gentle, never scolding. */
export const playInvalid = (): void => {
    tone({ freq: 208, duration: 0.09, gain: 0.075, type: 'triangle' });
    tone({ freq: 160, duration: 0.13, gain: 0.075, type: 'triangle', delay: 0.085 });
};

// A pentatonic ladder: each card home rings one step brighter than the last.
const LADDER = [
    523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66,
    1318.51, 1567.98, 1760, 2093, 2349.32, 2637.02,
];

/** A card reaches its foundation. `height` is how tall that foundation now is. */
export const playFoundation = (height: number): void => {
    const f = LADDER[Math.min(LADDER.length - 1, Math.max(0, height - 1))];
    tone({ freq: f, duration: 0.5, gain: 0.13, type: 'sine' });
    tone({ freq: f * 2, duration: 0.32, gain: 0.045, type: 'sine' });
    noiseBurst({ duration: 0.07, gain: 0.05, from: 4000, to: 1800, q: 0.9 });
};

/** Taking a move back. */
export const playUndo = (): void => {
    tone({ freq: 660, glideTo: 330, duration: 0.17, gain: 0.09, type: 'triangle' });
    noiseBurst({ duration: 0.12, gain: 0.06, from: 3000, to: 900, q: 0.8 });
};

/** Any toolbar button. */
export const playClick = (): void => {
    noiseBurst({ duration: 0.045, gain: 0.09, from: 2400, q: 1.6 });
    tone({ freq: 880, duration: 0.05, gain: 0.05, type: 'sine' });
};

/** A hint lights up a move. */
export const playHint = (): void => {
    tone({ freq: 1046.5, duration: 0.13, gain: 0.07, type: 'sine' });
    tone({ freq: 1567.98, duration: 0.17, gain: 0.055, type: 'sine', delay: 0.07 });
};

/** She won. */
export const playWin = (): void => {
    const melody = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
    melody.forEach((f, i) => {
        tone({ freq: f, duration: 0.62, gain: 0.13, type: 'sine', delay: i * 0.12 });
        tone({ freq: f * 2, duration: 0.4, gain: 0.04, type: 'sine', delay: i * 0.12 });
    });
    tone({ freq: 261.63, duration: 1.5, gain: 0.09, type: 'triangle', delay: 0.72 });
    tone({ freq: 392, duration: 1.5, gain: 0.07, type: 'triangle', delay: 0.72 });
    tone({ freq: 523.25, duration: 1.6, gain: 0.09, type: 'sine', delay: 0.72 });
};

/** One card bouncing during the victory cascade. */
export const playBounce = (velocity: number): void => {
    noiseBurst({
        duration: 0.07,
        gain: Math.min(0.09, 0.02 + velocity * 0.004),
        from: 1600 + Math.random() * 1400,
        to: 600,
        q: 0.7,
    });
};
