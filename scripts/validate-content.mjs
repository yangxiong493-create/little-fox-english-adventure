import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS, MISSIONS, STAGES, VOICE_LINES } from '../src/gameData.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(MISSIONS.length === 59, `Expected 59 missions, found ${MISSIONS.length}`);
check(new Set(MISSIONS.map((mission) => mission.id)).size === 59, 'Mission IDs must be unique');
check(STAGES.length === 6, `Expected 6 stages, found ${STAGES.length}`);
check(Object.keys(ITEMS).length === 34, `Expected 34 items, found ${Object.keys(ITEMS).length}`);
check(Object.keys(VOICE_LINES).length === 186, `Expected 186 voice clips, found ${Object.keys(VOICE_LINES).length}`);

for (const [itemId, item] of Object.entries(ITEMS)) {
  check(item.id === itemId, `Item key ${itemId} does not match its ID`);
  check(item.audio in VOICE_LINES, `Item ${itemId} has an unknown word audio key`);
  check(item.successAudio in VOICE_LINES, `Item ${itemId} has an unknown success audio key`);
}

for (const [index, mission] of MISSIONS.entries()) {
  check(mission.id === index + 1, `Mission IDs must be contiguous at ${mission.title}`);
  check([0, 1, 2, 3, 4, 5].includes(mission.stage), `Mission ${mission.id} has an invalid stage`);
  check(mission.introAudio in VOICE_LINES, `Mission ${mission.id} has an unknown intro audio key`);
  check(mission.meet.length > 0, `Mission ${mission.id} needs at least one Meet item`);
  check(new Set(mission.meet).size === mission.meet.length, `Mission ${mission.id} has duplicate Meet items`);
  check(Number.isInteger(mission.meetRepeats) && mission.meetRepeats > 0, `Mission ${mission.id} has invalid Meet repetitions`);
  check(mission.rounds.length > 0, `Mission ${mission.id} needs at least one challenge round`);
  check(mission.echo in ITEMS, `Mission ${mission.id} has an unknown echo item`);

  for (const itemId of mission.meet) {
    check(itemId in ITEMS, `Mission ${mission.id} references unknown Meet item ${itemId}`);
  }
  for (const challenge of mission.rounds) {
    check(challenge.target in ITEMS, `Mission ${mission.id} has unknown target ${challenge.target}`);
    check(challenge.choices.includes(challenge.target), `Mission ${mission.id} choices omit target ${challenge.target}`);
    check(new Set(challenge.choices).size === challenge.choices.length, `Mission ${mission.id} has duplicate challenge choices`);
    check(challenge.choices.length <= 3, `Mission ${mission.id} exceeds the three-choice curriculum limit`);
    check(challenge.audio in VOICE_LINES, `Mission ${mission.id} has unknown prompt audio ${challenge.audio}`);
    check(Array.isArray(challenge.learningItems) && challenge.learningItems.length > 0, `Mission ${mission.id} challenge needs Learning Items`);
    for (const itemId of challenge.choices) {
      check(itemId in ITEMS, `Mission ${mission.id} references unknown choice ${itemId}`);
    }
    for (const itemId of challenge.learningItems) {
      check(itemId in ITEMS, `Mission ${mission.id} records evidence for unknown item ${itemId}`);
    }
  }
}

for (const [key, line] of Object.entries(VOICE_LINES)) {
  check(typeof line.text === 'string' && line.text.trim(), `Voice line ${key} is empty`);
  check(line.language === undefined || ['English', 'Chinese'].includes(line.language), `Voice line ${key} has an unsupported language`);
  const filePath = path.join(projectDir, 'public', 'audio', 'voice', `${key}.mp3`);
  const info = await stat(filePath);
  check(info.size > 1_000, `Voice file ${key}.mp3 is unexpectedly small`);
  const header = await readFile(filePath);
  const looksLikeMp3 = header.subarray(0, 3).toString() === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
  check(looksLikeMp3, `Voice file ${key}.mp3 does not look like MP3 audio`);
}

console.log(`Validated ${MISSIONS.length} missions, ${Object.keys(ITEMS).length} items, and ${Object.keys(VOICE_LINES).length} voice clips.`);
