import assert from 'node:assert/strict';
import { MISSIONS } from '../src/gameData.js';
import {
  deriveLearningState,
  getReviewQueue,
  getReviewSuggestion,
  getStageReadiness,
  normalizeProgress,
  recordExposure,
  recordMasteryEvidence,
} from '../src/learningProgress.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const startedAt = Date.UTC(2026, 0, 1, 8, 0, 0);

function evidence(progress, {
  itemId,
  missionId,
  roundIndex,
  occurredAt,
  attempts = 0,
  hintLevel = 0,
  assisted = false,
  choicesCount = 2,
  mode = 'find',
}) {
  return recordMasteryEvidence(progress, {
    itemIds: [itemId],
    missionId,
    roundIndex,
    occurredAt,
    attempts,
    hintLevel,
    assisted,
    choicesCount,
    mode,
  });
}

let progress = normalizeProgress({}, { now: startedAt });
progress = recordExposure(progress, { itemId: 'apple', missionId: 4, occurredAt: startedAt });
assert.equal(deriveLearningState(progress.learning.apple).status, 'met', 'An understandable exposure should produce Met');

progress = evidence(progress, { itemId: 'apple', missionId: 6, roundIndex: 0, occurredAt: startedAt + 1_000 });
assert.equal(deriveLearningState(progress.learning.apple).status, 'met', 'One independent response must not imply recognition');

progress = evidence(progress, { itemId: 'apple', missionId: 12, roundIndex: 0, occurredAt: startedAt + 2_000, mode: 'hide' });
assert.equal(deriveLearningState(progress.learning.apple).status, 'recognized', 'Two distinct independent Play Beats should produce Recognized');

progress = evidence(progress, { itemId: 'apple', missionId: 14, roundIndex: 2, occurredAt: startedAt + 3_000, choicesCount: 3, mode: 'gift' });
assert.equal(deriveLearningState(progress.learning.apple).status, 'applied', 'A later changed context should produce Applied');

progress = evidence(progress, { itemId: 'apple', missionId: 14, roundIndex: 2, occurredAt: startedAt + DAY_MS + 4_000, choicesCount: 3, mode: 'gift' });
assert.equal(deriveLearningState(progress.learning.apple).status, 'retained', 'Independent evidence after a meaningful delay should produce Retained');

let repeatedContext = normalizeProgress({}, { now: startedAt });
repeatedContext = evidence(repeatedContext, { itemId: 'dog', missionId: 13, roundIndex: 0, occurredAt: startedAt + 1_000, mode: 'flashlight' });
repeatedContext = evidence(repeatedContext, { itemId: 'dog', missionId: 13, roundIndex: 1, occurredAt: startedAt + 2_000, mode: 'flashlight' });
repeatedContext = evidence(repeatedContext, { itemId: 'dog', missionId: 13, roundIndex: 2, occurredAt: startedAt + 3_000, mode: 'flashlight' });
assert.equal(deriveLearningState(repeatedContext.learning.dog).status, 'recognized', 'More beats in the same learning context must not imply transfer');
repeatedContext = evidence(repeatedContext, { itemId: 'dog', missionId: 15, roundIndex: 0, occurredAt: startedAt + 4_000, mode: 'festival' });
assert.equal(deriveLearningState(repeatedContext.learning.dog).status, 'applied', 'A context not used for recognition should produce Applied');

let weakProgress = { ...normalizeProgress({}, { now: startedAt }), completedIds: [1, 2, 3, 4, 5] };
weakProgress = evidence(weakProgress, {
  itemId: 'ball',
  missionId: 5,
  roundIndex: 0,
  occurredAt: startedAt,
  attempts: 2,
  hintLevel: 2,
});
assert.equal(getReviewQueue(weakProgress, startedAt).length, 0, 'Weak evidence should not trigger an immediate mechanical repeat');
weakProgress = { ...weakProgress, completedIds: [1, 2, 3, 4, 5, 6] };
assert.equal(getReviewQueue(weakProgress, startedAt).at(0)?.itemId, 'ball', 'Weak evidence should return after another Mission');

const completedStageOne = Array.from({ length: 15 }, (_, index) => index + 1);
let readinessProgress = normalizeProgress({ completedIds: completedStageOne }, { now: startedAt });
const recognitionBeats = {
  apple: [[6, 0], [12, 0]],
  ball: [[5, 0], [6, 1]],
  cat: [[7, 0], [9, 0]],
  dog: [[8, 0], [9, 1]],
  car: [[10, 0], [13, 1]],
};
let tick = 0;
for (const [itemId, beats] of Object.entries(recognitionBeats)) {
  for (const [missionId, roundIndex] of beats) {
    readinessProgress = evidence(readinessProgress, {
      itemId,
      missionId,
      roundIndex,
      occurredAt: startedAt + (++tick * 1_000),
      choicesCount: missionId >= 13 ? 3 : 2,
    });
  }
}
assert.equal(getStageReadiness(readinessProgress, 2).unlocked, true, 'Five recognized nouns should unlock Action Forest');

let fourItemsProgress = normalizeProgress({ completedIds: completedStageOne }, { now: startedAt });
for (const [itemId, beats] of Object.entries(recognitionBeats).slice(0, 4)) {
  for (const [missionId, roundIndex] of beats) {
    fourItemsProgress = evidence(fourItemsProgress, {
      itemId,
      missionId,
      roundIndex,
      occurredAt: startedAt + (++tick * 1_000),
      choicesCount: missionId >= 13 ? 3 : 2,
    });
  }
}
assert.equal(getStageReadiness(fourItemsProgress, 2).unlocked, false, 'Four recognized nouns should not satisfy Stage Readiness');
assert.equal(getReviewSuggestion(fourItemsProgress, MISSIONS[15], startedAt)?.reason, 'stage-readiness', 'A readiness gap should produce a targeted review');

const migrated = normalizeProgress({ completedIds: completedStageOne }, { legacy: true, now: startedAt });
assert.equal(getStageReadiness(migrated, 2).unlocked, true, 'Migration must preserve a Stage that legacy Story Progress had reached');
assert.equal(deriveLearningState(migrated.learning.apple).status, 'met', 'Migration may infer an encounter but must not invent independent mastery');
assert.ok(getReviewQueue(migrated, startedAt).length > 0, 'Inferred legacy encounters should return for honest evidence collection');

const sparseLegacy = normalizeProgress({ completedIds: [16] }, { legacy: true, now: startedAt });
assert.equal(getStageReadiness(sparseLegacy, 1).unlocked, true, 'Migration should preserve every Stage below the highest legacy Mission reached');
assert.equal(getStageReadiness(sparseLegacy, 2).unlocked, true, 'Migration should preserve a non-sequential legacy Stage without fabricating mastery');

const completedStageTwo = Array.from({ length: 27 }, (_, index) => index + 1);
let valleyReadiness = normalizeProgress({ completedIds: completedStageTwo }, { now: startedAt });
assert.equal(getStageReadiness(valleyReadiness, 3).unlocked, false, 'Completing stories alone should not imply readiness for Color Valley');
const actionRecognitionBeats = {
  find: [[16, 0], [16, 1]],
  give: [[17, 0], [17, 1]],
  put: [[18, 1], [25, 0]],
  jump: [[21, 0], [27, 1]],
  stop: [[20, 0], [21, 1]],
};
for (const [itemId, beats] of Object.entries(actionRecognitionBeats)) {
  for (const [missionId, roundIndex] of beats) {
    valleyReadiness = evidence(valleyReadiness, {
      itemId,
      missionId,
      roundIndex,
      occurredAt: startedAt + (++tick * 1_000),
      choicesCount: 2,
    });
  }
}
assert.equal(getStageReadiness(valleyReadiness, 3).unlocked, true, 'Five recognized action sounds should unlock Color Valley');

const migratedCompletedForest = normalizeProgress({ completedIds: completedStageTwo }, { legacy: true, now: startedAt });
assert.equal(getStageReadiness(migratedCompletedForest, 3).unlocked, true, 'Existing families who finished Action Forest should keep moving forward after migration');

const completedColorValley = Array.from({ length: 32 }, (_, index) => index + 1);
let townReadiness = normalizeProgress({ completedIds: completedColorValley }, { now: startedAt });
assert.equal(getStageReadiness(townReadiness, 4).unlocked, false, 'Completing Color Valley stories alone should not imply communication readiness');
const combinationRecognitionBeats = {
  red_apple: [[28, 0], [28, 1]],
  blue_ball: [[29, 0], [29, 1]],
  big_dog: [[31, 1], [32, 2]],
};
for (const [itemId, beats] of Object.entries(combinationRecognitionBeats)) {
  for (const [missionId, roundIndex] of beats) {
    townReadiness = evidence(townReadiness, {
      itemId,
      missionId,
      roundIndex,
      occurredAt: startedAt + (++tick * 1_000),
      choicesCount: 2,
      mode: 'valley-combination',
    });
  }
}
assert.equal(getStageReadiness(townReadiness, 4).unlocked, true, 'Three recognized combinations should unlock Happy Town');

const migratedCompletedValley = normalizeProgress({ schemaVersion: 4, completedIds: completedColorValley }, { now: startedAt });
assert.equal(getStageReadiness(migratedCompletedValley, 4).unlocked, true, 'Families who finished Color Valley in v4 should keep moving into Happy Town');

const completedHappyTown = Array.from({ length: 47 }, (_, index) => index + 1);
let castleReadiness = normalizeProgress({ completedIds: completedHappyTown }, { now: startedAt });
assert.equal(getStageReadiness(castleReadiness, 5).unlocked, false, 'Completing Happy Town stories alone should not imply story readiness');
const communicationRecognitionBeats = {
  i_want: [[34, 0], [35, 0]],
  here_you_are: [[38, 0], [38, 1]],
  thank_you: [[41, 0], [42, 2]],
  i_like: [[43, 0], [44, 0]],
};
for (const [itemId, beats] of Object.entries(communicationRecognitionBeats)) {
  for (const [missionId, roundIndex] of beats) {
    castleReadiness = evidence(castleReadiness, {
      itemId,
      missionId,
      roundIndex,
      occurredAt: startedAt + (++tick * 1_000),
      choicesCount: 2,
      mode: 'town-conversation',
    });
  }
}
assert.equal(getStageReadiness(castleReadiness, 5).unlocked, true, 'Four recognized communication functions should unlock Story Castle');

let changedContextProgress = { ...normalizeProgress({}, { now: startedAt }), completedIds: Array.from({ length: 16 }, (_, index) => index + 1), legacyUnlockedStage: 2 };
changedContextProgress = evidence(changedContextProgress, { itemId: 'cat', missionId: 7, roundIndex: 0, occurredAt: startedAt + 1_000 });
changedContextProgress = evidence(changedContextProgress, { itemId: 'cat', missionId: 9, roundIndex: 0, occurredAt: startedAt + 2_000 });
changedContextProgress = evidence(changedContextProgress, { itemId: 'cat', missionId: 13, roundIndex: 0, occurredAt: startedAt + 3_000, choicesCount: 3, mode: 'flashlight' });
changedContextProgress = evidence(changedContextProgress, { itemId: 'cat', missionId: 15, roundIndex: 1, occurredAt: startedAt + 4_000, attempts: 1, hintLevel: 1, choicesCount: 3, mode: 'festival' });
const changedContextReview = getReviewSuggestion(changedContextProgress, MISSIONS[16], startedAt + (31 * 60 * 1_000));
assert.equal(changedContextReview?.itemId, 'cat', 'The weak Learning Item should be selected for review');
assert.notEqual(changedContextReview?.mission.id, 15, 'Weak evidence should return in a different Mission context');

console.log('Validated learning evidence, mastery states, review scheduling, Stage Readiness, and legacy migration.');
