/* ==========================================================================
   センチメンタル・ハナエ - BGM と効果音
   --------------------------------------------------------------------------
   BGM は m4a(AAC)。iOS Safari の ogg 対応が不安定なため。
   効果音は Web Audio で合成する。ファイルを持たないので容量ゼロで、
   文字送りの音程を話者ごとに変えられる(ハナエは高い音、地の文は低い音)。
   ========================================================================== */

const AUDIO = (() => {
  const BGM_DIR = "assets/bgm/";
  // index.html の ?v= と同じ数字に揃えること
  const BGM_V = "?v=33";
  const MUTE_KEY = "sentimentalHanaeMuted";

  const FADE_MS = 900;
  const FADE_STEP_MS = 40;

  // BGM 全体の音量。**ここ1箇所で全曲まとめて上下できる。**
  // 本作は文字送りの音とハナエの反応が主役なので、曲は「かすかに聞こえる」
  // くらいに留める(2026-08-26 本人指示。0.5 → 0.2 → 0.07 と2段階下げた)
  const BGM_MASTER = 0.07;

  // 曲ごとの基準音量。BGM_MASTER を掛けた値が実際の音量になる。
  // 「静かな場面」を意図的に小さくするための相対差で、素材そのものの音量差では
  // ない(素材は全曲 -16 LUFS に揃えてある)
  const TRACKS = {
    title: { file: "title", vol: 0.55 },
    daily1: { file: "daily1", vol: 0.5 },
    daily2: { file: "daily2", vol: 0.5 },
    daily3: { file: "daily3", vol: 0.5 },
    daily4: { file: "daily4", vol: 0.5 },
    daily5: { file: "daily5", vol: 0.5 },
    quiet1: { file: "quiet1", vol: 0.4 },
    quiet2: { file: "quiet2", vol: 0.4 },
    tension: { file: "tension", vol: 0.5 },
    end_true: { file: "end_true", vol: 0.55 },
    end_false: { file: "end_false", vol: 0.5 },
    end_rival: { file: "end_rival", vol: 0.5 },
  };

  let muted = (() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch (e) {
      return false;
    }
  })();

  /* ---------------- BGM ---------------- */

  const elements = new Map(); // key -> HTMLAudioElement
  // iOS Safari は HTMLMediaElement.volume を無視する(音量はハードのボタン専用)。
  // そのため <audio> を Web Audio の GainNode に通して、そちらで音量を決める。
  // PC では volume が効くので今まで気付けなかった
  const gains = new Map(); // HTMLAudioElement -> GainNode
  let currentKey = null;
  let currentEl = null;
  let fadeTimer = null;
  let unlocked = false;
  let lastError = null;

  // 起動時には読まない。その曲が要る場面に入って初めて取りに行く
  function elementFor(key) {
    if (elements.has(key)) return elements.get(key);
    const track = TRACKS[key];
    if (!track) return null;
    const el = new Audio();
    el.src = `${BGM_DIR}${track.file}.m4a${BGM_V}`;
    el.loop = true;
    el.preload = "none";
    el.volume = 0;
    elements.set(key, el);
    return el;
  }

  function targetVolume(key) {
    if (muted) return 0;
    const track = TRACKS[key];
    return (track ? track.vol : 0.5) * BGM_MASTER;
  }

  // 要素1つにつき createMediaElementSource は一度しか呼べないので覚えておく。
  // Web Audio が使えない環境では null を返し、el.volume にフォールバックする
  function gainFor(el) {
    if (gains.has(el)) return gains.get(el);
    const c = ensureCtx();
    if (!c) return null;
    let node = null;
    try {
      const src = c.createMediaElementSource(el);
      node = c.createGain();
      node.gain.value = 0;
      src.connect(node);
      node.connect(c.destination);
    } catch (e) {
      node = null;
    }
    gains.set(el, node);
    return node;
  }

  // 音量はできれば GainNode で、無理なら element の volume で設定する
  function setVolume(el, v) {
    const node = gainFor(el);
    if (node) {
      node.gain.value = v;
      el.volume = 1;
    } else {
      el.volume = v;
    }
  }

  function volumeOf(el) {
    const node = gains.get(el);
    return node ? node.gain.value : el.volume;
  }

  function clearFade() {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }

  // 2曲を同時に動かして片方を上げ、片方を下げる。
  // 単純な stop→play だと場面のたびに音が切れて、切り替わりが事故に聞こえる
  function crossfade(nextEl, nextKey, fadeMs) {
    clearFade();
    const prevEl = currentEl;
    const prevFrom = prevEl ? volumeOf(prevEl) : 0;
    const to = targetVolume(nextKey);
    const steps = Math.max(1, Math.round(fadeMs / FADE_STEP_MS));
    let n = 0;

    currentEl = nextEl;
    currentKey = nextKey;

    fadeTimer = setInterval(() => {
      n++;
      const t = Math.min(1, n / steps);
      if (nextEl) setVolume(nextEl, Math.min(1, to * t));
      if (prevEl && prevEl !== nextEl) setVolume(prevEl, Math.max(0, prevFrom * (1 - t)));
      if (t >= 1) {
        clearFade();
        if (prevEl && prevEl !== nextEl) {
          prevEl.pause();
          prevEl.currentTime = 0;
        }
      }
    }, FADE_STEP_MS);
  }

  function playBgm(key, fadeMs) {
    if (!TRACKS[key]) return;
    if (key === currentKey && currentEl && !currentEl.paused) return;
    const el = elementFor(key);
    if (!el) return;
    // 初回のタップより前は再生が拒否される。鳴らせるようになってから同じ曲を張り直す
    if (!unlocked) {
      currentKey = key;
      currentEl = el;
      return;
    }
    setVolume(el, 0);
    const p = el.play();
    // AbortError は曲を切り替えた時に前の play() が打ち切られただけで、異常ではない。
    // 実機の切り分けを濁らせるので記録しない
    if (p && p.catch) {
      p.catch((err) => {
        if (err && err.name !== "AbortError") lastError = err.name;
      });
    }
    crossfade(el, key, fadeMs === undefined ? FADE_MS : fadeMs);
  }

  function stopBgm(fadeMs) {
    if (!currentEl) return;
    // 下げ切った時点で crossfade が元の曲を止める。ここで別に止めようとすると、
    // crossfade が currentEl を先に null にしているので掴み損ねる
    crossfade(null, null, fadeMs === undefined ? FADE_MS : fadeMs);
  }

  /* ---------------- 効果音(Web Audio で合成) ---------------- */

  let ctx = null;
  let seBus = null;

  function ensureCtx() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    seBus = ctx.createGain();
    seBus.gain.value = 1;
    seBus.connect(ctx.destination);
    return ctx;
  }

  // 単音。attack/decay を持たせないと「プツッ」というノイズになる
  function tone(freq, ms, type, gain, freqTo) {
    if (muted) return;
    const c = ensureCtx();
    if (!c || c.state === "suspended") return;
    const t0 = c.currentTime;
    const dur = ms / 1000;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.008, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(seBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /* ---------------- 文字送りの音 ---------------- */

  // 0 = 地の文 / 1 = ハナエ / 2 = ハナエ以外の登場人物 / 3 = 主人公
  // 地の文だけ triangle。「」の中は必ず square にして、喋りとして聞こえるようにする
  // 昔のADVの喋り音。短すぎ・小さすぎると鳴っていないように聞こえるので、
  // 40〜50ms・しっかりした音量を取る(BGM は下に敷くだけなので競合しない)
  const VOICES = [
    { freq: 430, type: "triangle", gain: 0.17, ms: 46 },
    { freq: 950, type: "square", gain: 0.19, ms: 44 },
    { freq: 620, type: "square", gain: 0.18, ms: 46 },
    { freq: 500, type: "square", gain: 0.18, ms: 46 },
  ];

  // 1文字ごとに鳴らすと、文字送りが速い時に音が繋がって1本の音に聞こえる。
  // 最短間隔を決めて間引く(文字速度を変えても鳴り方が変わらない)
  const BLIP_MIN_MS = 70;
  let lastBlip = 0;

  function blip(voice) {
    if (muted) return;
    const now = performance.now();
    if (now - lastBlip < BLIP_MIN_MS) return;
    lastBlip = now;
    const v = VOICES[voice] || VOICES[0];
    // 少しだけ音程を散らす。固定だと機械が喋っているように聞こえる
    const detune = 1 + (Math.random() - 0.5) * 0.06;
    tone(v.freq * detune, v.ms, v.type, v.gain);
  }

  /* ---------------- 場面ごとの効果音 ---------------- */

  const CUES = {
    choice: () => tone(560, 34, "triangle", 0.22),
    next: () => tone(720, 50, "triangle", 0.2),
    // 好感度を伏せているので、ハートが唯一のフィードバック。
    // 上がり幅を音程と音数で表す
    heartSmall: () => tone(880, 95, "sine", 0.26, 1180),
    heartBig: () => {
      tone(880, 95, "sine", 0.26, 1180);
      setTimeout(() => tone(1180, 115, "sine", 0.24, 1480), 80);
    },
    heartHuge: () => {
      tone(880, 95, "sine", 0.28, 1180);
      setTimeout(() => tone(1180, 95, "sine", 0.26, 1480), 75);
      setTimeout(() => tone(1480, 145, "sine", 0.24, 1760), 150);
    },
    heartShrink: () => tone(520, 135, "triangle", 0.22, 400),
    heartBreak: () => {
      tone(430, 185, "triangle", 0.26, 250);
      setTimeout(() => tone(300, 265, "triangle", 0.22, 170), 130);
    },
    ending: () => {
      tone(660, 145, "sine", 0.24);
      setTimeout(() => tone(880, 145, "sine", 0.24), 130);
      setTimeout(() => tone(1100, 305, "sine", 0.24), 260);
    },
  };

  function se(name) {
    const cue = CUES[name];
    if (cue) cue();
  }

  /* ---------------- 解錠・ミュート ---------------- */

  // iOS も Chrome も、最初のタップより前は音を出せない。
  // 最初の操作で AudioContext を起こし、待たせていた曲を鳴らし始める
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    // iOS 16.4+ : これを立てないと、本体側面のサイレントスイッチで
    // Web Audio(文字送りの音)だけが消える
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch (e) {
      /* 未対応のブラウザでは何もしない */
    }
    const c = ensureCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
    if (currentKey) {
      const key = currentKey;
      currentKey = null;
      const el = currentEl;
      currentEl = null;
      if (el) el.pause();
      playBgm(key, 400);
    }
  }

  // タブから戻った時、iOS では AudioContext が止まったままのことがある。
  // BGM も GainNode 経由になったので、止まると曲ごと無音になる
  function resume() {
    if (!unlocked) return;
    const c = ensureCtx();
    if (c && c.state === "suspended") c.resume().catch(() => {});
    if (currentEl && currentEl.paused && !muted) {
      const p = currentEl.play();
      if (p && p.catch) {
        p.catch((err) => {
          if (err && err.name !== "AbortError") lastError = err.name;
        });
      }
    }
  }

  function setMuted(next) {
    muted = !!next;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch (e) {
      /* 保存できなくても再生には影響させない */
    }
    if (currentEl) {
      clearFade();
      if (muted) {
        setVolume(currentEl, 0);
        currentEl.pause();
      } else {
        const p = currentEl.play();
        if (p && p.catch) p.catch(() => {});
        crossfade(currentEl, currentKey, 300);
      }
    }
    return muted;
  }

  return {
    unlock,
    resume,
    playBgm,
    stopBgm,
    blip,
    se,
    isMuted: () => muted,
    isUnlocked: () => unlocked,
    toggleMuted: () => setMuted(!muted),
    // 実機で音が出ない時の切り分け用。ブラウザによって詰まる場所が違う
    state: () => ({
      unlocked,
      muted,
      track: currentKey,
      playing: !!(currentEl && !currentEl.paused),
      volume: currentEl ? Math.round(volumeOf(currentEl) * 1000) / 1000 : null,
      gainNode: currentEl ? !!gains.get(currentEl) : null,
      ctx: ctx ? ctx.state : null,
      lastError,
    }),
  };
})();
