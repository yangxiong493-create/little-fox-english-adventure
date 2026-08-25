import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ITEMS, MISSIONS, STAGES, VOICE_LINES, getMission, getVoiceText } from './gameData.js';
import './styles.css';

const LESSON_STEPS = [
  { id: 'story', label: '看故事', icon: '✨' },
  { id: 'meet', label: '认识它', icon: '👀' },
  { id: 'play', label: '帮帮忙', icon: '🖐️' },
  { id: 'echo', label: '一起说', icon: '🎙️' },
  { id: 'reward', label: '世界变了', icon: '🌟' },
];

const PROGRESS_STORAGE_KEY = 'little-fox-progress-v2';

function readSavedProgress() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}');
    const completedIds = Array.isArray(saved.completedIds)
      ? [...new Set(saved.completedIds.filter((id) => Number.isInteger(id) && id >= 1 && id <= MISSIONS.length))]
      : [];
    return {
      completedIds,
      lastMissionId: Number.isInteger(saved.lastMissionId) ? saved.lastMissionId : null,
      audioOn: saved.audioOn !== false,
    };
  } catch {
    return { completedIds: [], lastMissionId: null, audioOn: true };
  }
}

function fallbackSpeak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.82;
  utterance.pitch = 1.08;
  window.speechSynthesis.speak(utterance);
}

function useGameAudio(audioOn) {
  const audioRef = useRef(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    window.speechSynthesis?.cancel();
  }, []);

  const play = useCallback((key) => {
    if (!audioOn || !key) return;
    const text = getVoiceText(key);
    stop();
    const player = audioRef.current || new Audio();
    audioRef.current = player;
    player.preload = 'auto';
    player.src = `${import.meta.env.BASE_URL}audio/voice/${key}.mp3`;
    const promise = player.play();
    if (promise?.catch) promise.catch(() => fallbackSpeak(text));
  }, [audioOn, stop]);

  useEffect(() => {
    if (!audioOn) stop();
  }, [audioOn, stop]);

  useEffect(() => stop, [stop]);
  return { play, stop };
}

function App() {
  const initialProgress = useMemo(readSavedProgress, []);
  const [progress, setProgress] = useState(initialProgress);
  const [screen, setScreen] = useState('welcome');
  const [missionId, setMissionId] = useState(null);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [parentGateOpen, setParentGateOpen] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [toast, setToast] = useState('');
  const { play, stop } = useGameAudio(progress.audioOn);

  const completedSet = useMemo(() => new Set(progress.completedIds), [progress.completedIds]);
  const nextMission = MISSIONS.find((mission) => !completedSet.has(mission.id)) || MISSIONS.at(-1);
  const activeMission = missionId ? getMission(missionId) : null;

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

  const toggleAudio = () => setProgress((value) => ({ ...value, audioOn: !value.audioOn }));

  const openMap = () => {
    setScreen('map');
    play('welcome');
  };

  const startMission = (id) => {
    const mission = getMission(id);
    const firstIncomplete = MISSIONS.find((item) => !completedSet.has(item.id));
    const unlocked = completedSet.has(id) || !firstIncomplete || id === firstIncomplete.id;
    if (!mission || !unlocked) {
      setToast('🔒 先帮小狐完成前面的任务吧');
      return;
    }
    setMissionId(id);
    setScreen('lesson');
    play(mission.introAudio);
  };

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
    setScreen('map');
    setMissionId(null);
  };

  return (
    <main className={`app-shell screen-${screen}`}>
      <SkyDecor />
      {screen === 'welcome' && (
        <WelcomeScreen
          nextMission={nextMission}
          completedCount={progress.completedIds.length}
          onStart={openMap}
          onParent={() => setParentGateOpen(true)}
          audioOn={progress.audioOn}
          onAudio={toggleAudio}
        />
      )}

      {screen === 'map' && (
        <MapScreen
          completedIds={progress.completedIds}
          nextMission={nextMission}
          onMission={startMission}
          onCollection={() => setCollectionOpen(true)}
          onParent={() => setParentGateOpen(true)}
          audioOn={progress.audioOn}
          onAudio={toggleAudio}
          onToast={setToast}
        />
      )}

      {screen === 'lesson' && activeMission && (
        <LessonScreen
          key={activeMission.id}
          mission={activeMission}
          play={play}
          onClose={goMap}
          onComplete={completeMission}
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
          completedIds={progress.completedIds}
          lastMissionId={progress.lastMissionId}
          audioOn={progress.audioOn}
          setAudioOn={(audioOn) => setProgress((value) => ({ ...value, audioOn }))}
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

function WelcomeScreen({ nextMission, completedCount, onStart, onParent, audioOn, onAudio }) {
  const allDone = completedCount === MISSIONS.length;
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
              <small>{allDone ? '再去看看花园朋友' : `${nextMission.title}在等你`}</small>
            </span>
            <span className="cta-arrow">›</span>
          </button>
          <div className="session-note"><span>🌱</span>每次玩 1 关 · 完成后自然休息</div>
        </div>

        <div className="welcome-art" aria-label="小狐在英语岛上挥手">
          <div className="rainbow">🌈</div>
          <div className="floating-word word-hello">Hello!</div>
          <div className="floating-word word-play">Let’s play!</div>
          <div className="hero-fox"><span>🦊</span><i>👋</i></div>
          <div className="hero-island"><span>🌳</span><span>🏡</span><span>🌼 🌷 🌼</span></div>
        </div>
      </div>
    </section>
  );
}

function MapScreen({ completedIds, nextMission, onMission, onCollection, onParent, audioOn, onAudio, onToast }) {
  const completedSet = useMemo(() => new Set(completedIds), [completedIds]);
  const suggestedStage = nextMission?.stage ?? 1;
  const [stageId, setStageId] = useState(suggestedStage);
  const stage = STAGES.find((item) => item.id === stageId) || STAGES[0];
  const stageMissions = MISSIONS.filter((mission) => mission.stage === stageId);
  const stageCompleted = stageMissions.filter((mission) => completedSet.has(mission.id)).length;
  const worldChanges = stageMissions.filter((mission) => completedSet.has(mission.id)).map((mission) => mission.worldEmoji);

  const missionStatus = (mission) => {
    if (completedSet.has(mission.id)) return 'done';
    if (mission.id === nextMission.id) return 'active';
    return 'locked';
  };

  return (
    <section className="map-screen page-pad">
      <header className="map-topbar">
        <div className="profile-chip"><span>🦊</span><div><b>小小探险家</b><small>HELLO ISLAND</small></div></div>
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
          const firstMission = MISSIONS.find((mission) => mission.stage === item.id);
          const unlocked = item.id === 0 || completedIds.includes(firstMission.id) || nextMission.stage === item.id;
          return (
            <button
              key={item.id}
              className={`${stageId === item.id ? 'is-current' : ''} ${unlocked ? '' : 'is-locked'}`}
              onClick={() => unlocked ? setStageId(item.id) : onToast('🔒 先完成小狐之家的任务吧')}
              role="tab"
              aria-selected={stageId === item.id}
              type="button"
            >
              <span>{item.icon}</span><b>{item.title}</b><small>{item.english}</small>
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
                aria-label={`${mission.title}，${status === 'locked' ? '未解锁' : status === 'done' ? '已完成，可重玩' : '当前任务'}`}
              >
                {status === 'active' && <span className="mission-here">从这里开始</span>}
                <span className="mission-number">{mission.id}</span>
                <span className="mission-icon">{status === 'locked' ? '🔒' : mission.icon}</span>
                <span className="mission-copy"><b>{mission.title}</b><small>{mission.english}</small></span>
                {status === 'done' && <i className="mission-check">✓</i>}
              </button>
            );
          })}
        </div>
      </section>

      <div className="next-mission-card">
        <div className="guide-face">🦊</div>
        <div className="next-copy"><small>{completedIds.length === MISSIONS.length ? '庆典已经点亮，随时可以重玩' : '下一件可以帮忙的事'}</small><b>{nextMission.title}</b><span>{nextMission.english}</span></div>
        <div className="mini-goals"><span>👂 听</span><span>🖐️ 玩</span><span>🌟 改变世界</span></div>
        <button className="go-button" onClick={() => onMission(nextMission.id)} type="button">出发 <span>→</span></button>
      </div>
    </section>
  );
}

function LessonScreen({ mission, play, onClose, onComplete, alreadyCompleted }) {
  const [stepIndex, setStepIndex] = useState(0);
  const completionRecorded = useRef(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stepIndex]);

  const goToMeet = () => {
    play(ITEMS[mission.meet[0]].audio);
    setStepIndex(1);
  };
  const goToChallenge = () => {
    play(mission.rounds[0].audio);
    setStepIndex(2);
  };
  const goToEcho = () => {
    play('guide_say');
    setStepIndex(3);
  };
  const goToReward = () => {
    if (!completionRecorded.current) {
      completionRecorded.current = true;
      onComplete(mission.id);
    }
    play('reward_done');
    setStepIndex(4);
  };

  return (
    <section className={`lesson-screen lesson-stage-${mission.stage}`}>
      <header className="lesson-topbar page-pad">
        <button className="back-button" onClick={onClose} type="button" aria-label="退出关卡">‹</button>
        <div className="lesson-title"><span>{mission.icon}</span><div><b>{mission.title}</b><small>{mission.english}</small></div></div>
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
        {stepIndex === 1 && <MeetStep mission={mission} play={play} onNext={goToChallenge} />}
        {stepIndex === 2 && <ChallengeStep mission={mission} play={play} onNext={goToEcho} />}
        {stepIndex === 3 && <EchoStep mission={mission} play={play} onNext={goToReward} />}
        {stepIndex === 4 && <RewardStep mission={mission} onMap={onClose} replay={alreadyCompleted} />}
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
          <div><p>{VOICE_LINES[mission.introAudio].text}</p><button className="listen-button" onClick={() => play(mission.introAudio)} type="button" aria-label="再听一次">🔊</button></div>
        </div>
        <button className="primary-cta compact" onClick={onNext} type="button" data-testid="story-next">
          <span className="cta-icon">🖐️</span><span><b>我来帮忙！</b><small>Let’s go!</small></span><span className="cta-arrow">›</span>
        </button>
      </div>
    </div>
  );
}

function MeetStep({ mission, play, onNext }) {
  const [touches, setTouches] = useState(0);
  const [lastTouched, setLastTouched] = useState('');
  const [showHand, setShowHand] = useState(false);
  const requiredTouches = mission.meetRepeats;
  const ready = touches >= requiredTouches;

  useEffect(() => {
    const handTimer = window.setTimeout(() => setShowHand(true), 3200);
    const replayTimer = window.setTimeout(() => play(ITEMS[mission.meet[0]].audio), 3600);
    return () => {
      window.clearTimeout(handTimer);
      window.clearTimeout(replayTimer);
    };
  }, [mission, play]);

  const touchItem = (itemId) => {
    const item = ITEMS[itemId];
    setLastTouched(itemId);
    setShowHand(false);
    setTouches((value) => Math.min(value + 1, requiredTouches));
    play(item.audio);
    window.setTimeout(() => setLastTouched(''), 600);
  };

  return (
    <div className="meet-step">
      <header className="activity-title">
        <span className="step-kicker">点一点，听一听</span>
        <h2>小狐先带你认识它</h2>
        <div className="exposure-dots" aria-label={`已听 ${Math.min(touches, requiredTouches)} 次`}>
          {Array.from({ length: requiredTouches }, (_, index) => <i key={index} className={index < touches ? 'is-on' : ''}>✦</i>)}
        </div>
      </header>
      <div className={`meet-items meet-count-${Math.min(mission.meet.length, 6)}`}>
        {mission.meet.map((itemId, index) => {
          const item = ITEMS[itemId];
          return (
            <button
              key={itemId}
              className={`meet-item tone-${item.tone} ${lastTouched === itemId ? 'is-touched' : ''}`}
              onClick={() => touchItem(itemId)}
              type="button"
              data-testid={`meet-${itemId}`}
            >
              {showHand && index === 0 && <span className="demo-hand">☝️</span>}
              <span>{item.emoji}</span><b>{item.display}</b><small>🔊</small>
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

function ChallengeStep({ mission, play, onNext }) {
  const [roundIndex, setRoundIndex] = useState(0);
  const roundData = mission.rounds[roundIndex];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [roundIndex]);

  const solved = () => {
    if (roundIndex === mission.rounds.length - 1) {
      onNext();
      return;
    }
    const nextIndex = roundIndex + 1;
    window.setTimeout(() => {
      setRoundIndex(nextIndex);
      play(mission.rounds[nextIndex].audio);
    }, 750);
  };

  return (
    <div className="challenge-step">
      <div className="round-dots" aria-label={`第 ${roundIndex + 1} 小步，共 ${mission.rounds.length} 小步`}>
        {mission.rounds.map((_, index) => <i key={index} className={index < roundIndex ? 'is-done' : index === roundIndex ? 'is-current' : ''} />)}
      </div>
      <ChallengeRound key={`${mission.id}-${roundIndex}`} mission={mission} round={roundData} play={play} onSolved={solved} />
    </div>
  );
}

function ChallengeRound({ mission, round, play, onSolved }) {
  const [tries, setTries] = useState(0);
  const [hintLevel, setHintLevel] = useState(0);
  const [wrongChoice, setWrongChoice] = useState('');
  const [status, setStatus] = useState('ready');
  const timerRef = useRef(null);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const replayTimer = window.setTimeout(() => play(round.audio), 3500);
    const motionTimer = window.setTimeout(() => setHintLevel(1), 6500);
    const spotlightTimer = window.setTimeout(() => setHintLevel(2), 10000);
    return () => {
      window.clearTimeout(replayTimer);
      window.clearTimeout(motionTimer);
      window.clearTimeout(spotlightTimer);
    };
  }, [play, round.audio, status]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const finish = (assisted = false) => {
    setStatus(assisted ? 'assisted' : 'success');
    setHintLevel(3);
    play(ITEMS[round.target].successAudio);
    timerRef.current = window.setTimeout(onSolved, 950);
  };

  const choose = (itemId) => {
    if (status !== 'ready') return;
    if (itemId === round.target) {
      finish(false);
      return;
    }
    const nextTries = tries + 1;
    setTries(nextTries);
    setWrongChoice(itemId);
    window.setTimeout(() => setWrongChoice(''), 520);
    if (nextTries === 1) {
      setHintLevel(1);
      play('guide_again');
    } else if (nextTries === 2) {
      setHintLevel(2);
      play(round.audio);
    } else {
      setStatus('helping');
      setHintLevel(3);
      play('guide_together');
      timerRef.current = window.setTimeout(() => finish(true), 1050);
    }
  };

  return (
    <div className={`challenge-round mode-${round.mode} hint-${hintLevel} status-${status}`}>
      <header className="activity-title">
        <span className="step-kicker">仔细听，小狐在说什么？</span>
        <h2>{round.prompt}</h2>
        <button className="big-audio-button" onClick={() => play(round.audio)} type="button"><span>🔊</span><b>再听一次</b></button>
      </header>

      <div className="challenge-scene">
        {round.mode === 'flashlight' && <div className="night-stars">✦　·　✧　·　✦</div>}
        {round.mode === 'gift' && <div className="scene-destination">🦊　🎁　🐰</div>}
        {round.mode === 'pack' && <div className="scene-destination">🧺</div>}
        {round.mode === 'drive' && <div className="scene-destination">〰️〰️🏁</div>}
        {round.mode === 'pour' && <div className="scene-destination">🐰　🥤</div>}
        <div className={`choice-row choice-count-${round.choices.length}`} role="group" aria-label="听声音选择">
          {round.choices.map((itemId) => {
            const item = ITEMS[itemId];
            const isTarget = itemId === round.target;
            return (
              <button
                key={itemId}
                className={`choice-card tone-${item.tone} ${wrongChoice === itemId ? 'is-wrong' : ''} ${isTarget && hintLevel >= 1 ? 'is-hint' : ''} ${isTarget && status !== 'ready' && status !== 'helping' ? 'is-correct' : ''}`}
                onClick={() => choose(itemId)}
                type="button"
                data-testid={`choice-${itemId}`}
              >
                {round.mode === 'reveal' && <span className="cover-emoji">🌿</span>}
                {round.mode === 'hide' && <span className="cover-emoji">🎁</span>}
                <span className="choice-emoji">{item.emoji}</span>
                <b>{item.label}</b>
                {isTarget && hintLevel >= 2 && <i className="hint-hand">☝️</i>}
                {isTarget && status !== 'ready' && status !== 'helping' && <i className="correct-star">★</i>}
              </button>
            );
          })}
        </div>
        {status === 'helping' && <div className="assisted-path">🦊 · · · ☝️ 一起完成</div>}
      </div>
      <div className="kind-hint">💛 点错没关系，小狐会一步一步来帮忙</div>
    </div>
  );
}

function EchoStep({ mission, play, onNext }) {
  const item = ITEMS[mission.echo];
  const [heard, setHeard] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const listen = () => {
    setHeard(true);
    play(item.audio);
  };
  const finish = (saidIt) => {
    if (finishing) return;
    setFinishing(true);
    if (saidIt) {
      play(item.successAudio);
      window.setTimeout(onNext, 850);
    } else {
      onNext();
    }
  };

  return (
    <div className="echo-step">
      <div className="echo-visual">
        <span className="echo-fox">🦊</span>
        <div className={`sound-waves ${heard ? 'is-playing' : ''}`}><i /><i /><i /><i /><i /><i /><i /></div>
        <div className={`echo-word-card tone-${item.tone}`}><span>{item.emoji}</span><b>{item.display}</b></div>
      </div>
      <div className="echo-panel">
        <span className="step-kicker">想说就说，不说也能继续</span>
        <h2>{item.display}</h2>
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

function Modal({ children, onClose, className = '' }) {
  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-card ${className}`} role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} type="button" aria-label="关闭">×</button>
        {children}
      </section>
    </div>
  );
}

function CollectionModal({ completedIds, onClose }) {
  const completedSet = new Set(completedIds);
  return (
    <Modal onClose={onClose} className="collection-modal">
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
    <Modal onClose={onClose} className="parent-gate-modal">
      <span className="parent-icon">👨‍👩‍👧</span><span className="modal-kicker">FOR GROWN-UPS</span>
      <h2>请家长来回答</h2><p>这是家长专属区域</p>
      <div className={`math-question ${error ? 'is-error' : ''}`}><b>2 + 3 =</b><span>{answer || '?'}</span></div>
      <div className="number-pad">{[2, 5, 8].map((number) => <button key={number} onClick={() => { setAnswer(String(number)); setError(false); }} type="button">{number}</button>)}</div>
      <button className="gate-submit" onClick={submit} disabled={!answer} type="button">进入家长中心</button>
    </Modal>
  );
}

function ParentPanel({ completedIds, lastMissionId, audioOn, setAudioOn, onClose }) {
  const completedCount = completedIds.length;
  const lastMission = getMission(lastMissionId) || MISSIONS[0];
  const learningItems = [
    { id: 'hello', title: 'Hello!', mission: 1 },
    { id: 'bye', title: 'Bye-bye!', mission: 3 },
    { id: 'apple', title: 'apple', mission: 4 },
    { id: 'ball', title: 'ball', mission: 5 },
    { id: 'cat', title: 'cat', mission: 7 },
    { id: 'dog', title: 'dog', mission: 8 },
    { id: 'car', title: 'car', mission: 10 },
    { id: 'milk', title: 'milk', mission: 11 },
  ];
  const knownItems = learningItems.filter((item) => completedIds.includes(item.mission));

  return (
    <Modal onClose={onClose} className="parent-panel-modal">
      <header className="parent-header"><div><span className="modal-kicker">PARENT DASHBOARD</span><h2>孩子的冒险小结</h2></div><span className="date-pill">本机记录 · 不上传</span></header>
      <div className="parent-stats">
        <div><span>🗺️</span><b>{completedCount}</b><small>完成故事</small></div>
        <div><span>🎒</span><b>{completedCount}</b><small>故事纪念品</small></div>
        <div><span>🌱</span><b>{completedCount} / {MISSIONS.length}</b><small>第一版进度</small></div>
      </div>
      <section className="learning-report">
        <div className="report-title"><b>已经在故事里遇见</b><span>不是考试分数</span></div>
        {knownItems.length ? knownItems.map((item) => (
          <div className="skill-row" key={item.id}><span className="skill-icon mastered">✓</span><div><b>{item.title}</b><small>已在可理解情境中听到并行动</small></div><i>继续自然复习</i></div>
        )) : <div className="empty-report">完成第一关后，这里会出现孩子听懂过的声音。</div>}
      </section>
      <section className="parent-tip"><span>💡</span><div><b>今晚这样玩</b><p>{completedCount ? lastMission.familyQuest : '见到孩子时挥挥手，说一次 “Hello!”；愿意看向你就已经很好。'}</p></div></section>
      <div className="parent-settings"><span><b>游戏声音</b><small>A 女声 · lovely_girl · MiniMax Speech 2.8 HD</small></span><button className={`toggle ${audioOn ? 'is-on' : ''}`} onClick={() => setAudioOn(!audioOn)} type="button" aria-label="切换游戏声音"><i /></button></div>
      <p className="ai-disclosure">角色语音由 AI 合成；App 不使用麦克风，不收集儿童声音或学习数据。</p>
    </Modal>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>,
);

async function registerPwa() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
    if (registration.waiting) window.dispatchEvent(new Event('little-fox-update-ready'));
    const watchWorker = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && hadController) window.dispatchEvent(new Event('little-fox-update-ready'));
      });
    };
    watchWorker(registration.installing);
    registration.addEventListener('updatefound', () => watchWorker(registration.installing));
    if (!hadController) {
      await navigator.serviceWorker.ready;
      window.dispatchEvent(new Event('little-fox-offline-ready'));
    }
    window.setInterval(() => registration.update(), 60 * 60 * 1000);
  } catch {
    // Online play remains available if installation is blocked.
  }
}

window.addEventListener('load', registerPwa);
