import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ITEMS, MISSIONS, STAGES, VOICE_LINES, getMission } from './gameData.js';
import { gameAudio } from './audioEngine.js';
import {
  LEARNING_STATUS,
  getLearningState,
  getReviewQueue,
  getReviewSuggestion,
  getStageReadiness,
  normalizeProgress,
  recordExposure,
  recordMasteryEvidence,
} from './learningProgress.js';
import './styles.css';

const LESSON_STEPS = [
  { id: 'story', label: '看故事', icon: '✨' },
  { id: 'meet', label: '认识它', icon: '👀' },
  { id: 'play', label: '帮帮忙', icon: '🖐️' },
  { id: 'echo', label: '一起说', icon: '🎙️' },
  { id: 'reward', label: '世界变了', icon: '🌟' },
];

const PROGRESS_STORAGE_KEY = 'little-fox-progress-v4';
const LEGACY_PROGRESS_STORAGE_KEYS = ['little-fox-progress-v3', 'little-fox-progress-v2'];
const CRITICAL_VOICE_KEYS = [
  'zh_welcome', 'welcome', 'zh_meet', 'zh_listen_choose', 'zh_try_again',
  'zh_together', 'zh_echo', 'zh_reward', 'reward_done',
  ...MISSIONS.slice(0, 3).flatMap((mission) => [
    mission.introAudio,
    ...mission.meet.map((itemId) => ITEMS[itemId].audio),
    ...mission.rounds.map((roundData) => roundData.audio),
  ]),
];

function parseStoredProgress(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readSavedProgress() {
  try {
    if (import.meta.env.DEV) {
      const previewMissionId = Number(new URLSearchParams(window.location.search).get('previewMission'));
      const previewMission = getMission(previewMissionId);
      if (previewMission) {
        return normalizeProgress({
          completedIds: MISSIONS.filter((mission) => mission.id < previewMissionId).map((mission) => mission.id),
          lastMissionId: Math.max(1, previewMissionId - 1),
          legacyUnlockedStage: previewMission.stage,
          audioOn: true,
        });
      }
    }
    const current = parseStoredProgress(window.localStorage.getItem(PROGRESS_STORAGE_KEY));
    if (current) return normalizeProgress(current);
    for (const key of LEGACY_PROGRESS_STORAGE_KEYS) {
      const legacy = parseStoredProgress(window.localStorage.getItem(key));
      if (legacy) return normalizeProgress(legacy, { legacy: true });
    }
    return normalizeProgress();
  } catch {
    return normalizeProgress();
  }
}

function useGameAudio(audioOn) {
  const play = useCallback((key, options) => gameAudio.play(key, options), []);
  const playSequence = useCallback((keys, options) => gameAudio.playSequence(keys, options), []);
  const stop = useCallback(() => gameAudio.stop(), []);
  const unlock = useCallback((options) => gameAudio.unlock(options), []);
  const setMusicAllowed = useCallback((allowed, options) => gameAudio.setMusicAllowed(allowed, options), []);

  useEffect(() => {
    gameAudio.setEnabled(audioOn);
  }, [audioOn]);

  useEffect(() => {
    void gameAudio.preload(CRITICAL_VOICE_KEYS, { concurrency: 4 });
    const preloadAll = () => {
      gameAudio.prepareMusic();
      void gameAudio.preload(Object.keys(VOICE_LINES), { concurrency: 4 });
    };
    const idleId = 'requestIdleCallback' in window
      ? window.requestIdleCallback(preloadAll, { timeout: 1800 })
      : window.setTimeout(preloadAll, 500);
    return () => {
      if ('cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
  }, []);

  useEffect(() => () => gameAudio.shutdown(), []);
  return { play, playSequence, stop, unlock, setMusicAllowed };
}

export default function App() {
  const initialProgress = useMemo(readSavedProgress, []);
  const [progress, setProgress] = useState(initialProgress);
  const [screen, setScreen] = useState('welcome');
  const [missionId, setMissionId] = useState(null);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [parentGateOpen, setParentGateOpen] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const { play, playSequence, stop, unlock, setMusicAllowed } = useGameAudio(progress.audioOn);

  const completedSet = useMemo(() => new Set(progress.completedIds), [progress.completedIds]);
  const nextIncomplete = MISSIONS.find((mission) => !completedSet.has(mission.id)) || null;
  const nextMission = nextIncomplete || MISSIONS.at(-1);
  const reviewSuggestion = useMemo(
    () => getReviewSuggestion(progress, nextIncomplete, clock),
    [progress, nextIncomplete, clock],
  );
  const activeMission = missionId ? getMission(missionId) : null;

  useEffect(() => {
    if (!nextMission) return;
    const missionVoiceKeys = [
      nextMission.introAudio,
      ...nextMission.meet.flatMap((itemId) => [ITEMS[itemId].audio, ITEMS[itemId].successAudio]),
      ...nextMission.rounds.flatMap((roundData) => [
        roundData.audio,
        ITEMS[roundData.target].audio,
        ITEMS[roundData.target].successAudio,
      ]),
      ITEMS[nextMission.echo].audio,
      ITEMS[nextMission.echo].successAudio,
    ];
    void gameAudio.preload(missionVoiceKeys, { concurrency: 4 });
  }, [nextMission]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // Private browsing can prevent persistence; play remains available.
    }
  }, [progress]);

  useEffect(() => {
    // Map cards can sit below the fold. A screen change should still feel like
    // opening a fresh game scene instead of inheriting the map scroll position.
    window.scrollTo(0, 0);
  }, [screen, missionId]);

  useEffect(() => {
    setMusicAllowed(screen !== 'lesson');
  }, [screen, setMusicAllowed]);

  useEffect(() => {
    const offlineReady = () => setToast('✓ 声音和关卡已缓存，断网也能玩');
    const updateReady = () => setToast('✨ 新版本已准备好，下次打开自动更新');
    window.addEventListener('little-fox-offline-ready', offlineReady);
    window.addEventListener('little-fox-update-ready', updateReady);
    return () => {
      window.removeEventListener('little-fox-offline-ready', offlineReady);
      window.removeEventListener('little-fox-update-ready', updateReady);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const setAudioPreference = (nextAudioOn, { feedback = false } = {}) => {
    gameAudio.setEnabled(nextAudioOn);
    if (nextAudioOn) void unlock({ feedback });
    setProgress((value) => ({ ...value, audioOn: nextAudioOn }));
  };
  const toggleAudio = () => setAudioPreference(!progress.audioOn, { feedback: !progress.audioOn });

  const openMap = () => {
    setMusicAllowed(true);
    setScreen('map');
    void playSequence(['zh_welcome', 'welcome'], { feedback: true });
  };

  const startMission = (id) => {
    const mission = getMission(id);
    const firstIncomplete = MISSIONS.find((item) => !completedSet.has(item.id));
    const stageReady = mission ? getStageReadiness(progress, mission.stage).unlocked : false;
    const unlocked = completedSet.has(id) || (!firstIncomplete ? false : id === firstIncomplete.id && stageReady);
    if (!mission || !unlocked) {
      setToast(stageReady ? '🔒 先帮小狐完成前面的任务吧' : '🌱 先和小狐复习一个熟悉的声音吧');
      return;
    }
    if (!progress.audioOn) setToast('🔇 声音关闭：保留故事进度，但不记录听辨学习脚印');
    setProgress((value) => ({
      ...value,
      legacyUnlockedStage: Math.max(value.legacyUnlockedStage, mission.stage),
    }));
    setMusicAllowed(false);
    setMissionId(id);
    setScreen('lesson');
    void play(mission.introAudio, { feedback: true });
  };

  const recordExposureEvent = useCallback((evidence) => {
    setProgress((value) => (value.audioOn ? recordExposure(value, evidence) : value));
  }, []);

  const recordMasteryEvidenceEvent = useCallback((evidence) => {
    setProgress((value) => (value.audioOn ? recordMasteryEvidence(value, evidence) : value));
  }, []);

  const completeMission = (id) => {
    setProgress((value) => {
      if (value.completedIds.includes(id)) return { ...value, lastMissionId: id };
      return {
        ...value,
        completedIds: [...value.completedIds, id].sort((a, b) => a - b),
        lastMissionId: id,
      };
    });
  };

  const goMap = () => {
    stop();
    setMusicAllowed(true, { restart: true });
    setScreen('map');
    setMissionId(null);
  };

  return (
    <main className={`app-shell screen-${screen}`}>
      <SkyDecor />
      {screen === 'welcome' && (
        <WelcomeScreen
          nextMission={nextMission}
          reviewSuggestion={reviewSuggestion}
          completedCount={progress.completedIds.length}
          onStart={openMap}
          onParent={() => setParentGateOpen(true)}
          audioOn={progress.audioOn}
          onAudio={toggleAudio}
        />
      )}

      {screen === 'map' && (
        <MapScreen
          progress={progress}
          nextMission={nextMission}
          nextIncomplete={nextIncomplete}
          reviewSuggestion={reviewSuggestion}
          onMission={startMission}
          onCollection={() => setCollectionOpen(true)}
          onParent={() => setParentGateOpen(true)}
          onAudio={toggleAudio}
          onToast={setToast}
        />
      )}

      {screen === 'lesson' && activeMission && (
        <LessonScreen
          key={activeMission.id}
          mission={activeMission}
          play={play}
          playSequence={playSequence}
          onClose={goMap}
          onComplete={completeMission}
          onExposure={recordExposureEvent}
          onEvidence={recordMasteryEvidenceEvent}
          alreadyCompleted={completedSet.has(activeMission.id)}
        />
      )}

      {collectionOpen && (
        <CollectionModal completedIds={progress.completedIds} onClose={() => setCollectionOpen(false)} />
      )}
      {parentGateOpen && (
        <ParentGate
          onClose={() => setParentGateOpen(false)}
          onUnlock={() => {
            setParentGateOpen(false);
            setParentOpen(true);
          }}
        />
      )}
      {parentOpen && (
        <ParentPanel
          progress={progress}
          now={clock}
          setAudioOn={(audioOn) => setAudioPreference(audioOn, { feedback: audioOn })}
          onClose={() => setParentOpen(false)}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function SkyDecor() {
  return (
    <div className="sky-decor" aria-hidden="true">
      <span className="cloud cloud-one">☁</span>
      <span className="cloud cloud-two">☁</span>
      <span className="cloud cloud-three">☁</span>
      <span className="sun">☀</span>
      <span className="sparkle sparkle-one">✦</span>
      <span className="sparkle sparkle-two">✦</span>
    </div>
  );
}

function IconButton({ children, label, onClick, className = '' }) {
  return (
    <button className={`icon-button ${className}`} onClick={onClick} aria-label={label} type="button">
      {children}
    </button>
  );
}

function WelcomeScreen({ nextMission, reviewSuggestion, completedCount, onStart, onParent, audioOn, onAudio }) {
  const allDone = completedCount === MISSIONS.length;
  const startNote = reviewSuggestion
    ? `小狐想再听一次 ${ITEMS[reviewSuggestion.itemId].display}`
    : allDone
      ? '再去看看花园朋友'
      : `${nextMission.title}在等你`;
  return (
    <section className="welcome-screen page-pad">
      <header className="welcome-topbar">
        <div className="brand-pill"><span>🦊</span><b>小狐英语岛</b></div>
        <div className="top-actions">
          <IconButton label={audioOn ? '关闭声音' : '打开声音'} onClick={onAudio}>{audioOn ? '🔊' : '🔇'}</IconButton>
          <IconButton label="家长中心" onClick={onParent}>👨‍👩‍👧</IconButton>
        </div>
      </header>

      <div className="welcome-content">
        <div className="welcome-copy">
          <div className="eyebrow"><span>{allDone ? 'WOW' : 'NEW'}</span>{allDone ? ' 花园庆典已点亮' : ' 今天的小小冒险'}</div>
          <h1>和小狐一起<br /><em>听英语，去冒险！</em></h1>
          <p>听声音、看动作、动手帮助朋友。<br />不认识字，也能自己玩。</p>
          <button className="primary-cta" onClick={onStart} type="button" data-testid="welcome-start">
            <span className="cta-icon">▶</span>
            <span>
              <b>{completedCount ? '继续冒险' : '第一次出发'}</b>
              <small>{startNote}</small>
            </span>
            <span className="cta-arrow">›</span>
          </button>
          <div className="session-note"><span>🌱</span>每次玩 1 关 · 完成后自然休息</div>
        </div>

        <div className="welcome-art" aria-label="小狐在英语岛上挥手">
          <div className="rainbow">🌈</div>
          <div className="floating-word word-hello" lang="en">Hello!</div>
          <div className="floating-word word-play" lang="en">Let’s play!</div>
          <div className="hero-fox"><span>🦊</span><i>👋</i></div>
          <div className="hero-island"><span>🌳</span><span>🏡</span><span>🌼 🌷 🌼</span></div>
        </div>
      </div>
    </section>
  );
}

function MapScreen({ progress, nextMission, nextIncomplete, reviewSuggestion, onMission, onCollection, onParent, onAudio, onToast }) {
  const { completedIds, audioOn } = progress;
  const completedSet = useMemo(() => new Set(completedIds), [completedIds]);
  const nextStageUnlocked = getStageReadiness(progress, nextMission?.stage ?? 0).unlocked;
  const suggestedStage = nextStageUnlocked
    ? nextMission?.stage ?? 0
    : reviewSuggestion?.mission.stage ?? Math.max(0, (nextMission?.stage ?? 1) - 1);
  const [stageId, setStageId] = useState(suggestedStage);
  const stage = STAGES.find((item) => item.id === stageId) || STAGES[0];
  const stageMissions = MISSIONS.filter((mission) => mission.stage === stageId);
  const stageCompleted = stageMissions.filter((mission) => completedSet.has(mission.id)).length;
  const worldChanges = stageMissions.filter((mission) => completedSet.has(mission.id)).map((mission) => mission.worldEmoji);

  const missionStatus = (mission) => {
    if (completedSet.has(mission.id)) return 'done';
    if (mission.id === nextIncomplete?.id && getStageReadiness(progress, mission.stage).unlocked) return 'active';
    return 'locked';
  };

  const cardMission = reviewSuggestion?.mission || nextMission;
  const reviewItem = reviewSuggestion ? ITEMS[reviewSuggestion.itemId] : null;
  const cardKicker = reviewSuggestion
    ? reviewSuggestion.reason === 'stage-readiness'
      ? '再确认一个熟悉的声音，新世界就准备好了'
      : '到了自然复习的时间'
    : completedIds.length === MISSIONS.length
      ? '庆典已经点亮，随时可以重玩'
      : '下一件可以帮忙的事';

  return (
    <section className="map-screen page-pad">
      <header className="map-topbar">
        <div className="profile-chip"><span>🦊</span><div><b>小小探险家</b><small lang="en">HELLO ISLAND</small></div></div>
        <div className="world-progress" aria-label={`总进度 ${completedIds.length} / ${MISSIONS.length}`}>
          <span>冒险花园</span>
          <div className="progress-track"><i style={{ width: `${(completedIds.length / MISSIONS.length) * 100}%` }} /></div>
          <b>{completedIds.length} / {MISSIONS.length}</b>
        </div>
        <div className="map-actions">
          <div className="star-chip" aria-label={`${completedIds.length} 个故事纪念品`}>🌟 <b>{completedIds.length}</b></div>
          <IconButton label="收藏盒" onClick={onCollection}>🎒</IconButton>
          <IconButton label={audioOn ? '关闭声音' : '打开声音'} onClick={onAudio}>{audioOn ? '🔊' : '🔇'}</IconButton>
          <IconButton label="家长中心" onClick={onParent}>⚙️</IconButton>
        </div>
      </header>

      <div className="stage-tabs" role="tablist" aria-label="选择冒险世界">
        {STAGES.map((item) => {
          const unlocked = getStageReadiness(progress, item.id).unlocked;
          return (
            <button
              key={item.id}
              className={`${stageId === item.id ? 'is-current' : ''} ${unlocked ? '' : 'is-locked'}`}
              onClick={() => unlocked ? setStageId(item.id) : onToast('🌱 小狐想先复习几个熟悉的声音')}
              role="tab"
              aria-selected={stageId === item.id}
              aria-disabled={!unlocked}
              type="button"
            >
              <span>{item.icon}</span><b>{item.title}</b><small lang="en">{item.english}</small>
            </button>
          );
        })}
      </div>

      <section className={`world-board world-stage-${stageId}`} style={{ '--stage-color': stage.color }}>
        <header className="world-heading">
          <div><small>ADVENTURE WORLD {stageId + 1}</small><h2>{stage.icon} {stage.title}</h2><p>{stage.description}</p></div>
          <div className="stage-counter"><span>{stageCompleted}</span> / {stageMissions.length}<small>世界变化</small></div>
        </header>

        <div className="world-scenery" aria-hidden="true">
          <span className="scenery-ground">〰〰〰〰〰〰〰〰〰〰</span>
          <div className="world-change-row">
            {worldChanges.length ? worldChanges.map((change, index) => <span key={`${change}-${index}`}>{change}</span>) : <span className="empty-world">🌱 等你来唤醒这里</span>}
          </div>
        </div>

        <div className={`mission-grid ${stageId === 0 ? 'mission-grid-onboarding' : ''}`}>
          {stageMissions.map((mission) => {
            const status = missionStatus(mission);
            return (
              <button
                key={mission.id}
                className={`mission-card mission-${status}`}
                onClick={() => onMission(mission.id)}
                type="button"
                data-testid={`mission-${mission.id}`}
                aria-disabled={status === 'locked'}
                aria-label={`${mission.title}，${status === 'locked' ? '未解锁' : status === 'done' ? '已完成，可重玩' : '当前任务'}`}
              >
                {status === 'active' && <span className="mission-here">从这里开始</span>}
                <span className="mission-number">{mission.id}</span>
                <span className="mission-icon">{status === 'locked' ? '🔒' : mission.icon}</span>
                <span className="mission-copy"><b>{mission.title}</b><small lang="en">{mission.english}</small></span>
                {status === 'done' && <i className="mission-check">✓</i>}
              </button>
            );
          })}
        </div>
      </section>

      <div className={`next-mission-card ${reviewSuggestion ? 'is-review' : ''}`}>
        <div className="guide-face">🦊</div>
        <div className="next-copy"><small>{cardKicker}</small><b>{reviewItem ? `再听听 ${reviewItem.display}` : cardMission.title}</b><span>{reviewItem ? `回到「${cardMission.title}」换个场景试试` : cardMission.english}</span></div>
        <div className="mini-goals">{reviewSuggestion ? <><span>👂 再听</span><span>🖐️ 换场景</span><span>🌱 留下学习脚印</span></> : <><span>👂 听</span><span>🖐️ 玩</span><span>🌟 改变世界</span></>}</div>
        <button className="go-button" onClick={() => onMission(cardMission.id)} type="button" data-testid={reviewSuggestion ? 'review-start' : 'next-start'}>{reviewSuggestion ? '复习' : '出发'} <span>→</span></button>
      </div>
    </section>
  );
}

function LessonScreen({ mission, play, playSequence, onClose, onComplete, onExposure, onEvidence, alreadyCompleted }) {
  const [stepIndex, setStepIndex] = useState(0);
  const completionRecorded = useRef(false);
  const replayAtStart = useRef(alreadyCompleted).current;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stepIndex]);

  const goToMeet = () => {
    onExposure({ itemId: mission.meet[0], missionId: mission.id });
    setStepIndex(1);
    void playSequence(['zh_meet', ITEMS[mission.meet[0]].audio], { feedback: true });
  };
  const goToChallenge = () => {
    setStepIndex(2);
    void playSequence(['zh_listen_choose', mission.rounds[0].audio], { feedback: true });
  };
  const goToEcho = () => {
    setStepIndex(3);
    void play('zh_echo');
  };
  const goToReward = () => {
    if (!completionRecorded.current) {
      completionRecorded.current = true;
      onComplete(mission.id);
    }
    setStepIndex(4);
    void playSequence(['zh_reward', 'reward_done']);
  };

  return (
    <section className={`lesson-screen lesson-stage-${mission.stage}`}>
      <header className="lesson-topbar page-pad">
        <button className="back-button" onClick={onClose} type="button" aria-label="退出关卡">‹</button>
        <div className="lesson-title"><span>{mission.icon}</span><div><b>{mission.title}</b><small lang="en">{mission.english}</small></div></div>
        <div className="lesson-progress">
          {LESSON_STEPS.map((step, index) => (
            <div key={step.id} className={`${index < stepIndex ? 'is-done' : ''} ${index === stepIndex ? 'is-current' : ''}`}>
              <i>{index < stepIndex ? '✓' : step.icon}</i><span>{step.label}</span>
            </div>
          ))}
          <span className="lesson-progress-line"><i style={{ width: `${(stepIndex / (LESSON_STEPS.length - 1)) * 100}%` }} /></span>
        </div>
        <div className="lesson-count">{stepIndex + 1}<span> / {LESSON_STEPS.length}</span></div>
      </header>

      <div className="lesson-stage page-pad" key={stepIndex}>
        {stepIndex === 0 && <StoryStep mission={mission} play={play} onNext={goToMeet} />}
        {stepIndex === 1 && <MeetStep mission={mission} play={play} onExposure={onExposure} onNext={goToChallenge} />}
        {stepIndex === 2 && <ChallengeStep mission={mission} play={play} playSequence={playSequence} onEvidence={onEvidence} onNext={goToEcho} />}
        {stepIndex === 3 && <EchoStep mission={mission} play={play} onNext={goToReward} />}
        {stepIndex === 4 && <RewardStep mission={mission} onMap={onClose} replay={replayAtStart} />}
      </div>
    </section>
  );
}

function StoryStep({ mission, play, onNext }) {
  return (
    <div className="story-step">
      <div className="story-scene" aria-label={mission.storyGoal}>
        <div className="scene-sky">☁️　　☀️　　☁️</div>
        <div className="scene-emoji-row">{mission.scene.map((emoji, index) => <span key={`${emoji}-${index}`}>{emoji}</span>)}</div>
        <div className="scene-fox">🦊<i>✨</i></div>
        <div className="scene-ground">🌱　🌼　🌱　🌷　🌱</div>
      </div>
      <div className="story-panel">
        <span className="step-kicker">小狐需要你的帮助</span>
        <h2>{mission.storyGoal}</h2>
        <div className="guide-card">
          <span className="guide-character">🦊</span>
          <div><p lang="en">{VOICE_LINES[mission.introAudio].text}</p><button className="listen-button" onClick={() => void play(mission.introAudio, { feedback: true })} type="button" aria-label="再听一次">🔊</button></div>
        </div>
        <button className="primary-cta compact" onClick={onNext} type="button" data-testid="story-next">
          <span className="cta-icon">🖐️</span><span><b>我来帮忙！</b><small>Let’s go!</small></span><span className="cta-arrow">›</span>
        </button>
      </div>
    </div>
  );
}

function MeetStep({ mission, play, onExposure, onNext }) {
  const [touchesByItem, setTouchesByItem] = useState(() => Object.fromEntries(mission.meet.map((itemId) => [itemId, 0])));
  const [lastTouched, setLastTouched] = useState('');
  const [handTarget, setHandTarget] = useState('');
  const touchTimerRef = useRef(null);
  const guidanceTimersRef = useRef([]);
  const requiredPerItem = mission.meetRepeats;
  const totalRequired = mission.meet.length * requiredPerItem;
  const totalTouches = mission.meet.reduce((sum, itemId) => sum + Math.min(touchesByItem[itemId] || 0, requiredPerItem), 0);
  const nextItemId = mission.meet.find((itemId) => (touchesByItem[itemId] || 0) < requiredPerItem) || '';
  const nextItemTouches = nextItemId ? touchesByItem[nextItemId] || 0 : 0;
  const ready = totalTouches >= totalRequired;

  useEffect(() => {
    guidanceTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    guidanceTimersRef.current = [];
    if (ready || !nextItemId) return undefined;
    const handTimer = window.setTimeout(() => setHandTarget(nextItemId), 5500);
    const replayTimer = window.setTimeout(() => {
      onExposure({ itemId: nextItemId, missionId: mission.id });
      void play(ITEMS[nextItemId].audio);
    }, 5900);
    guidanceTimersRef.current = [handTimer, replayTimer];
    return () => {
      window.clearTimeout(handTimer);
      window.clearTimeout(replayTimer);
    };
  }, [mission.id, nextItemId, nextItemTouches, onExposure, play, ready]);

  useEffect(() => () => {
    window.clearTimeout(touchTimerRef.current);
    guidanceTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const touchItem = (itemId) => {
    const item = ITEMS[itemId];
    guidanceTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    guidanceTimersRef.current = [];
    setLastTouched(itemId);
    setHandTarget('');
    setTouchesByItem((value) => ({
      ...value,
      [itemId]: Math.min((value[itemId] || 0) + 1, requiredPerItem),
    }));
    onExposure({ itemId, missionId: mission.id });
    void play(item.audio, { feedback: true });
    window.clearTimeout(touchTimerRef.current);
    touchTimerRef.current = window.setTimeout(() => setLastTouched(''), 600);
  };

  return (
    <div className="meet-step">
      <header className="activity-title">
        <span className="step-kicker">点一点，听一听</span>
        <h2>小狐先带你认识它</h2>
        <div className="exposure-dots" aria-label={`已听 ${totalTouches} 次，共需要 ${totalRequired} 次`}>
          {Array.from({ length: totalRequired }, (_, index) => <i key={index} className={index < totalTouches ? 'is-on' : ''}>✦</i>)}
        </div>
      </header>
      <div className={`meet-items meet-count-${Math.min(mission.meet.length, 6)}`}>
        {mission.meet.map((itemId, index) => {
          const item = ITEMS[itemId];
          return (
            <button
              key={itemId}
              className={`meet-item item-${item.id} tone-${item.tone} size-${item.scale || 'normal'} ${lastTouched === itemId ? 'is-touched' : ''} ${(touchesByItem[itemId] || 0) >= requiredPerItem ? 'is-heard' : ''}`}
              onClick={() => touchItem(itemId)}
              type="button"
              data-testid={`meet-${itemId}`}
            >
              {handTarget === itemId && <span className="demo-hand">☝️</span>}
              <span>{item.emoji}</span><b lang="en">{item.display}</b><small>🔊</small>
            </button>
          );
        })}
      </div>
      <div className="meet-footer">
        {!ready && <div className="gentle-prompt">✨ 点一点击，再听听这个声音</div>}
        {ready && (
          <button className="primary-cta compact ready-pop" onClick={onNext} type="button" data-testid="meet-next">
            <span className="cta-icon">👂</span><span><b>我听见啦！</b><small>Now let’s play</small></span><span className="cta-arrow">›</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ChallengeStep({ mission, play, playSequence, onEvidence, onNext }) {
  const [roundIndex, setRoundIndex] = useState(0);
  const roundData = mission.rounds[roundIndex];
  const transitionTimerRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [roundIndex]);

  useEffect(() => () => window.clearTimeout(transitionTimerRef.current), []);

  const solved = () => {
    if (roundIndex === mission.rounds.length - 1) {
      onNext();
      return;
    }
    const nextIndex = roundIndex + 1;
    transitionTimerRef.current = window.setTimeout(() => {
      setRoundIndex(nextIndex);
      void play(mission.rounds[nextIndex].audio);
    }, 240);
  };

  return (
    <div className="challenge-step">
      <div className="round-dots" aria-label={`第 ${roundIndex + 1} 小步，共 ${mission.rounds.length} 小步`}>
        {mission.rounds.map((_, index) => <i key={index} className={index < roundIndex ? 'is-done' : index === roundIndex ? 'is-current' : ''} />)}
      </div>
      <ChallengeRound key={`${mission.id}-${roundIndex}`} mission={mission} round={roundData} roundIndex={roundIndex} play={play} playSequence={playSequence} onEvidence={onEvidence} onSolved={solved} />
    </div>
  );
}

function ChallengeRound({ mission, round, roundIndex, play, playSequence, onEvidence, onSolved }) {
  const [tries, setTries] = useState(0);
  const [hintLevel, setHintLevel] = useState(0);
  const [activityTick, setActivityTick] = useState(0);
  const [wrongChoice, setWrongChoice] = useState('');
  const [status, setStatus] = useState('ready');
  const [selectedResult, setSelectedResult] = useState(null);
  const timerRef = useRef(null);
  const wrongTimerRef = useRef(null);
  const evidenceRecordedRef = useRef(false);
  const finishingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const replayTimer = window.setTimeout(() => void play(round.audio), 8200);
    const motionTimer = window.setTimeout(() => setHintLevel(1), 11000);
    const spotlightTimer = window.setTimeout(() => setHintLevel(2), 14000);
    return () => {
      window.clearTimeout(replayTimer);
      window.clearTimeout(motionTimer);
      window.clearTimeout(spotlightTimer);
    };
  }, [activityTick, play, round.audio, status, tries]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timerRef.current);
      window.clearTimeout(wrongTimerRef.current);
    };
  }, []);

  const finish = (assisted = false, result = { attempts: tries, hintLevel }) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    if (!evidenceRecordedRef.current) {
      evidenceRecordedRef.current = true;
      onEvidence({
        itemIds: round.learningItems || [round.target],
        missionId: mission.id,
        roundIndex,
        mode: round.mode,
        choicesCount: round.choices.length,
        attempts: result.attempts,
        hintLevel: result.hintLevel,
        assisted,
      });
    }
    setStatus(assisted ? 'assisted' : 'success');
    setHintLevel(3);
    const actionSuccessAudio = {
      'forest-find': 'yes_find',
      'forest-give': 'yes_give',
      'forest-put': 'yes_put',
    }[round.mode];
    void play(actionSuccessAudio || ITEMS[round.target].successAudio, { feedback: true }).then(() => {
      if (!mountedRef.current) return;
      timerRef.current = window.setTimeout(onSolved, 180);
    });
  };

  const choose = (itemId) => {
    if (status !== 'ready') return;
    setActivityTick((value) => value + 1);
    if (itemId === round.target) {
      if (round.mode === 'forest-give' || round.mode === 'forest-put') {
        setSelectedResult({ attempts: tries, hintLevel });
        setStatus('placing');
        return;
      }
      finish(false, { attempts: tries, hintLevel });
      return;
    }
    const nextTries = tries + 1;
    setTries(nextTries);
    setWrongChoice(itemId);
    window.clearTimeout(wrongTimerRef.current);
    wrongTimerRef.current = window.setTimeout(() => setWrongChoice(''), 520);
    if (nextTries === 1) {
      setHintLevel(1);
      void playSequence(['zh_try_again', round.audio], { feedback: true });
    } else if (nextTries === 2) {
      setHintLevel(2);
      void play(round.audio, { feedback: true });
    } else {
      setStatus('helping');
      setHintLevel(3);
      void play('zh_together', { feedback: true }).then(() => {
        if (mountedRef.current) finish(true, { attempts: nextTries, hintLevel: 3 });
      });
    }
  };

  const finishPlacement = () => {
    if (status !== 'placing' || !selectedResult) return;
    finish(false, selectedResult);
  };

  return (
    <div className={`challenge-round mode-${round.mode} target-${round.target} hint-${hintLevel} status-${status}`}>
      <header className="activity-title">
        <span className="step-kicker">仔细听，小狐在说什么？</span>
        <h2 lang="en">{round.prompt}</h2>
        <button className="big-audio-button" onClick={() => { setActivityTick((value) => value + 1); void play(round.audio, { feedback: true }); }} type="button" disabled={status !== 'ready'}><span>🔊</span><b>再听一次</b></button>
      </header>

      <div className="challenge-scene">
        {round.mode === 'flashlight' && <div className="night-stars">✦　·　✧　·　✦</div>}
        {round.mode === 'gift' && <div className="scene-destination">🦊　🎁　🐰</div>}
        {round.mode === 'pack' && <div className="scene-destination">🧺</div>}
        {round.mode === 'drive' && <div className="scene-destination">〰️〰️🏁</div>}
        {round.mode === 'pour' && <div className="scene-destination">🐰　🥤</div>}
        {round.mode === 'forest-find' && <div className="scene-destination forest-destination">🌲　🍂　🔍</div>}
        {round.mode === 'forest-give' && <button className={`scene-destination forest-destination action-destination ${status === 'placing' ? 'is-ready' : ''}`} onClick={finishPlacement} type="button" aria-label="把宝物递给松鼠" disabled={status !== 'placing'}>🐿️　👐　🎒{status === 'placing' && <i>☝️</i>}</button>}
        {round.mode === 'forest-put' && <button className={`scene-destination forest-destination action-destination ${status === 'placing' ? 'is-ready' : ''}`} onClick={finishPlacement} type="button" aria-label="把宝物放进树洞" disabled={status !== 'placing'}>🌳　📥　✨{status === 'placing' && <i>☝️</i>}</button>}
        {round.mode === 'forest-action' && <div className="scene-destination forest-action-preview"><span>🦊</span><i>🍄　·　·　🛑</i></div>}
        {round.mode === 'forest-color' && <div className="scene-destination forest-destination">🌿　✨　🌿</div>}
        {round.mode === 'valley-color' && <div className="scene-destination valley-destination">🌈　✨　🎨</div>}
        {round.mode === 'valley-size' && <div className="scene-destination valley-destination">●　✨　•</div>}
        <div className={`choice-row choice-count-${round.choices.length}`} role="group" aria-label="听声音选择">
          {round.choices.map((itemId) => {
            const item = ITEMS[itemId];
            const isTarget = itemId === round.target;
            return (
              <button
                key={itemId}
                className={`choice-card item-${item.id} tone-${item.tone} size-${item.scale || 'normal'} ${wrongChoice === itemId ? 'is-wrong' : ''} ${isTarget && hintLevel >= 1 ? 'is-hint' : ''} ${isTarget && status === 'placing' ? 'is-selected' : ''} ${isTarget && (status === 'success' || status === 'assisted') ? 'is-correct' : ''}`}
                onClick={() => choose(itemId)}
                type="button"
                data-testid={`choice-${itemId}`}
              >
                {round.mode === 'reveal' && <span className="cover-emoji">🌿</span>}
                {round.mode === 'hide' && <span className="cover-emoji">🎁</span>}
                <span className="choice-emoji">{item.emoji}</span>
                <b lang="en">{item.label}</b>
                {isTarget && hintLevel >= 2 && <i className="hint-hand">☝️</i>}
                {isTarget && (status === 'success' || status === 'assisted') && <i className="correct-star">★</i>}
              </button>
            );
          })}
        </div>
        {status === 'helping' && <div className="assisted-path">🦊 · · · ☝️ 一起完成</div>}
      </div>
      <div className="kind-hint">{status === 'placing' ? '✨ 再点一下上面的朋友或树洞，完成动作' : '💛 点错没关系，小狐会一步一步来帮忙'}</div>
    </div>
  );
}

function EchoStep({ mission, play, onNext }) {
  const item = ITEMS[mission.echo];
  const [heard, setHeard] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const listenTokenRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const listen = () => {
    const token = listenTokenRef.current + 1;
    listenTokenRef.current = token;
    setHeard(true);
    setIsPlaying(true);
    void play(item.audio, { feedback: true }).finally(() => {
      if (mountedRef.current && token === listenTokenRef.current) setIsPlaying(false);
    });
  };
  const finish = (saidIt) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    listenTokenRef.current += 1;
    setFinishing(true);
    setIsPlaying(false);
    if (saidIt) {
      void play(item.successAudio, { feedback: true }).then(() => {
        if (mountedRef.current) onNext();
      });
    } else {
      onNext();
    }
  };

  return (
    <div className="echo-step">
      <div className="echo-visual">
        <span className="echo-fox">🦊</span>
        <div className={`sound-waves ${isPlaying ? 'is-playing' : ''}`}><i /><i /><i /><i /><i /><i /><i /></div>
        <div className={`echo-word-card item-${item.id} tone-${item.tone} size-${item.scale || 'normal'}`}><span>{item.emoji}</span><b lang="en">{item.display}</b></div>
      </div>
      <div className="echo-panel">
        <span className="step-kicker">想说就说，不说也能继续</span>
        <h2 lang="en">{item.display}</h2>
        <p>先听小狐说一遍，你愿意的话也可以跟着说。</p>
        <button className="record-button" onClick={listen} type="button"><span>🔊</span><b>先听一遍</b><small>Tap to listen</small></button>
        <div className={`echo-actions ${heard ? 'is-ready' : ''}`}>
          <button onClick={() => finish(true)} type="button" disabled={finishing}><span>🎙️</span><b>我说好啦</b></button>
          <button onClick={() => finish(false)} type="button" disabled={finishing}><span>👋</span><b>这次先听</b></button>
        </div>
        <p className="privacy-note">🔒 不录音、不评分，开口永远不是通关门槛</p>
      </div>
    </div>
  );
}

function RewardStep({ mission, onMap, replay }) {
  return (
    <div className="reward-step">
      <div className="confetti" aria-hidden="true"><i>●</i><i>★</i><i>◆</i><i>●</i><i>★</i><i>◆</i><i>●</i></div>
      <span className="reward-kicker">MISSION COMPLETE</span>
      <h2>{mission.title}完成！</h2>
      <div className="world-change-card"><span>{mission.worldEmoji}</span><div><small>你让世界发生了变化</small><b>{mission.worldChange}</b></div></div>
      <div className="reward-badge"><span className="badge-rays" /><div>{mission.keepsake.emoji}</div><b>{mission.keepsake.title}</b><small>{replay ? '再次完成故事' : '新的故事纪念品'}</small></div>
      <div className="offline-mission"><span>🏠</span><div><small>离开屏幕也能玩</small><b>{mission.familyQuest}</b></div></div>
      <button className="primary-cta reward-cta" onClick={onMap} type="button" data-testid="reward-map"><span className="cta-icon">🗺️</span><span><b>回到冒险地图</b><small>今天可以在这里休息</small></span><span className="cta-arrow">›</span></button>
    </div>
  );
}

function Modal({ children, onClose, className = '', label = '弹窗' }) {
  const cardRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusable = [...cardRef.current.querySelectorAll('button:not(:disabled), [href], input, [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus?.();
    };
  }, []);

  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={cardRef} className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        <button ref={closeRef} className="modal-close" onClick={onClose} type="button" aria-label="关闭">×</button>
        {children}
      </section>
    </div>
  );
}

function CollectionModal({ completedIds, onClose }) {
  const completedSet = new Set(completedIds);
  return (
    <Modal onClose={onClose} className="collection-modal" label="我的冒险收藏盒">
      <span className="modal-kicker">MY STORY BOX</span>
      <h2>我的冒险收藏盒</h2>
      <p>每个纪念品都来自一次真正帮到朋友的故事。</p>
      <div className="badge-grid">
        {MISSIONS.map((mission) => {
          const earned = completedSet.has(mission.id);
          return (
            <div key={mission.id} className={`collection-badge ${earned ? 'earned' : ''}`}>
              <span>{earned ? mission.keepsake.emoji : '🔒'}</span><b>{earned ? mission.keepsake.title : '等待发现'}</b><small>{earned ? mission.title : `完成第 ${mission.id} 关`}</small>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function ParentGate({ onClose, onUnlock }) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState(false);
  const submit = () => {
    if (answer === '5') onUnlock();
    else {
      setError(true);
      setAnswer('');
    }
  };
  return (
    <Modal onClose={onClose} className="parent-gate-modal" label="家长验证">
      <span className="parent-icon">👨‍👩‍👧</span><span className="modal-kicker">FOR GROWN-UPS</span>
      <h2>请家长来回答</h2><p>这是家长专属区域</p>
      <div className={`math-question ${error ? 'is-error' : ''}`}><b>2 + 3 =</b><span>{answer || '?'}</span></div>
      <div className="number-pad">{[2, 5, 8].map((number) => <button key={number} onClick={() => { setAnswer(String(number)); setError(false); }} type="button">{number}</button>)}</div>
      <button className="gate-submit" onClick={submit} disabled={!answer} type="button">进入家长中心</button>
    </Modal>
  );
}

function ParentPanel({ progress, now, setAudioOn, onClose }) {
  const { completedIds, lastMissionId, audioOn } = progress;
  const completedCount = completedIds.length;
  const lastMission = getMission(lastMissionId) || MISSIONS[0];
  const knownItems = Object.values(ITEMS)
    .map((item) => ({ id: item.id, title: item.display, state: getLearningState(progress, item.id) }))
    .filter((item) => item.state.status !== 'unseen');
  const independentlyRecognized = knownItems.filter((item) => item.state.rank >= LEARNING_STATUS.recognized.rank).length;
  const reviewQueue = getReviewQueue(progress, now);
  const reviewIds = new Set(reviewQueue.map((item) => item.itemId));

  return (
    <Modal onClose={onClose} className="parent-panel-modal" label="孩子的学习脚印">
      <header className="parent-header"><div><span className="modal-kicker">PARENT DASHBOARD</span><h2>孩子的学习脚印</h2></div><span className="date-pill">本机证据 · 不上传</span></header>
      <div className="parent-stats">
        <div><span>🗺️</span><b>{completedCount}</b><small>完成故事</small></div>
        <div><span>👂</span><b>{independentlyRecognized}</b><small>独立辨认</small></div>
        <div><span>🌱</span><b>{reviewQueue.length}</b><small>现在适合复习</small></div>
      </div>
      <section className="learning-report">
        <div className="report-title"><b>每个声音的掌握状态</b><span>完成故事不直接等于学会</span></div>
        {knownItems.length ? knownItems.map((item) => (
          <div className={`skill-row status-${item.state.status}`} key={item.id}><span className={`skill-icon status-${item.state.status}`}>{item.state.icon}</span><div><b lang="en">{item.title}</b><small>{item.state.label}</small></div><i>{reviewIds.has(item.id) ? '现在适合换场景再听' : item.state.needsSupport ? '已排入稍后复习' : '继续自然复现'}</i></div>
        )) : <div className="empty-report">完成第一关后，这里会出现孩子听懂过的声音。</div>}
      </section>
      <section className="parent-tip"><span>💡</span><div><b>今晚这样玩</b><p>{completedCount ? lastMission.familyQuest : '见到孩子时挥挥手，说一次 “Hello!”；愿意看向你就已经很好。'}</p></div></section>
      <div className="parent-settings"><span><b>游戏声音</b><small>A 女声 · lovely_girl · MiniMax Speech 2.8 HD</small></span><button className={`toggle ${audioOn ? 'is-on' : ''}`} onClick={() => setAudioOn(!audioOn)} type="button" aria-label="切换游戏声音" aria-pressed={audioOn}><i /></button></div>
      <p className="ai-disclosure">角色语音由 AI 合成；关闭声音时仍可完成故事，但不会形成听辨证据。App 不使用麦克风，不收集儿童声音或学习数据。</p>
    </Modal>
  );
}
