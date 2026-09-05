import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { GameAudioEngine } from '../src/audioEngine.js';
import { VOICE_LINES } from '../src/gameData.js';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function replaceGlobal(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
}

function mockBrowser(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const utterances = [];
  const speech = { cancel: t.mock.fn(), speak: (utterance) => utterances.push(utterance) };
  replaceGlobal(t, 'window', { setTimeout, clearTimeout, speechSynthesis: speech });
  replaceGlobal(t, 'SpeechSynthesisUtterance', class { constructor(text) { this.text = text; } });
  return { utterances, speech };
}


test('cancelling system speech settles immediately and cannot cancel a newer utterance', async (t) => {
  const { utterances, speech } = mockBrowser(t);
  const engine = new GameAudioEngine();
  const first = engine.play('word_hello');
  await flush();
  const second = engine.play('word_apple');
  await flush();
  assert.equal(await first, false);
  assert.equal(utterances.length, 2);
  // Finished and cancelled utterances must leave no timers behind.
  utterances[1].onend();
  assert.equal(await second, true);
  const cancelCount = speech.cancel.mock.callCount();
  t.mock.timers.tick(15_000);
  assert.equal(speech.cancel.mock.callCount(), cancelCount);
});

test('a stalled voice download is aborted and removed from pending work', async (t) => {
  mockBrowser(t);
  const engine = new GameAudioEngine();
  engine.context = {};
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const result = assert.rejects(engine.load('word_hello'), /aborted/);
  t.mock.timers.tick(8_000);
  await result;
  assert.equal(engine.pending.size, 0);
});

test('an audio context that never resumes cannot block the game forever', async (t) => {
  mockBrowser(t);
  const engine = new GameAudioEngine();
  engine.musicAllowed = false;
  engine.context = { state: 'suspended', resume: () => new Promise(() => {}) };
  const result = engine.unlock();
  t.mock.timers.tick(8_000);
  assert.equal(await result, false);
});

test('decoded voice buffers are bounded while evicted clips can be reloaded', async (t) => {
  mockBrowser(t);
  const engine = new GameAudioEngine();
  engine.context = { decodeAudioData: async () => ({ duration: 1 }) };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
  const keys = Object.keys(VOICE_LINES).slice(0, 70);
  for (const key of keys) await engine.load(key);
  assert.equal(engine.buffers.size, 64);
  assert.equal(engine.buffers.has(keys[0]), false);
  await engine.load(keys[0]);
  assert.equal(engine.buffers.has(keys[0]), true);
  assert.equal(engine.buffers.size, 64);
});

test('service worker updates wait for a safe screen and tolerate offline checks', async (t) => {
  const page = new EventTarget();
  page.location = { reload: t.mock.fn() };
  page.setInterval = () => 0;
  const serviceWorker = new EventTarget();
  serviceWorker.controller = {};
  const registration = new EventTarget();
  registration.waiting = { postMessage: t.mock.fn() };
  registration.update = async () => { throw new Error('offline'); };
  serviceWorker.register = async () => registration;
  replaceGlobal(t, 'window', page);
  replaceGlobal(t, 'document', new EventTarget());
  replaceGlobal(t, 'navigator', { serviceWorker });
  const source = (await readFile(new URL('../src/pwaUpdates.js', import.meta.url), 'utf8'))
    .replaceAll('import.meta.env.PROD', 'true').replaceAll('import.meta.env.BASE_URL', JSON.stringify('./'));
  const pwa = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  pwa.setLessonActive(true);
  await pwa.registerPwa();
  assert.equal(pwa.hasPwaUpdate(), true);
  pwa.applyPwaUpdate();
  assert.equal(registration.waiting.postMessage.mock.callCount(), 0);
  pwa.setLessonActive(false);
  pwa.applyPwaUpdate();
  assert.deepEqual(registration.waiting.postMessage.mock.calls[0].arguments, [{ type: 'SKIP_WAITING' }]);
  // Another open window may activate an update while this one is in a lesson.
  pwa.setLessonActive(true);
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(page.location.reload.mock.callCount(), 0);
  pwa.setLessonActive(false);
  pwa.applyPwaUpdate();
  assert.equal(page.location.reload.mock.callCount(), 1);
});
