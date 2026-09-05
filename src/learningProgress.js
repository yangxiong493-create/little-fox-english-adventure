import { ITEMS, MISSIONS } from './gameData.js';

export const PROGRESS_SCHEMA_VERSION = 5;

export const LEARNING_STATUS = {
  unseen: { rank: 0, label: '还没遇见', shortLabel: '未接触', icon: '○' },
  met: { rank: 1, label: '在故事里见过', shortLabel: '见过', icon: '·' },
  recognized: { rank: 2, label: '能独立辨认', shortLabel: '辨认出', icon: '✓' },
  applied: { rank: 3, label: '换个场景也会', shortLabel: '会迁移', icon: '↗' },
  retained: { rank: 4, label: '隔一段时间还记得', shortLabel: '记住了', icon: '★' },
};

export const STAGE_READINESS_RULES = {
  1: {
    sourceStage: 0,
    itemIds: ['fox', 'home'],
    minimumStatus: 'met',
    requiredCount: 2,
  },
  2: {
    sourceStage: 1,
    itemIds: ['apple', 'ball', 'cat', 'dog', 'car', 'milk'],
    minimumStatus: 'recognized',
    requiredCount: 5,
  },
  3: {
    sourceStage: 2,
    itemIds: ['find', 'give', 'put', 'jump', 'stop', 'red', 'blue'],
    minimumStatus: 'recognized',
    requiredCount: 5,
  },
  4: {
    sourceStage: 3,
    itemIds: ['red_apple', 'blue_ball', 'big_dog', 'small_cat'],
    minimumStatus: 'recognized',
    requiredCount: 3,
  },
  5: {
    sourceStage: 4,
    itemIds: ['i_want', 'here_you_are', 'thank_you', 'i_like', 'im_happy'],
    minimumStatus: 'recognized',
    requiredCount: 4,
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEAK_REVIEW_DELAY_MS = 30 * 60 * 1000;
const MAX_EVIDENCE_PER_ITEM = 48;
const REVIEW_DELAYS = {
  met: DAY_MS,
  recognized: 3 * DAY_MS,
  applied: 7 * DAY_MS,
  retained: 14 * DAY_MS,
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validMissionId(id) {
  return Number.isInteger(id) && id >= 1 && id <= MISSIONS.length;
}

function emptyLearningRecord() {
  return {
    metAt: null,
    recognizedAt: null,
    appliedAt: null,
    retainedAt: null,
    exposureCount: 0,
    evidence: [],
    lastSeenAt: null,
    nextReviewAt: null,
    dueAfterCompletedCount: null,
    inferredExposure: false,
  };
}

function normalizeEvidence(value) {
  if (!value || !validMissionId(value.missionId) || !Number.isInteger(value.roundIndex)) return null;
  const occurredAt = isFiniteNumber(value.occurredAt) ? value.occurredAt : Date.now();
  return {
    missionId: value.missionId,
    roundIndex: Math.max(0, value.roundIndex),
    beatKey: `${value.missionId}:${Math.max(0, value.roundIndex)}`,
    mode: typeof value.mode === 'string' ? value.mode : 'choice',
    choicesCount: Number.isInteger(value.choicesCount) ? Math.max(1, value.choicesCount) : 1,
    attempts: Number.isInteger(value.attempts) ? Math.max(0, value.attempts) : 0,
    hintLevel: Number.isInteger(value.hintLevel) ? Math.max(0, value.hintLevel) : 0,
    assisted: value.assisted === true,
    occurredAt,
  };
}

function normalizeLearningRecord(value) {
  const record = value && typeof value === 'object' ? value : {};
  return {
    metAt: isFiniteNumber(record.metAt) ? record.metAt : null,
    recognizedAt: isFiniteNumber(record.recognizedAt) ? record.recognizedAt : null,
    appliedAt: isFiniteNumber(record.appliedAt) ? record.appliedAt : null,
    retainedAt: isFiniteNumber(record.retainedAt) ? record.retainedAt : null,
    exposureCount: Number.isInteger(record.exposureCount) ? Math.max(0, record.exposureCount) : 0,
    evidence: Array.isArray(record.evidence)
      ? record.evidence.map(normalizeEvidence).filter(Boolean).slice(-MAX_EVIDENCE_PER_ITEM)
      : [],
    lastSeenAt: isFiniteNumber(record.lastSeenAt) ? record.lastSeenAt : null,
    nextReviewAt: isFiniteNumber(record.nextReviewAt) ? record.nextReviewAt : null,
    dueAfterCompletedCount: Number.isInteger(record.dueAfterCompletedCount)
      ? Math.max(0, record.dueAfterCompletedCount)
      : null,
    inferredExposure: record.inferredExposure === true,
  };
}

function inferLegacyUnlockedStage(completedIds) {
  const completed = new Set(completedIds);
  const firstIncomplete = MISSIONS.find((mission) => !completed.has(mission.id));
  const highestCompletedStage = Math.max(0, ...completedIds.map((id) => MISSIONS[id - 1]?.stage || 0));
  const sequentialStage = firstIncomplete
    ? firstIncomplete.stage
    : Math.max(...MISSIONS.map((mission) => mission.stage));
  return Math.max(highestCompletedStage, sequentialStage);
}

function markLegacyEncounters(learning, completedIds, now) {
  const completed = new Set(completedIds);
  for (const mission of MISSIONS) {
    if (!completed.has(mission.id)) continue;
    const encountered = new Set([
      ...mission.meet,
      ...mission.rounds.flatMap((round) => round.learningItems || [round.target]),
    ]);
    for (const itemId of encountered) {
      if (!(itemId in ITEMS)) continue;
      const current = learning[itemId] || emptyLearningRecord();
      if (current.metAt !== null) continue;
      learning[itemId] = {
        ...current,
        metAt: now,
        lastSeenAt: now,
        exposureCount: Math.max(1, current.exposureCount),
        nextReviewAt: current.nextReviewAt ?? now,
        inferredExposure: true,
      };
    }
  }
}

export function normalizeProgress(saved = {}, { legacy = false, now = Date.now() } = {}) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const completedIds = Array.isArray(saved.completedIds)
    ? [...new Set(saved.completedIds.filter(validMissionId))].sort((a, b) => a - b)
    : [];
  const learning = {};
  if (saved.learning && typeof saved.learning === 'object') {
    for (const [itemId, record] of Object.entries(saved.learning)) {
      if (itemId in ITEMS) learning[itemId] = normalizeLearningRecord(record);
    }
  }

  const lastMissionId = validMissionId(saved.lastMissionId) ? saved.lastMissionId : null;
  const migrating = legacy || (Number.isInteger(saved.schemaVersion) && saved.schemaVersion < PROGRESS_SCHEMA_VERSION);
  // Only a real migration may infer encounters. A current save can contain
  // stories played silently, without any listening evidence.
  if (migrating) markLegacyEncounters(learning, completedIds, now);
  const savedUnlockedStage = Number.isInteger(saved.legacyUnlockedStage)
    ? Math.max(0, saved.legacyUnlockedStage)
    : 0;
  const inferredUnlockedStage = migrating
    ? inferLegacyUnlockedStage(completedIds)
    : Math.max(0, ...completedIds.map((id) => MISSIONS[id - 1]?.stage || 0));
  const legacyUnlockedStage = Math.max(savedUnlockedStage, inferredUnlockedStage);

  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    completedIds,
    lastMissionId,
    audioOn: saved.audioOn !== false,
    learning,
    legacyUnlockedStage,
    activeLesson: normalizeActiveLesson(saved.activeLesson),
  };
}

export function normalizeActiveLesson(value) {
  if (!value || !validMissionId(value.missionId)) return null;
  const mission = MISSIONS[value.missionId - 1];
  if (!Number.isInteger(value.stepIndex) || value.stepIndex < 0 || value.stepIndex > 3) return null;
  return {
    missionId: mission.id,
    stepIndex: value.stepIndex,
    roundIndex: Number.isInteger(value.roundIndex)
      ? Math.max(0, Math.min(value.roundIndex, mission.rounds.length - 1)) : 0,
    attempts: Number.isInteger(value.attempts) ? Math.max(0, value.attempts) : 0,
    hintLevel: Number.isInteger(value.hintLevel) ? Math.max(0, Math.min(3, value.hintLevel)) : 0,
  };
}

export function recordExposure(progress, {
  itemId,
  missionId,
  occurredAt = Date.now(),
  inferred = false,
} = {}) {
  if (!(itemId in ITEMS) || !validMissionId(missionId)) return progress;
  const current = normalizeLearningRecord(progress.learning?.[itemId]);
  const next = {
    ...current,
    metAt: current.metAt ?? occurredAt,
    exposureCount: current.exposureCount + 1,
    lastSeenAt: occurredAt,
    inferredExposure: inferred,
  };
  return {
    ...progress,
    learning: { ...progress.learning, [itemId]: next },
  };
}

export function isIndependentEvidence(evidence) {
  return Boolean(evidence)
    && evidence.assisted !== true
    && evidence.attempts === 0
    && evidence.hintLevel === 0;
}

function isDiscriminatingEvidence(evidence) {
  return isIndependentEvidence(evidence) && evidence.choicesCount >= 2;
}

function evidenceContextKey(evidence) {
  return `${evidence.missionId}:${evidence.mode}`;
}

export function deriveLearningState(recordValue) {
  const record = normalizeLearningRecord(recordValue);
  const evidence = [...record.evidence].sort((a, b) => a.occurredAt - b.occurredAt);
  const distinctIndependent = [];
  const seenBeats = new Set();
  for (const entry of evidence.filter(isDiscriminatingEvidence)) {
    if (seenBeats.has(entry.beatKey)) continue;
    seenBeats.add(entry.beatKey);
    distinctIndependent.push(entry);
  }

  const recognitionBasis = distinctIndependent.slice(0, 2);
  const recognizedEvidence = recognitionBasis[1] || null;
  const recognizedAt = record.recognizedAt ?? recognizedEvidence?.occurredAt ?? null;
  let appliedEvidence = null;
  if (recognizedEvidence) {
    const recognitionContexts = new Set(recognitionBasis.map(evidenceContextKey));
    appliedEvidence = distinctIndependent.find((entry) => (
      entry.occurredAt > recognizedEvidence.occurredAt
      && !recognitionContexts.has(evidenceContextKey(entry))
    )) || null;
  }
  const appliedAt = record.appliedAt ?? appliedEvidence?.occurredAt ?? null;
  const retainedEvidence = appliedAt === null
    ? null
    : evidence.find((entry) => isDiscriminatingEvidence(entry) && entry.occurredAt - appliedAt >= DAY_MS) || null;
  const retainedAt = record.retainedAt ?? retainedEvidence?.occurredAt ?? null;

  let status = 'unseen';
  if (record.metAt !== null || evidence.length > 0) status = 'met';
  if (recognizedAt !== null) status = 'recognized';
  if (appliedAt !== null) status = 'applied';
  if (retainedAt !== null) status = 'retained';

  const lastEvidence = evidence.at(-1) || null;
  return {
    status,
    ...LEARNING_STATUS[status],
    metAt: record.metAt,
    recognizedAt,
    appliedAt,
    retainedAt,
    evidenceCount: evidence.length,
    independentCount: distinctIndependent.length,
    needsSupport: Boolean(lastEvidence && !isIndependentEvidence(lastEvidence)),
    lastEvidence,
    nextReviewAt: record.nextReviewAt,
    dueAfterCompletedCount: record.dueAfterCompletedCount,
  };
}

function statusAtLeast(actual, expected) {
  return LEARNING_STATUS[actual].rank >= LEARNING_STATUS[expected].rank;
}

export function recordMasteryEvidence(progress, {
  itemIds,
  missionId,
  roundIndex,
  mode,
  choicesCount,
  attempts,
  hintLevel,
  assisted,
  occurredAt = Date.now(),
} = {}) {
  if (!validMissionId(missionId) || !Array.isArray(itemIds)) return progress;
  const validItems = [...new Set(itemIds.filter((itemId) => itemId in ITEMS))];
  if (!validItems.length) return progress;

  const evidence = normalizeEvidence({
    missionId,
    roundIndex,
    mode,
    choicesCount,
    attempts,
    hintLevel,
    assisted,
    occurredAt,
  });
  if (!evidence) return progress;

  const learning = { ...progress.learning };
  const completesNewMission = progress.completedIds.includes(missionId) ? 0 : 1;
  for (const itemId of validItems) {
    const current = normalizeLearningRecord(learning[itemId]);
    const withEvidence = {
      ...current,
      metAt: current.metAt ?? occurredAt,
      lastSeenAt: occurredAt,
      evidence: [...current.evidence, evidence],
    };
    const state = deriveLearningState(withEvidence);
    const weakEvidence = !isIndependentEvidence(evidence);
    const scheduledAt = weakEvidence
      ? occurredAt + WEAK_REVIEW_DELAY_MS
      : occurredAt + REVIEW_DELAYS[state.status];
    learning[itemId] = {
      ...withEvidence,
      recognizedAt: state.recognizedAt,
      appliedAt: state.appliedAt,
      retainedAt: state.retainedAt,
      evidence: withEvidence.evidence.slice(-MAX_EVIDENCE_PER_ITEM),
      nextReviewAt: scheduledAt,
      dueAfterCompletedCount: weakEvidence ? progress.completedIds.length + completesNewMission + 1 : null,
      inferredExposure: false,
    };
  }

  return { ...progress, learning };
}

export function getLearningState(progress, itemId) {
  return deriveLearningState(progress.learning?.[itemId]);
}

export function getStageReadiness(progress, stageId) {
  if (stageId === 0) {
    return { stageId, ready: true, unlocked: true, completedPreviousStage: true, masteredCount: 0, requiredCount: 0, items: [] };
  }
  const rule = STAGE_READINESS_RULES[stageId];
  if (!rule) {
    return { stageId, ready: false, unlocked: false, completedPreviousStage: false, masteredCount: 0, requiredCount: 0, items: [] };
  }
  const completed = new Set(progress.completedIds);
  const previousMissions = MISSIONS.filter((mission) => mission.stage === rule.sourceStage);
  const completedPreviousStage = previousMissions.every((mission) => completed.has(mission.id));
  const items = rule.itemIds.map((itemId) => ({ itemId, state: getLearningState(progress, itemId) }));
  const masteredCount = items.filter(({ state }) => statusAtLeast(state.status, rule.minimumStatus)).length;
  const ready = completedPreviousStage && masteredCount >= rule.requiredCount;
  const alreadyEntered = progress.legacyUnlockedStage >= stageId
    || MISSIONS.some((mission) => mission.stage === stageId && completed.has(mission.id));
  return {
    stageId,
    ready,
    unlocked: ready || alreadyEntered,
    completedPreviousStage,
    masteredCount,
    requiredCount: rule.requiredCount,
    minimumStatus: rule.minimumStatus,
    items,
  };
}

export function getReviewQueue(progress, now = Date.now()) {
  return Object.entries(progress.learning || {})
    .map(([itemId, record]) => ({ itemId, record: normalizeLearningRecord(record), state: deriveLearningState(record) }))
    .filter(({ record }) => record.nextReviewAt !== null && (
      record.nextReviewAt <= now
      || (record.dueAfterCompletedCount !== null && progress.completedIds.length >= record.dueAfterCompletedCount)
    ))
    .sort((a, b) => {
      if (a.state.needsSupport !== b.state.needsSupport) return a.state.needsSupport ? -1 : 1;
      return a.record.nextReviewAt - b.record.nextReviewAt;
    });
}

function findReviewMission(progress, itemId) {
  const completed = new Set(progress.completedIds);
  const record = normalizeLearningRecord(progress.learning?.[itemId]);
  const state = deriveLearningState(record);
  const avoidMissionId = state.needsSupport ? state.lastEvidence?.missionId : null;
  const independentBeats = new Set(
    record.evidence.filter(isDiscriminatingEvidence).map((entry) => entry.beatKey),
  );
  const candidates = MISSIONS
    .filter((mission) => completed.has(mission.id))
    .map((mission) => {
      const rounds = mission.rounds
        .map((round, roundIndex) => ({ round, roundIndex }))
        .filter(({ round }) => (round.learningItems || [round.target]).includes(itemId));
      if (!rounds.length) return null;
      const newBeats = rounds.filter(({ roundIndex }) => !independentBeats.has(`${mission.id}:${roundIndex}`)).length;
      const strongestChoice = Math.max(...rounds.map(({ round }) => round.choices.length));
      const sameWeakContextPenalty = mission.id === avoidMissionId ? 2000 : 0;
      return { mission, score: newBeats * 1000 + strongestChoice * 100 + mission.id - sameWeakContextPenalty };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.mission || null;
}

export function getReviewSuggestion(progress, nextMission, now = Date.now()) {
  if (nextMission) {
    const readiness = getStageReadiness(progress, nextMission.stage);
    if (!readiness.unlocked) {
      const missing = readiness.items
        .filter(({ state }) => !statusAtLeast(state.status, readiness.minimumStatus))
        .sort((a, b) => a.state.rank - b.state.rank || Number(b.state.needsSupport) - Number(a.state.needsSupport));
      for (const candidate of missing) {
        const mission = findReviewMission(progress, candidate.itemId);
        if (mission) return { ...candidate, mission, reason: 'stage-readiness', readiness };
      }
    }
  }

  for (const candidate of getReviewQueue(progress, now)) {
    const mission = findReviewMission(progress, candidate.itemId);
    if (mission) return { ...candidate, mission, reason: 'review-due' };
  }
  return null;
}
