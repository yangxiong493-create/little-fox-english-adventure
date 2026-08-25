import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_LINES, VOICE_NAME } from '../src/gameData.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const outputDir = path.join(projectDir, 'public', 'audio', 'voice');
const force = process.argv.includes('--force');
const concurrency = 2;
const maxAttempts = 5;

await mkdir(outputDir, { recursive: true });

async function existsAndHasAudio(filePath) {
  try {
    return (await stat(filePath)).size > 1_000;
  } catch {
    return false;
  }
}

function runMmx(key, line) {
  const outputPath = path.join(outputDir, `${key}.mp3`);
  const args = [
    'speech', 'synthesize',
    '--text', line.text,
    '--model', 'speech-2.8-hd',
    '--voice', VOICE_NAME,
    '--speed', String(line.speed ?? 0.9),
    '--volume', '1',
    '--pitch', '1',
    '--emotion', line.emotion ?? 'happy',
    '--language', 'English',
    '--format', 'mp3',
    '--sample-rate', '44100',
    '--bitrate', '128000',
    '--out', outputPath,
    '--non-interactive',
    '--quiet',
    '--output', 'json',
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('mmx', args, { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`${key} failed (${code}): ${stderr.trim()}`));
    });
  });
}

async function generateLine(key, line, attempt = 1) {
  try {
    return await runMmx(key, line);
  } catch (error) {
    const retryable = /rate limit|RPM|too many requests/i.test(error.message);
    if (!retryable || attempt >= maxAttempts) throw error;
    const waitMs = 1_500 * (2 ** (attempt - 1));
    console.log(`wait  ${key} (${Math.round(waitMs / 1000)}s)`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return generateLine(key, line, attempt + 1);
  }
}

const pending = [];
for (const [key, line] of Object.entries(VOICE_LINES)) {
  const outputPath = path.join(outputDir, `${key}.mp3`);
  if (!force && await existsAndHasAudio(outputPath)) {
    console.log(`skip  ${key}`);
  } else {
    pending.push([key, line]);
  }
}

let cursor = 0;
async function worker() {
  while (cursor < pending.length) {
    const index = cursor;
    cursor += 1;
    const [key, line] = pending[index];
    await generateLine(key, line);
    console.log(`done  ${key}`);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
console.log(`Audio ready: ${Object.keys(VOICE_LINES).length} clips using ${VOICE_NAME}`);
