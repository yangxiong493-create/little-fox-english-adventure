import { VOICE_LINES } from './gameData.js';

const MUSIC_LEVEL = 0.34;
const DUCKED_MUSIC_LEVEL = 0.075;
const MUSIC_DURATION = 16;

function audioUrl(key) {
  return `${import.meta.env.BASE_URL}audio/voice/${key}.mp3`;
}

function createMusicBuffer(context) {
  const sampleRate = context.sampleRate;
  const frameCount = Math.floor(MUSIC_DURATION * sampleRate);
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const channel = buffer.getChannelData(0);
  const chords = [
    [130.81, 164.81, 196.00],
    [130.81, 174.61, 220.00],
    [146.83, 196.00, 246.94],
    [130.81, 164.81, 196.00],
  ];
  const melody = [523.25, 659.25, 783.99, 659.25, 698.46, 659.25, 523.25, 440.00,
    587.33, 783.99, 880.00, 783.99, 659.25, 587.33, 523.25, 392.00,
    659.25, 783.99, 987.77, 783.99, 698.46, 659.25, 587.33, 493.88,
    523.25, 659.25, 783.99, 659.25, 587.33, 493.88, 392.00, 523.25];

  for (let index = 0; index < frameCount; index += 1) {
    const time = index / sampleRate;
    const chordIndex = Math.min(3, Math.floor(time / 4));
    const chordTime = time % 4;
    const padEnvelope = Math.sin(Math.PI * chordTime / 4) ** 0.72;
    const pad = chords[chordIndex].reduce((sum, frequency, voiceIndex) => (
      sum
      + Math.sin(2 * Math.PI * frequency * time + voiceIndex * 0.35)
      + 0.22 * Math.sin(2 * Math.PI * frequency * 2 * time)
    ), 0) / 3.66;

    const noteIndex = Math.min(melody.length - 1, Math.floor(time / 0.5));
    const noteTime = time % 0.5;
    const bellEnvelope = Math.sin(Math.PI * Math.min(1, noteTime / 0.48)) * Math.exp(-4.6 * noteTime);
    const frequency = melody[noteIndex];
    const bell = Math.sin(2 * Math.PI * frequency * time)
      + 0.32 * Math.sin(2 * Math.PI * frequency * 2 * time)
      + 0.12 * Math.sin(2 * Math.PI * frequency * 3 * time);
    const loopFade = Math.min(1, time / 0.08, (MUSIC_DURATION - time) / 0.08);
    channel[index] = loopFade * ((pad * padEnvelope * 0.055) + (bell * bellEnvelope * 0.07));
  }
  return buffer;
}

class GameAudioEngine {
  constructor() {
    this.context = null;
    this.voiceGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicBuffer = null;
    this.musicSource = null;
    this.feedbackSource = null;
    this.currentVoice = null;
    this.buffers = new Map();
    this.pending = new Map();
    this.intent = 0;
    this.lastIntentAt = 0;
    this.lastVoiceStartedAt = 0;
    this.currentKey = null;
    this.requestedMusicLevel = 0;
    this.enabled = true;
  }

  publishDebug() {
    if (!import.meta.env.DEV || typeof document === 'undefined') return;
    const snapshot = this.debugSnapshot();
    document.documentElement.dataset.audioBuffered = String(snapshot.bufferedCount);
    document.documentElement.dataset.audioPending = String(snapshot.pendingCount);
    document.documentElement.dataset.audioCurrent = snapshot.currentKey || '';
    document.documentElement.dataset.audioIntent = String(snapshot.intent);
    document.documentElement.dataset.audioContext = snapshot.contextState;
    document.documentElement.dataset.audioMusic = String(snapshot.musicActive);
    document.documentElement.dataset.audioMusicLevel = String(snapshot.musicLevel);
    document.documentElement.dataset.audioLatency = snapshot.startLatencyMs === null ? '' : String(snapshot.startLatencyMs);
  }

  ensureGraph() {
    if (this.context || typeof window === 'undefined') return this.context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    this.context = new AudioContextClass({ latencyHint: 'interactive' });
    this.voiceGain = this.context.createGain();
    this.musicGain = this.context.createGain();
    this.sfxGain = this.context.createGain();
    this.voiceGain.gain.value = 1;
    this.musicGain.gain.value = 0;
    this.sfxGain.gain.value = 0.7;
    this.voiceGain.connect(this.context.destination);
    this.musicGain.connect(this.context.destination);
    this.sfxGain.connect(this.context.destination);
    this.publishDebug();
    return this.context;
  }

  unlock({ feedback = false } = {}) {
    if (!this.enabled) return Promise.resolve(false);
    const context = this.ensureGraph();
    if (!context) return Promise.resolve(false);
    const resumed = context.state === 'suspended' ? context.resume() : Promise.resolve();
    if (feedback) this.playFeedback();
    this.startMusic();
    return resumed.then(() => context.state === 'running').catch(() => false);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.stop();
      this.stopMusic();
    }
    this.publishDebug();
  }

  async load(key) {
    if (!VOICE_LINES[key]) throw new Error(`Unknown voice line: ${key}`);
    if (this.buffers.has(key)) return this.buffers.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const context = this.ensureGraph();
    if (!context) throw new Error('Web Audio is unavailable');

    const pending = (async () => {
      const response = await fetch(audioUrl(key), { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Voice ${key} returned ${response.status}`);
      const bytes = await response.arrayBuffer();
      const decoded = await context.decodeAudioData(bytes);
      this.buffers.set(key, decoded);
      this.publishDebug();
      return decoded;
    })();
    this.pending.set(key, pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(key);
      this.publishDebug();
    }
  }

  async preload(keys, { concurrency = 4 } = {}) {
    const queue = [...new Set(keys)].filter((key) => VOICE_LINES[key] && !this.buffers.has(key));
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const index = cursor;
        cursor += 1;
        try {
          await this.load(queue[index]);
        } catch {
          // A failed preload is retried on demand and has a speech fallback.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  }

  prepareMusic() {
    const context = this.ensureGraph();
    if (context && !this.musicBuffer) this.musicBuffer = createMusicBuffer(context);
  }

  startMusic() {
    if (!this.enabled || this.musicSource) return;
    const context = this.ensureGraph();
    if (!context) return;
    if (!this.musicBuffer) this.musicBuffer = createMusicBuffer(context);
    const source = context.createBufferSource();
    source.buffer = this.musicBuffer;
    source.loop = true;
    source.connect(this.musicGain);
    this.musicSource = source;
    const now = context.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(0, now);
    this.musicGain.gain.linearRampToValueAtTime(MUSIC_LEVEL, now + 1.5);
    this.requestedMusicLevel = MUSIC_LEVEL;
    source.start(now);
    this.publishDebug();
  }

  stopMusic() {
    if (!this.musicSource) return;
    try {
      this.musicSource.stop();
    } catch {
      // The source may already have ended during page teardown.
    }
    this.musicSource.disconnect();
    this.musicSource = null;
    this.requestedMusicLevel = 0;
    if (this.musicGain && this.context) this.musicGain.gain.setValueAtTime(0, this.context.currentTime);
    this.publishDebug();
  }

  setMusicLevel(level) {
    if (!this.musicGain || !this.context) return;
    this.requestedMusicLevel = level;
    const now = this.context.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setTargetAtTime(level, now, 0.055);
    this.publishDebug();
  }

  playFeedback() {
    const context = this.ensureGraph();
    if (!context || !this.enabled) return;
    if (this.feedbackSource) {
      this.feedbackSource.oscillator.onended = null;
      try {
        this.feedbackSource.oscillator.stop();
      } catch {
        // A prior tap tone may already have ended.
      }
      this.feedbackSource.oscillator.disconnect();
      this.feedbackSource.gain.disconnect();
      this.feedbackSource = null;
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(720, now);
    oscillator.frequency.exponentialRampToValueAtTime(940, now + 0.065);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
    oscillator.connect(gain);
    gain.connect(this.sfxGain);
    this.feedbackSource = { oscillator, gain };
    oscillator.onended = () => {
      if (this.feedbackSource?.oscillator === oscillator) this.feedbackSource = null;
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + 0.09);
  }

  cancelCurrentVoice() {
    window.speechSynthesis?.cancel();
    if (!this.currentVoice) return;
    const current = this.currentVoice;
    current.source.onended = null;
    try {
      current.source.stop();
    } catch {
      // Stopping an already-ended source is harmless.
    }
    current.resolve(false);
  }

  beginIntent() {
    this.intent += 1;
    this.lastIntentAt = performance.now();
    this.cancelCurrentVoice();
    this.publishDebug();
    return this.intent;
  }

  stop() {
    this.beginIntent();
    this.setMusicLevel(this.enabled ? MUSIC_LEVEL : 0);
  }

  async fallbackSpeak(key, intent) {
    if (!this.enabled || intent !== this.intent || !('speechSynthesis' in window)) return false;
    const line = VOICE_LINES[key];
    return new Promise((resolve) => {
      let settled = false;
      const timeoutMs = Math.min(12_000, Math.max(3_000, line.text.length * 220));
      const finish = (completed) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(Boolean(completed) && intent === this.intent && this.enabled);
      };
      const timer = window.setTimeout(() => {
        window.speechSynthesis.cancel();
        finish(false);
      }, timeoutMs);
      try {
        const utterance = new SpeechSynthesisUtterance(line.text);
        utterance.lang = line.language === 'Chinese' ? 'zh-CN' : 'en-US';
        utterance.rate = line.speed ?? 0.84;
        utterance.pitch = 1.08;
        utterance.onend = () => finish(true);
        utterance.onerror = () => finish(false);
        window.speechSynthesis.speak(utterance);
      } catch {
        finish(false);
      }
    });
  }

  async playKey(key, intent, { feedback = false } = {}) {
    if (!this.enabled || !key || intent !== this.intent) return false;
    const wasReady = this.buffers.has(key);
    const resumePromise = this.unlock();
    if (feedback && !wasReady) this.playFeedback();

    let buffer;
    try {
      const result = await Promise.all([this.load(key), resumePromise]);
      [buffer] = result;
      if (!result[1]) return false;
    } catch {
      if (intent !== this.intent || !this.enabled) return false;
      this.setMusicLevel(DUCKED_MUSIC_LEVEL);
      return this.fallbackSpeak(key, intent);
    }
    if (intent !== this.intent || !this.enabled) return false;

    this.setMusicLevel(DUCKED_MUSIC_LEVEL);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.voiceGain);
    return new Promise((resolve) => {
      const settle = (finished) => {
        if (this.currentVoice?.source === source) this.currentVoice = null;
        if (this.currentKey === key) this.currentKey = null;
        source.onended = null;
        source.disconnect();
        this.publishDebug();
        resolve(finished && intent === this.intent && this.enabled);
      };
      this.currentVoice = { source, resolve: (finished) => settle(finished) };
      this.currentKey = key;
      this.lastVoiceStartedAt = performance.now();
      source.onended = () => settle(true);
      source.start();
      this.publishDebug();
    });
  }

  async play(key, { feedback = false, onEnded } = {}) {
    const intent = this.beginIntent();
    const finished = await this.playKey(key, intent, { feedback });
    if (intent === this.intent) this.setMusicLevel(this.enabled ? MUSIC_LEVEL : 0);
    if (finished) onEnded?.();
    return finished;
  }

  async playSequence(keys, { feedback = false, onEnded } = {}) {
    const intent = this.beginIntent();
    const sequence = keys.filter((key) => VOICE_LINES[key]);
    if (!sequence.length || !this.enabled) return false;
    let finished = true;
    for (let index = 0; index < sequence.length; index += 1) {
      finished = await this.playKey(sequence[index], intent, { feedback: feedback && index === 0 });
      if (!finished || intent !== this.intent) break;
    }
    if (intent === this.intent) this.setMusicLevel(this.enabled ? MUSIC_LEVEL : 0);
    if (finished) onEnded?.();
    return finished;
  }

  debugSnapshot() {
    return {
      enabled: this.enabled,
      contextState: this.context?.state || 'unavailable',
      bufferedCount: this.buffers.size,
      pendingCount: this.pending.size,
      currentKey: this.currentKey,
      intent: this.intent,
      musicActive: Boolean(this.musicSource),
      musicLevel: this.requestedMusicLevel,
      startLatencyMs: this.lastVoiceStartedAt >= this.lastIntentAt
        ? Math.round((this.lastVoiceStartedAt - this.lastIntentAt) * 10) / 10
        : null,
    };
  }
}

export const gameAudio = new GameAudioEngine();

if (import.meta.env.DEV && typeof window !== 'undefined') window.__littleFoxAudio = gameAudio;
