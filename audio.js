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
  const BGM_V = "?v=21";
  const MUTE_KEY = "sentimentalHanaeMuted";

  const FADE_MS = 900;
  const FADE_STEP_MS = 40;

  // BGM 全体の音量。**ここ1箇所で全曲まとめて上下できる。**
  // 本作は文字送りの音とハナエの反応が主役なので、曲は「ほんの少し聞こえる」
  // くらいに留める(2026-08-25 本人指示)
  const BGM_MASTER = 0.2;

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

  function clearFade() {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }

  // 2曲を同時に動かして片方を上げ、片方を下げる。
  // 単純な stop→play だと場面のたびに音が切れて、切り替わりが事故に聞こえる
  function crossfade(nextEl, nextKey, fadeMs) {
    clearFade();
    const prevEl = currentEl;
    const prevFrom = prevEl ? prevEl.volume : 0;
    const to = targetVolume(nextKey);
    const steps = Math.max(1, Math.round(fadeMs / FADE_STEP_MS));
    let n = 0;

    currentEl = nextEl;
    currentKey = nextKey;

    fadeTimer = setInterval(() => {
      n++;
      const t = Math.min(1, n / steps);
      if (nextEl) nextEl.volume = Math.min(1, to * t);
      if (prevEl && prevEl !== nextEl) prevEl.volume = Math.max(0, prevFrom * (1 - t));
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
    el.volume = 0;
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
  const VOICES = [
    { freq: 440, type: "triangle", gain: 0.05, ms: 30 },
    { freq: 960, type: "square", gain: 0.045, ms: 26 },
    { freq: 620, type: "square", gain: 0.045, ms: 28 },
    { freq: 500, type: "square", gain: 0.045, ms: 28 },
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
    choice: () => tone(560, 30, "triangle", 0.09),
    next: () => tone(720, 45, "triangle", 0.08),
    // 好感度を伏せているので、ハートが唯一のフィードバック。
    // 上がり幅を音程と音数で表す
    heartSmall: () => tone(880, 90, "sine", 0.11, 1180),
    heartBig: () => {
      tone(880, 90, "sine", 0.11, 1180);
      setTimeout(() => tone(1180, 110, "sine", 0.1, 1480), 80);
    },
    heartHuge: () => {
      tone(880, 90, "sine", 0.12, 1180);
      setTimeout(() => tone(1180, 90, "sine", 0.11, 1480), 75);
      setTimeout(() => tone(1480, 140, "sine", 0.1, 1760), 150);
    },
    heartShrink: () => tone(520, 130, "triangle", 0.09, 400),
    heartBreak: () => {
      tone(430, 180, "triangle", 0.11, 250);
      setTimeout(() => tone(300, 260, "triangle", 0.09, 170), 130);
    },
    ending: () => {
      tone(660, 140, "sine", 0.1);
      setTimeout(() => tone(880, 140, "sine", 0.1), 130);
      setTimeout(() => tone(1100, 300, "sine", 0.1), 260);
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
        currentEl.volume = 0;
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
      volume: currentEl ? Math.round(currentEl.volume * 100) / 100 : null,
      ctx: ctx ? ctx.state : null,
      lastError,
    }),
  };
})();
