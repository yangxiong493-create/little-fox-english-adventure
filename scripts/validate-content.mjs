import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS, MISSIONS, VOICE_LINES } from '../src/gameData.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(MISSIONS.length === 15, `Expected 15 missions, found ${MISSIONS.length}`);
check(new Set(MISSIONS.map((mission) => mission.id)).size === 15, 'Mission IDs must be unique');
check(Object.keys(VOICE_LINES).length === 51, `Expected 51 voice clips, found ${Object.keys(VOICE_LINES).length}`);

for (const [itemId, item] of Object.entries(ITEMS)) {
  check(item.id === itemId, `Item key ${itemId} does not match its ID`);
  check(item.audio in VOICE_LINES, `Item ${itemId} has an unknown word audio key`);
  check(item.successAudio in VOICE_LINES, `Item ${itemId} has an unknown success audio key`);
}

for (const [index, mission] of MISSIONS.entries()) {
  check(mission.id === index + 1, `Mission IDs must be contiguous at ${mission.title}`);
  check([0, 1].includes(mission.stage), `Mission ${mission.id} has an invalid stage`);
  check(mission.introAudio in VOICE_LINES, `Mission ${mission.id} has an unknown intro audio key`);
  check(mission.meet.length > 0, `Mission ${mission.id} needs at least one Meet item`);
  check(Number.isInteger(mission.meetRepeats) && mission.meetRepeats > 0, `Mission ${mission.id} has invalid Meet repetitions`);
  check(mission.rounds.length > 0, `Mission ${mission.id} needs at least one challenge round`);
  check(mission.echo in ITEMS, `Mission ${mission.id} has an unknown echo item`);

  for (const itemId of mission.meet) {
    check(itemId in ITEMS, `Mission ${mission.id} references unknown Meet item ${itemId}`);
  }
  for (const challenge of mission.rounds) {
    check(challenge.target in ITEMS, `Mission ${mission.id} has unknown target ${challenge.target}`);
    check(challenge.choices.includes(challenge.target), `Mission ${mission.id} choices omit target ${challenge.target}`);
    check(challenge.audio in VOICE_LINES, `Mission ${mission.id} has unknown prompt audio ${challenge.audio}`);
    for (const itemId of challenge.choices) {
      check(itemId in ITEMS, `Mission ${mission.id} references unknown choice ${itemId}`);
    }
  }
}

for (const [key, line] of Object.entries(VOICE_LINES)) {
  check(typeof line.text === 'string' && line.text.trim(), `Voice line ${key} is empty`);
  const filePath = path.join(projectDir, 'public', 'audio', 'voice', `${key}.mp3`);
  const info = await stat(filePath);
  check(info.size > 1_000, `Voice file ${key}.mp3 is unexpectedly small`);
  const header = await readFile(filePath);
  const looksLikeMp3 = header.subarray(0, 3).toString() === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
  check(looksLikeMp3, `Voice file ${key}.mp3 does not look like MP3 audio`);
}

console.log(`Validated ${MISSIONS.length} missions, ${Object.keys(ITEMS).length} items, and ${Object.keys(VOICE_LINES).length} voice clips.`);
