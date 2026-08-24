import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const lessonSteps = [
  { id: 'story', label: '听故事', icon: '✨' },
  { id: 'listen', label: '找一找', icon: '👂' },
  { id: 'drag', label: '帮帮忙', icon: '🖐️' },
  { id: 'speak', label: '说一说', icon: '🎙️' },
  { id: 'reward', label: '得奖励', icon: '⭐' },
];

const mapMissions = [
  { id: 1, title: 'Hello 小屋', english: 'Hello!', icon: '🏡', status: 'done', x: 13, y: 66 },
  { id: 2, title: '红苹果小径', english: 'Red apple', icon: '🍎', status: 'active', x: 31, y: 46 },
  { id: 3, title: '蓝色小桥', english: 'Blue bridge', icon: '🌉', status: 'locked', x: 49, y: 62 },
  { id: 4, title: '动物花园', english: 'Hello, cat!', icon: '🐱', status: 'locked', x: 66, y: 38 },
  { id: 5, title: '野餐草地', english: 'I want milk', icon: '🧺', status: 'locked', x: 81, y: 58 },
  { id: 6, title: '彩虹灯塔', english: 'Boss review', icon: '🌈', status: 'locked', x: 91, y: 25 },
];

const fruitChoices = [
  { id: 'banana', emoji: '🍌', label: 'banana', tone: 'yellow' },
  { id: 'apple', emoji: '🍎', label: 'apple', tone: 'red' },
  { id: 'grapes', emoji: '🍇', label: 'grapes', tone: 'purple' },
];

const PROGRESS_STORAGE_KEY = 'little-fox-progress-v1';

function readSavedProgress() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}');
    return {
      stars: Number.isFinite(saved.stars) ? saved.stars : 2,
      completed: saved.completed === true,
    };
  } catch {
    return { stars: 2, completed: false };
  }
}

function speak(text, rate = 0.82) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  utterance.pitch = 1.08;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((voice) =>
    /samantha|ava|allison|karen|moira/i.test(voice.name)
  ) || voices.find((voice) => voice.lang?.startsWith('en'));
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

function App() {
  const savedProgress = useMemo(readSavedProgress, []);
  const [screen, setScreen] = useState('welcome');
  const [lessonIndex, setLessonIndex] = useState(0);
  const [stars, setStars] = useState(savedProgress.stars);
  const [completed, setCompleted] = useState(savedProgress.completed);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [parentGateOpen, setParentGateOpen] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [audioOn, setAudioOn] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => {
    try {
      window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({ stars, completed }));
    } catch {
      // The game still works when private browsing prevents local persistence.
    }
  }, [stars, completed]);

  useEffect(() => {
    const offlineReady = () => setToast('✓ 已准备好，断网也能继续玩');
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
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const play = (text, rate) => {
    if (audioOn) speak(text, rate);
  };

  const startLesson = () => {
    setLessonIndex(0);
    setScreen('lesson');
    window.setTimeout(() => play('Oh no! Our picnic basket is empty. Can you help me?', 0.78), 250);
  };

  const finishLesson = () => {
    if (!completed) setStars((value) => value + 1);
    setCompleted(true);
  };

  const goMap = () => {
    window.speechSynthesis?.cancel();
    setScreen('map');
  };

  return (
    <main className={`app-shell screen-${screen}`}>
      <Clouds />
      {screen === 'welcome' && (
        <WelcomeScreen
          onStart={() => setScreen('map')}
          onParent={() => setParentGateOpen(true)}
          audioOn={audioOn}
          onAudio={() => setAudioOn((value) => !value)}
        />
      )}

      {screen === 'map' && (
        <MapScreen
          stars={stars}
          completed={completed}
          onMission={startLesson}
          onCollection={() => setCollectionOpen(true)}
          onParent={() => setParentGateOpen(true)}
          audioOn={audioOn}
          onAudio={() => setAudioOn((value) => !value)}
          onToast={setToast}
        />
      )}

      {screen === 'lesson' && (
        <LessonScreen
          index={lessonIndex}
          onIndex={setLessonIndex}
          onClose={goMap}
          play={play}
          onFinish={finishLesson}
          completed={completed}
        />
      )}

      {collectionOpen && <CollectionModal onClose={() => setCollectionOpen(false)} completed={completed} />}
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
          onClose={() => setParentOpen(false)}
          completed={completed}
          audioOn={audioOn}
          setAudioOn={setAudioOn}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function Clouds() {
  return (
    <div className="cloud-layer" aria-hidden="true">
      <span className="cloud cloud-a">☁</span>
      <span className="cloud cloud-b">☁</span>
      <span className="cloud cloud-c">☁</span>
      <span className="sun">☀</span>
    </div>
  );
}

function TopButton({ children, label, onClick, className = '' }) {
  return (
    <button className={`round-button ${className}`} onClick={onClick} aria-label={label} type="button">
      {children}
    </button>
  );
}

function WelcomeScreen({ onStart, onParent, audioOn, onAudio }) {
  return (
    <section className="welcome-screen page-pad">
      <header className="welcome-topbar">
        <div className="brand-pill"><span>🦊</span> 小狐英语岛</div>
        <div className="top-actions">
          <TopButton label={audioOn ? '关闭声音' : '打开声音'} onClick={onAudio}>{audioOn ? '🔊' : '🔇'}</TopButton>
          <TopButton label="家长中心" onClick={onParent}>👨‍👩‍👧</TopButton>
        </div>
      </header>

      <div className="welcome-content">
        <div className="welcome-copy">
          <div className="eyebrow"><span>NEW</span> 今天的新冒险</div>
          <h1>和小狐一起<br /><em>听英语，去冒险！</em></h1>
          <p>跟着声音找一找、拖一拖、说一说。<br />不认识字，也能自己玩。</p>
          <button className="primary-cta" onClick={onStart} type="button">
            <span className="cta-icon">▶</span>
            <span><b>继续冒险</b><small>红苹果小径在等你</small></span>
            <span className="cta-arrow">›</span>
          </button>
          <div className="session-note"><span>🌱</span> 今天建议玩 1 关 · 大约 6 分钟</div>
        </div>

        <div className="welcome-art" aria-label="小狐在英语岛上等你">
          <div className="rainbow">🌈</div>
          <div className="floating-word word-hello">Hello!</div>
          <div className="floating-word word-apple">Apple 🍎</div>
          <div className="hero-fox">
            <span className="fox-tail">🦊</span>
            <span className="fox-body">🦊</span>
            <span className="fox-wave">👋</span>
          </div>
          <div className="hero-island">
            <span className="island-tree">🌳</span>
            <span className="island-house">🏡</span>
            <span className="island-flowers">🌼 🌷 🌼</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function MapScreen({ stars, completed, onMission, onCollection, onParent, audioOn, onAudio, onToast }) {
  const activeMission = completed
    ? { title: '蓝色小桥', english: 'Blue bridge', hint: '新任务已解锁！' }
    : { title: '红苹果小径', english: 'Red apple', hint: '听一听，找到红苹果' };

  return (
    <section className="map-screen page-pad">
      <header className="map-topbar">
        <div className="profile-chip">
          <span className="profile-avatar">🦊</span>
          <span><b>小小探险家</b><small>HELLO ISLAND</small></span>
        </div>
        <div className="world-progress" aria-label={`世界进度 ${completed ? 33 : 16}%`}>
          <span>你好岛</span>
          <div className="progress-track"><i style={{ width: completed ? '33%' : '16%' }} /></div>
          <b>{completed ? '2' : '1'} / 6</b>
        </div>
        <div className="map-actions">
          <div className="star-chip" aria-label={`${stars} 颗星`}>⭐ <b>{stars}</b></div>
          <TopButton label="收藏盒" onClick={onCollection}>🎒</TopButton>
          <TopButton label={audioOn ? '关闭声音' : '打开声音'} onClick={onAudio}>{audioOn ? '🔊' : '🔇'}</TopButton>
          <TopButton label="家长中心" onClick={onParent}>⚙️</TopButton>
        </div>
      </header>

      <div className="map-board">
        <div className="ocean-waves" aria-hidden="true">〰　〰　〰　〰　〰</div>
        <div className="island island-left" aria-hidden="true" />
        <div className="island island-middle" aria-hidden="true" />
        <div className="island island-right" aria-hidden="true" />
        <div className="map-decor decor-one">🌴</div>
        <div className="map-decor decor-two">🦋</div>
        <div className="map-decor decor-three">⛵</div>
        <div className="map-decor decor-four">🐳</div>
        <svg className="map-path" viewBox="0 0 1000 460" preserveAspectRatio="none" aria-hidden="true">
          <path d="M 120 330 C 220 310, 230 190, 330 205 S 430 330, 520 295 S 600 150, 690 170 S 770 300, 835 245 S 885 120, 930 115" />
        </svg>

        {mapMissions.map((mission) => {
          let status = mission.status;
          if (completed && mission.id === 2) status = 'done';
          if (completed && mission.id === 3) status = 'active';
          const handleMission = () => {
            if (mission.id === 2) {
              onMission();
              return;
            }
            if (completed && mission.id === 3) {
              onToast('🌉 蓝色小桥已解锁，下一关内容正在准备中！');
              return;
            }
            if (status === 'done') {
              onToast('✓ 这一关已经完成啦！');
              return;
            }
            onToast('🔒 先完成当前任务吧！');
          };
          return (
            <button
              key={mission.id}
              className={`mission-node mission-${status}`}
              style={{ left: `${mission.x}%`, top: `${mission.y}%` }}
              onClick={handleMission}
              type="button"
              aria-label={`${mission.title}，${status === 'locked' ? '未解锁' : status === 'done' ? '已完成' : '当前任务'}`}
            >
              {status === 'active' && <span className="you-are-here">从这里开始</span>}
              <span className="mission-bubble">
                <i>{mission.icon}</i>
                {status === 'locked' && <small>🔒</small>}
                {status === 'done' && <small>✓</small>}
              </span>
              <span className="mission-label"><b>{mission.title}</b><small>{mission.english}</small></span>
            </button>
          );
        })}
      </div>

      <div className="next-mission-card">
        <div className="guide-face">🦊</div>
        <div className="next-copy"><small>{activeMission.hint}</small><b>{activeMission.title}</b><span>{activeMission.english}</span></div>
        <div className="mini-goals"><span>👂 听</span><span>🖐️ 找</span><span>🎙️ 说</span></div>
        <button
          className="go-button"
          onClick={completed ? () => onToast('🌉 蓝色小桥已解锁，下一关内容正在准备中！') : onMission}
          type="button"
        >出发 <span>→</span></button>
      </div>
    </section>
  );
}

function LessonScreen({ index, onIndex, onClose, play, onFinish, completed }) {
  const next = () => onIndex(Math.min(index + 1, lessonSteps.length - 1));

  useEffect(() => {
    if (index === 1) window.setTimeout(() => play('Find the red apple.', 0.72), 320);
    if (index === 2) window.setTimeout(() => play('Put the red apple in the basket.', 0.72), 320);
    if (index === 3) window.setTimeout(() => play('Red apple.', 0.68), 320);
    if (index === 4) onFinish();
  }, [index]);

  return (
    <section className="lesson-screen page-pad">
      <header className="lesson-topbar">
        <button className="back-button" onClick={onClose} type="button" aria-label="退出关卡">‹</button>
        <div className="lesson-progress">
          {lessonSteps.map((step, stepIndex) => (
            <div key={step.id} className={`lesson-progress-item ${stepIndex < index ? 'is-done' : ''} ${stepIndex === index ? 'is-current' : ''}`}>
              <i>{stepIndex < index ? '✓' : step.icon}</i><span>{step.label}</span>
            </div>
          ))}
          <div className="lesson-progress-line"><i style={{ width: `${(index / (lessonSteps.length - 1)) * 100}%` }} /></div>
        </div>
        <div className="lesson-count">{index + 1}<span>/ {lessonSteps.length}</span></div>
      </header>

      <div className="lesson-stage" key={index}>
        {index === 0 && <StoryStep play={play} onNext={next} />}
        {index === 1 && <ListenStep play={play} onNext={next} />}
        {index === 2 && <DragStep play={play} onNext={next} />}
        {index === 3 && <SpeakStep play={play} onNext={next} />}
        {index === 4 && <RewardStep onMap={onClose} completed={completed} />}
      </div>
    </section>
  );
}

function GuideCard({ children, phrase, play, expression = '🦊' }) {
  return (
    <aside className="guide-card">
      <div className="guide-character">{expression}</div>
      <div className="speech-bubble">
        {children}
        {phrase && <button className="listen-again" onClick={() => play(phrase)} type="button" aria-label="再听一次">🔊</button>}
      </div>
    </aside>
  );
}

function StoryStep({ play, onNext }) {
  return (
    <div className="story-step">
      <div className="story-scene">
        <div className="story-sky">☁️　　☀️　　☁️</div>
        <div className="story-tree">🌳</div>
        <div className="story-blanket">▦</div>
        <div className="story-basket">🧺</div>
        <div className="story-friends"><span>🦊</span><span>🐰</span></div>
        <div className="empty-sign">Empty!</div>
      </div>
      <div className="story-panel">
        <span className="step-kicker">小狐需要你的帮助</span>
        <h2>野餐篮空空的！</h2>
        <GuideCard phrase="Oh no! Our picnic basket is empty. Can you help me?" play={play}>
          <p>Oh no! Our picnic basket is empty.</p>
          <strong>Can you help me?</strong>
        </GuideCard>
        <button className="primary-cta compact" onClick={() => { play('Let us go!', 0.8); onNext(); }} type="button">
          <span className="cta-icon">✓</span><span><b>我来帮忙！</b><small>Let’s go!</small></span><span className="cta-arrow">›</span>
        </button>
      </div>
    </div>
  );
}

function ListenStep({ play, onNext }) {
  const [wrong, setWrong] = useState('');
  const [tries, setTries] = useState(0);
  const [correct, setCorrect] = useState(false);

  const choose = (id) => {
    if (correct) return;
    if (id === 'apple') {
      setCorrect(true);
      setWrong('');
      play('Yes! Red apple. Great listening!', 0.76);
      window.setTimeout(onNext, 1250);
    } else {
      const nextTries = tries + 1;
      setTries(nextTries);
      setWrong(id);
      play('Let us listen again. Find the red apple.', 0.72);
      window.setTimeout(() => setWrong(''), 650);
    }
  };

  return (
    <div className="activity-step listen-step">
      <div className="activity-title">
        <span className="step-kicker">仔细听</span>
        <h2>Find the <em>red apple</em>.</h2>
        <button className="big-audio-button" onClick={() => play('Find the red apple.', 0.7)} type="button"><span>🔊</span> 再听一次</button>
      </div>
      <div className="choice-row" role="group" aria-label="选择正确的水果">
        {fruitChoices.map((fruit) => (
          <button
            key={fruit.id}
            className={`fruit-card tone-${fruit.tone} ${wrong === fruit.id ? 'is-wrong' : ''} ${correct && fruit.id === 'apple' ? 'is-correct' : ''} ${tries > 1 && fruit.id === 'apple' ? 'is-hint' : ''}`}
            onClick={() => choose(fruit.id)}
            type="button"
          >
            <span className="fruit-emoji">{fruit.emoji}</span>
            <b>{fruit.label}</b>
            {correct && fruit.id === 'apple' && <i>✓</i>}
          </button>
        ))}
      </div>
      <div className="kind-hint">💛 点错没关系，再听一次就好</div>
    </div>
  );
}

function DragStep({ play, onNext }) {
  const appleRef = useRef(null);
  const basketRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [placed, setPlaced] = useState(false);
  const startPoint = useRef({ x: 0, y: 0 });

  const onPointerDown = (event) => {
    if (placed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startPoint.current = { x: event.clientX - position.x, y: event.clientY - position.y };
    setDragging(true);
  };

  const onPointerMove = (event) => {
    if (!dragging || placed) return;
    setPosition({ x: event.clientX - startPoint.current.x, y: event.clientY - startPoint.current.y });
  };

  const onPointerUp = () => {
    if (!dragging || placed) return;
    setDragging(false);
    const apple = appleRef.current?.getBoundingClientRect();
    const basket = basketRef.current?.getBoundingClientRect();
    if (apple && basket) {
      const centerX = apple.left + apple.width / 2;
      const centerY = apple.top + apple.height / 2;
      const landed = centerX > basket.left && centerX < basket.right && centerY > basket.top && centerY < basket.bottom;
      if (landed) {
        setPlaced(true);
        play('Wonderful! The red apple is in the basket.', 0.76);
        window.setTimeout(onNext, 1400);
        return;
      }
    }
    setPosition({ x: 0, y: 0 });
    play('Almost! Put the red apple in the basket.', 0.73);
  };

  return (
    <div className="activity-step drag-step">
      <div className="activity-title">
        <span className="step-kicker">拖一拖</span>
        <h2>Put the <em>red apple</em> in the basket.</h2>
        <button className="big-audio-button" onClick={() => play('Put the red apple in the basket.', 0.7)} type="button"><span>🔊</span> 再听一次</button>
      </div>
      <div className={`drag-playground ${dragging ? 'is-dragging' : ''} ${placed ? 'is-placed' : ''}`}>
        <div className="drag-table" />
        <div className="fruit-bowl">🍌　🍇</div>
        <div
          ref={appleRef}
          className="draggable-apple"
          style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="button"
          tabIndex="0"
          aria-label="红苹果，拖进篮子"
        >
          {placed ? '✨' : '🍎'}
          {!dragging && !placed && <span>拖动我</span>}
        </div>
        <div ref={basketRef} className="drop-basket"><span>{placed ? '🧺🍎' : '🧺'}</span><b>{placed ? 'Great!' : 'basket'}</b></div>
        <div className="drag-arrow" aria-hidden="true">➜</div>
      </div>
    </div>
  );
}

function SpeakStep({ play, onNext }) {
  const [phase, setPhase] = useState('ready');
  const timerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const begin = () => {
    play('Red apple.', 0.64);
    setPhase('listen');
    timerRef.current = window.setTimeout(() => setPhase('speak'), 1200);
  };

  const finish = () => {
    setPhase('done');
    play('Beautiful speaking! Red apple!', 0.76);
    window.setTimeout(onNext, 1300);
  };

  return (
    <div className="speak-step">
      <div className="speak-visual">
        <div className="fox-speaker">🦊</div>
        <div className={`sound-waves phase-${phase}`}><i /><i /><i /><i /><i /><i /><i /></div>
        <div className="word-card"><span>🍎</span><b>red apple</b><small>红苹果</small></div>
      </div>
      <div className="speak-panel">
        <span className="step-kicker">跟小狐说</span>
        <h2>Red apple.</h2>
        <p>先听小狐说一遍，再大声说出来。</p>
        {phase === 'ready' && <button className="record-button" onClick={begin} type="button"><span>🔊</span><b>先听一遍</b><small>Tap to listen</small></button>}
        {phase === 'listen' && <div className="listening-state"><span>👂</span><b>仔细听…</b></div>}
        {phase === 'speak' && <button className="record-button is-recording" onClick={finish} type="button"><span>🎙️</span><b>我说好了！</b><small>Red apple.</small></button>}
        {phase === 'done' && <div className="praise-card"><span>🌟</span><b>说得真棒！</b><small>Wonderful speaking!</small></div>}
        <p className="privacy-note">🔒 原型不会录音，也不会保存声音</p>
      </div>
    </div>
  );
}

function RewardStep({ onMap }) {
  return (
    <div className="reward-step">
      <div className="confetti" aria-hidden="true"><i>●</i><i>★</i><i>◆</i><i>●</i><i>★</i><i>◆</i><i>●</i></div>
      <span className="reward-kicker">MISSION COMPLETE</span>
      <h2>红苹果任务完成！</h2>
      <div className="reward-badge"><span className="badge-rays" /><div>🍎</div><b>Apple Helper</b><small>苹果小帮手</small></div>
      <div className="reward-summary">
        <div><span>⭐</span><b>+ 1</b><small>冒险星星</small></div>
        <div><span>👂</span><b>red apple</b><small>今天听懂了</small></div>
        <div><span>🎙️</span><b>Red apple.</b><small>今天开口说</small></div>
      </div>
      <div className="offline-mission"><span>🏠</span><div><small>离开屏幕的小任务</small><b>和爸爸妈妈找一个红色物品，说 “red”</b></div></div>
      <button className="primary-cta reward-cta" onClick={onMap} type="button"><span className="cta-icon">🗺️</span><span><b>回到冒险地图</b><small>下一关已经解锁</small></span><span className="cta-arrow">›</span></button>
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

function CollectionModal({ onClose, completed }) {
  return (
    <Modal onClose={onClose} className="collection-modal">
      <span className="modal-kicker">MY COLLECTION</span>
      <h2>我的冒险收藏盒</h2>
      <p>每完成一个真实的小任务，就会留下一个故事。</p>
      <div className="badge-grid">
        <div className="collection-badge earned"><span>🏡</span><b>Hello Hero</b><small>你好小勇士</small></div>
        <div className={`collection-badge ${completed ? 'earned' : ''}`}><span>{completed ? '🍎' : '❔'}</span><b>{completed ? 'Apple Helper' : '等待发现'}</b><small>{completed ? '苹果小帮手' : '完成第 2 关'}</small></div>
        <div className="collection-badge"><span>🔒</span><b>等待发现</b><small>完成第 3 关</small></div>
        <div className="collection-badge"><span>🔒</span><b>等待发现</b><small>完成第 4 关</small></div>
      </div>
    </Modal>
  );
}

function ParentGate({ onClose, onUnlock }) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState(false);
  const submit = () => {
    if (answer === '5') onUnlock();
    else { setError(true); setAnswer(''); }
  };
  return (
    <Modal onClose={onClose} className="parent-gate-modal">
      <span className="parent-icon">👨‍👩‍👧</span>
      <span className="modal-kicker">FOR GROWN-UPS</span>
      <h2>请家长来回答</h2>
      <p>这是家长专属区域</p>
      <div className={`math-question ${error ? 'is-error' : ''}`}><b>2 + 3 =</b><span>{answer || '?'}</span></div>
      <div className="number-pad">
        {[2, 5, 8].map((number) => <button key={number} onClick={() => { setAnswer(String(number)); setError(false); }} type="button">{number}</button>)}
      </div>
      <button className="gate-submit" onClick={submit} disabled={!answer} type="button">进入家长中心</button>
    </Modal>
  );
}

function ParentPanel({ onClose, completed, audioOn, setAudioOn }) {
  return (
    <Modal onClose={onClose} className="parent-panel-modal">
      <header className="parent-header"><div><span className="modal-kicker">PARENT DASHBOARD</span><h2>今天的学习小结</h2></div><span className="date-pill">今天 · 6 分钟</span></header>
      <div className="parent-stats">
        <div><span>👂</span><b>{completed ? 4 : 2}</b><small>听懂次数</small></div>
        <div><span>🎙️</span><b>{completed ? 1 : 0}</b><small>主动开口</small></div>
        <div><span>🌱</span><b>{completed ? '2 / 6' : '1 / 6'}</b><small>本世界进度</small></div>
      </div>
      <section className="learning-report">
        <div className="report-title"><b>今天学了什么</b><span>不是分数，是成长记录</span></div>
        <div className="skill-row"><span className="skill-icon mastered">✓</span><div><b>Hello!</b><small>已能在情境中理解</small></div><i>保持练习</i></div>
        <div className="skill-row"><span className={`skill-icon ${completed ? 'mastered' : ''}`}>{completed ? '✓' : '•'}</span><div><b>red apple</b><small>{completed ? '已能听音识别并模仿' : '下一关将学习'}</small></div><i>{completed ? '刚刚学会' : '未开始'}</i></div>
      </section>
      <section className="parent-tip"><span>💡</span><div><b>今晚这样玩</b><p>吃水果时问孩子：“Can you find something red?” 不需要纠正发音，愿意开口就值得鼓励。</p></div></section>
      <div className="parent-settings"><span><b>游戏声音</b><small>角色语音与反馈音</small></span><button className={`toggle ${audioOn ? 'is-on' : ''}`} onClick={() => setAudioOn(!audioOn)} type="button" aria-label="切换游戏声音"><i /></button></div>
    </Modal>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

async function registerPwa() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  try {
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });

    if (registration.waiting) {
      window.dispatchEvent(new Event('little-fox-update-ready'));
    }

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state !== 'installed') return;
        window.dispatchEvent(
          new Event(navigator.serviceWorker.controller ? 'little-fox-update-ready' : 'little-fox-offline-ready'),
        );
      });
    });

    window.setInterval(() => registration.update(), 60 * 60 * 1000);
  } catch {
    // Installation is optional; online play remains available if registration fails.
  }
}

window.addEventListener('load', registerPwa);
