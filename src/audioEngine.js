import { VOICE_LINES } from './gameData.js';

const MUSIC_LEVEL = 0.15;
const MUSIC_FADE_SECONDS = 0.65;

function audioUrl(key) {
  return `${import.meta.env.BASE_URL}audio/voice/${key}.mp3`;
}

function musicUrl() {
  return `${import.meta.env.BASE_URL}audio/music/spring-field.mp3`;
}

class GameAudioEngine {
  constructor() {
    this.context = null;
    this.voiceGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicElement = null;
    this.musicElementSource = null;
    this.musicPrepared = false;
    this.musicAllowed = true;
    this.voiceActive = false;
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
    document.documentElement.dataset.audioMusicAllowed = String(snapshot.musicAllowed);
    document.documentElement.dataset.audioVoiceActive = String(snapshot.voiceActive);
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

  ensureMusicElement() {
    const context = this.ensureGraph();
    if (!context || typeof window === 'undefined') return null;
    if (this.musicElement) return this.musicElement;
    const element = new window.Audio(musicUrl());
    element.preload = 'auto';
    element.loop = false;
    element.playsInline = true;
    element.addEventListener('ended', () => {
      this.requestedMusicLevel = 0;
      this.publishDebug();
    });
    this.musicElement = element;
    this.musicElementSource = context.createMediaElementSource(element);
    this.musicElementSource.connect(this.musicGain);
    return element;
  }

  unlock({ feedback = false } = {}) {
    if (!this.enabled) return Promise.resolve(false);
    const context = this.ensureGraph();
    if (!context) return Promise.resolve(false);
    const resumed = context.state === 'suspended' ? context.resume() : Promise.resolve();
    if (feedback) this.playFeedback();
    if (this.musicAllowed) this.startMusic();
    return resumed.then(() => context.state === 'running').catch(() => false);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.beginIntent();
      this.voiceActive = false;
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
    const element = this.ensureMusicElement();
    if (!element || this.musicPrepared) return;
    this.musicPrepared = true;
    element.load();
  }

  startMusic({ restart = false } = {}) {
    if (!this.enabled || !this.musicAllowed) return;
    const element = this.ensureMusicElement();
    if (!element) return;
    if (restart || element.ended) {
      try {
        element.currentTime = 0;
      } catch {
        // Safari can reject a seek until initial metadata is available.
      }
    }
    this.setMusicLevel(this.voiceActive ? 0 : MUSIC_LEVEL, { immediate: this.voiceActive });
    const playback = element.play();
    if (playback?.catch) void playback.catch(() => {});
    this.publishDebug();
  }

  stopMusic({ rewind = true } = {}) {
    if (this.musicElement) {
      this.musicElement.pause();
      if (rewind) {
        try {
          this.musicElement.currentTime = 0;
        } catch {
          // Safari can reject a seek until initial metadata is available.
        }
      }
    }
    this.requestedMusicLevel = 0;
    if (this.musicGain && this.context) this.musicGain.gain.setValueAtTime(0, this.context.currentTime);
    this.publishDebug();
  }

  setMusicAllowed(allowed, { restart = false } = {}) {
    this.musicAllowed = Boolean(allowed);
    if (!this.musicAllowed) this.stopMusic();
    else if (this.context?.state === 'running') this.startMusic({ restart });
    this.publishDebug();
  }

  setMusicLevel(level, { immediate = false } = {}) {
    if (!this.musicGain || !this.context) return;
    this.requestedMusicLevel = level;
    const now = this.context.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    if (immediate || level === 0) this.musicGain.gain.setValueAtTime(level, now);
    else {
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
      this.musicGain.gain.linearRampToValueAtTime(level, now + MUSIC_FADE_SECONDS);
    }
    this.publishDebug();
  }

  suspendMusicForVoice() {
    this.voiceActive = true;
    this.setMusicLevel(0, { immediate: true });
  }

  resumeMusicAfterVoice() {
    this.voiceActive = false;
    if (this.musicAllowed && this.enabled) this.startMusic();
    else this.stopMusic();
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
    this.resumeMusicAfterVoice();
  }

  shutdown() {
    this.beginIntent();
    this.voiceActive = false;
    this.stopMusic();
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
      return this.fallbackSpeak(key, intent);
    }
    if (intent !== this.intent || !this.enabled) return false;

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
    this.suspendMusicForVoice();
    const finished = await this.playKey(key, intent, { feedback });
    if (intent === this.intent) this.resumeMusicAfterVoice();
    if (finished) onEnded?.();
    return finished;
  }

  async playSequence(keys, { feedback = false, onEnded } = {}) {
    const intent = this.beginIntent();
    const sequence = keys.filter((key) => VOICE_LINES[key]);
    if (!sequence.length || !this.enabled) return false;
    this.suspendMusicForVoice();
    let finished = true;
    for (let index = 0; index < sequence.length; index += 1) {
      finished = await this.playKey(sequence[index], intent, { feedback: feedback && index === 0 });
      if (!finished || intent !== this.intent) break;
    }
    if (intent === this.intent) this.resumeMusicAfterVoice();
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
      musicActive: Boolean(
        this.musicElement
        && !this.musicElement.paused
        && !this.musicElement.ended
        && this.musicAllowed
        && !this.voiceActive
        && this.requestedMusicLevel > 0
      ),
      musicLevel: this.requestedMusicLevel,
      musicAllowed: this.musicAllowed,
      voiceActive: this.voiceActive,
      startLatencyMs: this.lastVoiceStartedAt >= this.lastIntentAt
        ? Math.round((this.lastVoiceStartedAt - this.lastIntentAt) * 10) / 10
        : null,
    };
  }
}

export const gameAudio = new GameAudioEngine();

if (import.meta.env.DEV && typeof window !== 'undefined') window.__littleFoxAudio = gameAudio;
