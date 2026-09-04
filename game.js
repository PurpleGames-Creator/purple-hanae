/* ==========================================================================
   センチメンタル・ハナエ - ゲームエンジン
   ========================================================================== */

const SAVE_KEY = "sentimentalHanaeSave";
const ASSET_DIR = "assets/";
// 画像にもキャッシュバスターを付ける。付けないと、後から表情を差し替えたり
// 追加したりした時に、古い画像や過去の404がブラウザに残り続ける。
// 数字は index.html の <script src="game.js?v=NN"> から読む。手で揃える箇所を
// 3つ持っていた頃に 43 と 45 でずれた実績があるので、正は index.html の1箇所だけにする
const ASSET_V = (() => {
  const src = document.currentScript && document.currentScript.getAttribute("src");
  const m = src && src.match(/\?v=[^&#]+/);
  return m ? m[0] : "";
})();

// 選択肢を描画してから受け付けるまでの猶予(誤タップ防止)と、1つずつ現れる間隔
const CHOICE_LOCK_MS = 320;
const CHOICE_STAGGER_MS = 55;
// 選んだ肢を光らせてから消すまで。反応はこの後に始まる
const CHOICE_HOLD_MS = 380;

// アニメーション低減の設定。演出の待ち時間を 0 にする(文字送りは別。本作の読ませ方そのものなので止めない)
function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function freshState() {
  return {
    v: GAME_DATA.SAVE_VERSION,
    name: "",
    score: GAME_DATA.START_SCORE,
    rival: GAME_DATA.START_RIVAL,
    pushyCount: 0,
    passiveCount: 0,
    perfect: {},
    freeChosen: [],
    freeRemaining: Object.keys(GAME_DATA.freePool),
    queueIndex: 0,
    freePicksLeft: 3,
    act3DriftApplied: false,
    rivalInsertShown: false,
    foreshadowShown: false,
    senshu: false,
    finished: false,
    log: [],
  };
}

let state = freshState();

// メインの進行キュー(FREEは自由行動選択フェーズを表す)
const QUEUE = GAME_DATA.order.slice();

const el = (id) => document.getElementById(id);

function saveGame() {
  if (state.finished) {
    localStorage.removeItem(SAVE_KEY);
    return;
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    /* プライベートブラウジング等で保存できなくてもゲームは続行する */
  }
}

function loadGame() {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  // シナリオを更新した後の古いセーブは進行が噛み合わないので破棄する
  if (!saved || saved.v !== GAME_DATA.SAVE_VERSION) {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    return null;
  }
  return Object.assign(freshState(), saved);
}

/* ---------------- エンディング図鑑 ---------------- */

// セーブとは別に保存する。「もう一度プレイする」で消えてはいけない
const ENDINGS_KEY = "sentimentalHanaeEndings";

function loadSeenEndings() {
  try {
    const arr = JSON.parse(localStorage.getItem(ENDINGS_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter((k) => GAME_DATA.endingLabels[k]) : [];
  } catch (e) {
    return [];
  }
}

// 初めて到達したエンディングなら true を返す
function recordEnding(key) {
  const seen = loadSeenEndings();
  if (seen.includes(key)) return false;
  seen.push(key);
  try {
    localStorage.setItem(ENDINGS_KEY, JSON.stringify(seen));
  } catch (e) {
    /* 保存できなくても進行に影響させない */
  }
  return true;
}

function renderEndingGallery() {
  const box = el("ending-gallery");
  const seen = loadSeenEndings();
  const order = GAME_DATA.endingOrder;
  box.innerHTML = "";

  const head = document.createElement("p");
  head.className = "gallery-head";
  head.textContent = `エンディング ${seen.length} / ${order.length}`;
  box.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "gallery-grid";
  order.forEach((k) => {
    const cell = document.createElement("span");
    const got = seen.includes(k);
    cell.className = "gallery-cell";
    if (got) cell.classList.add("is-got");
    if (k === "successPerfect") cell.classList.add("is-special");
    cell.textContent = got ? GAME_DATA.endingLabels[k] : "???";
    grid.appendChild(cell);
  });
  box.appendChild(grid);

  if (seen.length >= order.length) {
    const done = document.createElement("p");
    done.className = "gallery-done";
    done.textContent = "全エンディング到達。おつかれさまでした。";
    box.appendChild(done);
  }
}

/* ---------------- 場面ごとの BGM ---------------- */

// 曲は背景ではなく気分に当てる。背景7種に1曲ずつ割ると切り替わりすぎる。
// 同じ気分の曲が複数あるものは、1周の中で全部使う。幕が進むごとに切り替えて、
// 同じ準備期間でも時間が動いている感じを出す
const BGM_BY_KEY = {
  TITLE: "title",
  PROLOGUE: "title",

  // 出会い
  E1: "daily1",
  E2: "daily1",
  E3: "daily1",

  // 委員会が動き出す
  E4: "daily2",
  E6: "daily2",
  E7: "daily2",

  // 自由行動。選択画面と、そこから入る5イベントで1曲
  FREE: "daily3",
  F1_neji: "daily3",
  F2_chusai: "daily3",
  F3_kaidashi: "daily3",
  F4_baiten: "daily3",
  F6_kouhai: "daily3",

  // 中盤
  E9: "daily4",
  E10: "daily4",
  E11: "daily4",

  // 誕生日。1イベントだけ専用にして、ここが特別だと分かるようにする
  E15: "daily5",

  // 静かな場面。夏のまだ距離がある静けさ(quiet1)と、本音が出る終盤(quiet2)で分ける。
  // E19 は quiet1 に戻す —— 最後の夜だけ最初の静けさが返ってくる
  E5: "quiet1",
  E8: "quiet1",
  E12: "quiet1",
  E13: "quiet1",
  E19: "quiet1",
  E14: "quiet2",
  E14B: "quiet2",
  CONFESSION: "quiet2",

  // 緊張
  E16: "tension",
  E17: "tension",
  E18: "tension",
  F5_nishino: "tension",
  RIVAL: "tension",
};

const BGM_ENDING = {
  success: "end_true",
  successPerfect: "end_true",
  friend: "end_false",
  soretigai: "end_false",
  awkward: "end_false",
  nishino: "end_rival",
};

// 場面を足した時にここへ書き忘れても無音にはしない
function bgmForKey(key) {
  return BGM_BY_KEY[key] || "daily1";
}

/* ---------------- 画面制御 ---------------- */

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el(id).classList.add("active");
  // タイトルだけ、立ち絵をゆっくり呼吸させて花びらを降らせる
  document.body.classList.toggle("is-title", id === "screen-title");
  renderHud(id);
  updateLayout();
}

/* ---------------- 進行度の表示(HUD) ---------------- */

// 残りイベント数。1イベント = 準備期間の1日として数える
function stepsLeft() {
  let left = 0;
  for (let i = state.queueIndex; i < QUEUE.length; i++) {
    left += QUEUE[i] === "FREE" ? state.freePicksLeft : 1;
  }
  return left;
}

function totalSteps() {
  return QUEUE.length - 1 + 3; // FREE を3回分として数える
}

function renderHud(screenId) {
  const hud = el("hud");
  const playing = screenId === "screen-event" || screenId === "screen-free" || screenId === "screen-confession";
  hud.style.display = playing ? "block" : "none";
  if (!playing) return;

  const left = stepsLeft();
  el("hud-progress").textContent = dateLabel(screenId);

  const done = Math.max(0, totalSteps() - left);
  el("hud-bar-fill").style.width = Math.min(100, (done / totalSteps()) * 100) + "%";
}

// HUD に出す日付。「あとN日」の逆算だと、8/7 の誕生日(E15)の後に夏休みが明けて
// 9月へ飛ぶところで破綻するので、場面ごとの日付を game-data.js の dates から引く
function dateLabel(screenId) {
  const D = GAME_DATA.dates || {};
  const L = GAME_DATA.dateLabels || {};
  // 先手を打つと E19 を捨てて前日の夜に告白する。本文と食い違わせない
  if (screenId === "screen-confession") return state.senshu ? (L.senshu || "") : (L.confession || "");
  const key = QUEUE[state.queueIndex];
  if (key === "FREE") {
    const done = 3 - state.freePicksLeft;
    // 選択画面ではこれから選ぶ日、イベント中は選んだ日
    const idx = screenId === "screen-free" ? done : done - 1;
    return (GAME_DATA.freeDates || [])[idx] || "";
  }
  if (key === "E19") return L.eve || D.E19 || "";
  return D[key] || "";
}

/* ---------------- 背景・立ち絵 ---------------- */

let currentBg = null;
let currentOutfit = null;
let bgFront = "bg-a"; // いま表示している側のレイヤー

function setBackground(bgName) {
  if (bgName === currentBg) return;
  const front = el(bgFront);
  const back = el(bgFront === "bg-a" ? "bg-b" : "bg-a");
  if (!bgName) {
    front.classList.remove("bg-show");
    back.classList.remove("bg-show");
    currentBg = null;
    return;
  }
  // 裏のレイヤーに新しい背景を載せてからフェードイン、表側を落とす
  back.style.backgroundImage = `url("${ASSET_DIR}${bgName}.webp${ASSET_V}")`;
  void back.offsetWidth;
  back.classList.add("bg-show");
  front.classList.remove("bg-show");
  bgFront = back.id;
  currentBg = bgName;
}

// 未作成の表情ファイルを覚えておく。覚えないと、表情が変わるたびに
// 同じファイルへ404リクエストが飛び続ける
const missingSprites = new Set();

// ベース立ち絵が担っている表情。専用ファイルを持たず hanae_<outfit>.webp を使う
const BASE_EXPR = "smile";

// assets/ に実在する表情差分。ファイル名は assets/hanae_<outfit>_<expr>.webp。
// 先読みも、指定漏れ時のフォールバックも、ここだけを見る。
// 新しい差分を assets/ に置いたら、ここにも足すこと
const SPRITE_EXPRESSIONS = {
  summer: ["normal", "soft", "trouble", "lonely", "angry", "surprise", "shy", "joy", "cry"],
  winter: ["soft"],
};

function hasExpressionFile(outfit, expr) {
  return !!expr && expr !== BASE_EXPR && (SPRITE_EXPRESSIONS[outfit] || []).includes(expr);
}

const SPRITE_FADE_MS = 180;
let spriteFadeToken = 0;

function setSprite(outfit, expr) {
  const img = el("sprite");
  const alt = el("sprite-b");
  if (!outfit) {
    spriteFadeToken++;
    img.style.display = "none";
    alt.style.display = "none";
    alt.classList.remove("is-shown");
    img.removeAttribute("src");
    alt.removeAttribute("src");
    currentOutfit = null;
    return;
  }
  const base = `${ASSET_DIR}hanae_${outfit}.webp${ASSET_V}`;
  // ベース画像そのものが smile なので、専用ファイルは持たない。
  // 実在しない表情は投げる前に base へ落とす(冬服は soft しか無いので、
  // 夏服向けの表情がそのまま渡ると毎回404を踏むことになる)
  const variant = hasExpressionFile(outfit, expr)
    ? `${ASSET_DIR}hanae_${outfit}_${expr}.webp${ASSET_V}`
    : base;
  const wanted = missingSprites.has(variant) ? base : variant;
  const current = img.getAttribute("src");
  img.style.display = "block";

  // 初回、または服が変わる時はクロスフェードしない。
  // 夏服と冬服はシルエットが違うので、溶かすと二重写しに見える
  if (!current || outfit !== currentOutfit) {
    spriteFadeToken++;
    alt.style.display = "none";
    alt.classList.remove("is-shown");
    img.onerror = () => {
      img.onerror = null;
      missingSprites.add(img.getAttribute("src"));
      if (img.getAttribute("src") !== base) img.src = base;
    };
    img.src = wanted;
    currentOutfit = outfit;
    img.classList.remove("sprite-in");
    void img.offsetWidth;
    img.classList.add("sprite-in");
    return;
  }

  if (current === wanted) return;
  crossfadeSprite(wanted, base);
}

// 表情の切り替え。裏のレイヤーに次の表情を読み込んでから重ねて溶かす。
// 表情差分はすべて同じポーズ・同じシルエットなので、顔だけが変化して見える
async function crossfadeSprite(wanted, base) {
  const img = el("sprite");
  const alt = el("sprite-b");
  const token = ++spriteFadeToken;

  alt.style.display = "block";
  alt.classList.remove("is-shown");
  alt.src = wanted;

  try {
    await alt.decode();
  } catch (e) {
    // decode() は「読み込み失敗」でも「差し替えが重なって打ち切られた」でも失敗する。
    // 後者をファイル無しと誤判定すると、以降その表情が二度と使われなくなる
    if (token !== spriteFadeToken) return;
    if (alt.naturalWidth === 0) missingSprites.add(wanted);
    if (wanted !== base && img.getAttribute("src") !== base) {
      crossfadeSprite(base, base);
    } else {
      alt.classList.remove("is-shown");
      alt.style.display = "none";
    }
    return;
  }
  if (token !== spriteFadeToken) return;

  void alt.offsetWidth;
  alt.classList.add("is-shown");

  setTimeout(() => {
    if (token !== spriteFadeToken) return;
    // 表側を新しい表情に差し替えてから裏を落とす(復号済みなので瞬時)
    img.src = alt.getAttribute("src");
    alt.classList.remove("is-shown");
    setTimeout(() => {
      if (token === spriteFadeToken) alt.style.display = "none";
    }, SPRITE_FADE_MS + 40);
  }, SPRITE_FADE_MS + 10);
}

function applyScene(scene) {
  if (!scene) return;
  setBackground(scene.bg);
  // 場面の入りの表情。重い場面で満面の笑みのまま始まらないようにする
  setSprite(scene.sprite, scene.expr || null);
  setTint(scene.tint || null);
  setWeather(scene.weather || null);
  updateLayout();
}

// 画面全体に薄く掛ける色(夕方・雨・嵐)。指定の無い場面では消す
function setTint(color) {
  const t = el("bg-tint");
  if (!t) return;
  if (color) t.style.background = color;
  t.classList.toggle("is-on", !!color);
}

function setWeather(kind) {
  document.body.classList.toggle("is-rain", kind === "rain");
}

/* ---------------- 場面転換のテロップ ---------------- */

const TELOP_MS = { in: 260, hold: 760, out: 420 };
let lastTelop = "";

function placeFor(scene) {
  const bg = scene && scene.bg;
  return (bg && GAME_DATA.placeLabels && GAME_DATA.placeLabels[bg]) || "";
}

// 日付と場所を暗転の上に出してから本文へ。同じ日付・同じ場所が続く時(噂 → E19)は出さない。
// 既読の場面は短くする(周回で毎回待たされないように)
function showTelop(date, place, read) {
  const box = el("telop");
  if (!box || !date) return Promise.resolve();
  const key = date + "|" + place;
  if (key === lastTelop) return Promise.resolve();
  lastTelop = key;
  el("telop-date").textContent = date;
  el("telop-place").textContent = place || "";
  const reduced = reducedMotion();
  box.classList.remove("is-out");
  box.classList.add("is-in");
  const hold = reduced ? 600 : TELOP_MS.in + (read ? 380 : TELOP_MS.hold);
  return new Promise((resolve) => {
    setTimeout(() => {
      box.classList.remove("is-in");
      box.classList.add("is-out");
      resolve();
      setTimeout(() => box.classList.remove("is-out"), TELOP_MS.out + 60);
    }, hold);
  });
}

/* ---------------- 暗転 ---------------- */

// 告白 → 結末、結末 → タイトル のような大きな切り替えで使う
function fadeTo(dark, ms) {
  const f = el("fade");
  if (!f) return Promise.resolve();
  const dur = reducedMotion() ? 0 : ms;
  f.style.transitionDuration = dur + "ms";
  void f.offsetWidth;
  f.classList.toggle("is-dark", dark);
  return new Promise((resolve) => setTimeout(resolve, dur));
}

/* ---------------- 立ち絵の感情モーション ---------------- */

// 反応の表情に合わせて、立ち絵を少しだけ動かす。驚き・喜びは跳ね、怒りは小刻みに揺れ、
// 落胆は沈み、照れは半歩引く。柔らかい表情(soft / normal / smile)は動かさない
const SPRITE_MOTION = {
  surprise: "pop",
  joy: "pop",
  angry: "shake",
  lonely: "sink",
  trouble: "sink",
  cry: "sink",
  shy: "step",
};
const MOTION_CLASSES = ["motion-pop", "motion-shake", "motion-sink", "motion-step", "motion-dim"];

function playSpriteMotion(kind) {
  if (!kind || reducedMotion()) return;
  ["sprite", "sprite-b"].forEach((id) => {
    const im = el(id);
    im.classList.remove(...MOTION_CLASSES);
    void im.offsetWidth;
    im.classList.add("motion-" + kind);
  });
}

function initSpriteMotion() {
  ["sprite", "sprite-b"].forEach((id) => {
    el(id).addEventListener("animationend", (ev) => {
      if (ev.animationName.indexOf("motion") === 0) ev.target.classList.remove(...MOTION_CLASSES);
    });
  });
}

// 広い画面では、立ち絵が出ている間だけ本文を左カラムに寄せる。
// 常に寄せるとタイトル画面まで左に偏り、立ち絵の有無で切り替えるだけだと
// プレイ中に本文の位置が飛ぶので、「プレイ中」も条件に含める。
// プロローグと、立ち絵を出さないエンディング(awkward/soretigai/nishino)は
// sprite: null なので、ここに入れておかないと
// タイトル(左)→プロローグ(中央)→本編(左)→エンディング(中央)と枠が左右に飛ぶ
function updateLayout() {
  const active = document.querySelector(".screen.active");
  const id = active ? active.id : "";
  const playing =
    id === "screen-prologue" ||
    id === "screen-event" ||
    id === "screen-free" ||
    id === "screen-confession" ||
    id === "screen-ending";
  // 表示中かどうかは currentOutfit で見る。要素の inline style は初回描画前が
  // 空文字なので、"none ではない" だと立ち絵を出す前から出ている扱いになる
  const spriteVisible = !!currentOutfit;
  el("app").classList.toggle("col-left", playing || spriteVisible);
  // エンディングだけは HUD が出ない。狭い画面で立ち絵を HUD ぶん上げるための目印
  document.body.classList.toggle("is-ending", id === "screen-ending");
}

function sceneFor(key) {
  return GAME_DATA.scenes[key] || null;
}

// 起動時に読むのは、すぐ必要になる背景とベース立ち絵だけ
function preloadAssets() {
  const names = new Set();
  Object.values(GAME_DATA.scenes).forEach((s) => { if (s.bg) names.add(s.bg); });
  Object.values(GAME_DATA.endingScenes).forEach((s) => { if (s.bg) names.add(s.bg); });
  names.forEach((n) => { new Image().src = `${ASSET_DIR}${n}.webp${ASSET_V}`; });
  ["summer", "winter"].forEach((o) => { new Image().src = `${ASSET_DIR}hanae_${o}.webp${ASSET_V}`; });
}

// 表情差分は枚数が多く、まとめて起動時に読むとタイトルの表示が遅れる。
// タイトルを出した後、暇な時に1枚ずつ読む。プレイ開始までには揃う。
// 併せて、存在しない表情をここで記憶しておくので、本編中に404が飛ばなくなる
const PRELOAD_EXPRESSIONS = Object.entries(SPRITE_EXPRESSIONS).flatMap(
  ([outfit, exprs]) => exprs.map((e) => `hanae_${outfit}_${e}`)
);

function preloadExpressions() {
  let i = 0;
  const idle = (fn) => {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 120);
  };
  const next = () => {
    if (i >= PRELOAD_EXPRESSIONS.length) return;
    const url = `${ASSET_DIR}${PRELOAD_EXPRESSIONS[i++]}.webp${ASSET_V}`;
    const img = new Image();
    img.onload = () => idle(next);
    img.onerror = () => {
      missingSprites.add(url);
      idle(next);
    };
    img.src = url;
  };
  idle(next);
}

/* ---------------- タイトル ---------------- */

function initTitleScreen() {
  showScreen("screen-title");
  lastTelop = "";
  setTint(null);
  setWeather(null);
  // 広い画面だけ、タイトルにもハナエを立たせる。狭い画面の立ち絵は右上の
  // 円形アイコンになる作りなので、出すとロゴに重なってしまう
  const wide = window.matchMedia && window.matchMedia("(min-width: 1000px)").matches;
  applyScene(sceneFor(wide ? "TITLE_WIDE" : "TITLE"));
  AUDIO.playBgm("title");
  gateTitleForAudio();
  renderEndingGallery();
  window.scrollTo(0, 0);
  const saved = loadGame();
  const continueBtn = el("btn-continue");
  if (saved && !saved.finished) {
    continueBtn.style.display = "inline-block";
    continueBtn.onclick = () => {
      AUDIO.se("next");
      state = saved;
      el("player-name-input").value = state.name;
      advanceQueue();
    };
  } else {
    continueBtn.style.display = "none";
  }
  // 名前は主人公の一人称(プロローグの「俺は◯◯。」やセリフの名札)に使うので必須。
  // 空のまま押せてしまうと「俺は。」になるため、入力があるまで進ませない
  const nameInput = el("player-name-input");
  const nameError = el("name-error");
  const startBtn = el("btn-start");
  const syncStart = () => {
    const ok = nameInput.value.trim().length > 0;
    startBtn.classList.toggle("is-off", !ok);
    if (ok) {
      nameInput.classList.remove("invalid", "shake");
      nameError.textContent = "";
    }
  };
  nameInput.oninput = syncStart;
  // Enter でも始められるように(スマホの「完了」もここに来る)
  nameInput.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); startBtn.click(); }
  };
  syncStart();
  startBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
      AUDIO.se("heartShrink");
      nameError.textContent = "名前を入力してください";
      nameInput.classList.remove("shake");
      void nameInput.offsetWidth;  // 連打しても揺れ直すよう、アニメーションを巻き戻す
      nameInput.classList.add("invalid", "shake");
      nameInput.focus();
      return;
    }
    AUDIO.se("next");
    state = freshState();
    state.name = name;
    saveGame();
    fadeTo(true, 450).then(() => {
      showPrologue();
      return fadeTo(false, 600);
    });
  };
}

// ブラウザは最初のタップより前に音を出させない。タイトルで最初に押すのは
// 「はじめる」なので、そのままだと解錠した瞬間にタイトルを離れてしまい、
// タイトルの曲が一度も鳴らない。初回だけタップを挟んで、曲が鳴ってから
// メニューを出す(音を切っている人には挟まない)
function gateTitleForAudio() {
  const screen = el("screen-title");
  if (AUDIO.isUnlocked() || AUDIO.isMuted()) {
    screen.classList.remove("is-gated");
    return;
  }
  screen.classList.add("is-gated");
  // クリックだけで待つと、キーボードで操作した時に「音は鳴り出したのに
  // メニューが出ない」状態になる(解錠側は keydown も拾っているため)。
  // pointerdown は入れない —— 押した指がそのまま出てきたボタンに落ちてしまう
  const openTitle = () => {
    AUDIO.unlock();
    screen.classList.remove("is-gated");
    document.removeEventListener("click", openTitle);
    document.removeEventListener("keydown", openTitle);
  };
  document.addEventListener("click", openTitle);
  document.addEventListener("keydown", openTitle);
}

/* ---------------- プロローグ ---------------- */

// game-data.js に埋めた {name} をプレイヤー名に差し替える。
// 名前に $& のような置換記号が入っても壊れないよう、置換値は関数で返す
function withName(text) {
  return String(text).replace(/\{name\}/g, () => state.name || "俺");
}

// 新規プレイの時だけ出す回想フレーム。「つづきから」では出さない
function showPrologue() {
  showScreen("screen-prologue");
  applyScene(sceneFor("PROLOGUE"));
  const btn = el("btn-prologue-next");
  btn.style.display = "none";
  btn.onclick = () => { advanceQueue(); };
  window.scrollTo(0, 0);
  const prologueText = withName(GAME_DATA.prologue);
  pushLog("プロローグ", prologueText);
  playBlocks(el("prologue-text"), prologueText, "prologue", () => {
    btn.style.display = "block";
  });
}

/* ---------------- ハート演出 ---------------- */

function heartTier(points) {
  if (points >= 4) return { count: 3, cls: "heart-huge", expr: "joy" };
  if (points >= 2) return { count: 2, cls: "heart-big", expr: "smile" };
  if (points >= 1) return { count: 1, cls: "heart-small", expr: "smile" };
  if (points === 0) return { count: 0, cls: "", expr: "normal" };
  if (points <= -3) return { count: 1, cls: "heart-break", expr: "lonely" };
  return { count: 1, cls: "heart-shrink", expr: "trouble" };
}

// 選択肢に expr の指定が無い場合の保険。点数と感情は一致しないので、
// 本来は game-data.js 側で1件ずつ指定する(現在は全103件に指定済み)
function exprFor(points, tag) {
  const base = heartTier(points).expr;
  if (points < 0 && tag === "pushy") return "angry";
  return base;
}

// 好感度を伏せているのでハートが唯一のフィードバック。上がり幅を音でも表す
const HEART_SE = {
  "heart-huge": "heartHuge",
  "heart-big": "heartBig",
  "heart-small": "heartSmall",
  "heart-break": "heartBreak",
  "heart-shrink": "heartShrink",
};

function playHeartEffect(points) {
  const layer = el("heart-layer");
  layer.innerHTML = "";
  const tier = heartTier(points);
  if (HEART_SE[tier.cls]) AUDIO.se(HEART_SE[tier.cls]);
  if (tier.count === 0) return;

  // 立ち絵が出ている時は顔のあたりに出す。画面中央だと「画面の装飾」に見えて、
  // ハナエの反応として読み取れない
  const sprite = el("sprite");
  const rect = sprite.style.display === "none" ? null : sprite.getBoundingClientRect();
  const anchored = rect && rect.width > 0;

  // 大きな上がり幅は顔の周りにひと呼吸の光を足す。下がる時は立ち絵を一瞬暗く沈める
  if (anchored && tier.count >= 2 && !reducedMotion()) {
    const glow = document.createElement("div");
    glow.className = "heart-glow";
    glow.style.left = rect.left + rect.width * 0.5 + "px";
    glow.style.top = rect.top + rect.height * 0.16 + "px";
    layer.appendChild(glow);
  }
  if (tier.cls === "heart-break") playSpriteMotion("dim");

  for (let i = 0; i < tier.count; i++) {
    const h = document.createElement("div");
    h.className = "heart " + tier.cls;
    if (anchored) {
      h.style.left = rect.left + rect.width * (0.34 + Math.random() * 0.28) + i * 16 + "px";
      h.style.top = rect.top + rect.height * (0.12 + Math.random() * 0.08) + "px";
    } else {
      h.style.left = 40 + Math.random() * 20 + i * 8 + "%";
    }
    h.style.animationDelay = (i * 0.12) + "s";
    h.textContent = tier.cls === "heart-break" ? "💔" : "💗";
    layer.appendChild(h);
  }
  clearTimeout(playHeartEffect._clearTimer);
  playHeartEffect._clearTimer = setTimeout(() => { layer.innerHTML = ""; }, 1400);
}

/* ---------------- 本文の逐次表示 ---------------- */

// 1文字あたりの間隔。セリフは地の文よりゆっくり出す(喋る速さとして読めるように)
const TYPE_MS = { narration: 16, line: 32 };
// 既読は速める。1周で約150タップ・本文6000字あり、図鑑を埋めるには何周も要る。
// ただし即時にはしない — 文字送りの音が本作の手触りそのものなので、周回でも鳴らす
const READ_KEY = "sentimentalHanaeRead";
// 文字送りの切り替えは持たない。常に1文字ずつ出す(2026-08-26 本人指示)

let readSet = (() => {
  try {
    const a = JSON.parse(localStorage.getItem(READ_KEY) || "[]");
    return new Set(Array.isArray(a) ? a : []);
  } catch (e) {
    return new Set();
  }
})();

function markRead(key) {
  if (!key || readSet.has(key)) return;
  readSet.add(key);
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...readSet]));
  } catch (e) {
    /* 保存できなくても進行に影響させない */
  }
}

function renderSoundLabel() {
  const on = !AUDIO.isMuted();
  document.querySelectorAll(".js-sound").forEach((btn) => {
    btn.textContent = on ? "♪ オン" : "♪ オフ";
    btn.setAttribute("aria-label", "音の設定を開く");
  });
  const mute = el("btn-mute");
  if (mute) mute.textContent = on ? "音を消す" : "音を出す";
  const lv = AUDIO.getLevels();
  const bgm = el("vol-bgm"), se = el("vol-se");
  if (bgm) { bgm.value = Math.round(lv.bgm * 100); el("vol-bgm-out").textContent = bgm.value; }
  if (se) { se.value = Math.round(lv.se * 100); el("vol-se-out").textContent = se.value; }
}

/* ---------------- 音の設定パネル ---------------- */

function isSoundPanelOpen() {
  return !el("sound-panel").hidden;
}

function openSoundPanel() {
  renderSoundLabel();
  el("sound-panel").hidden = false;
  el("vol-bgm").focus();
}

function closeSoundPanel() {
  el("sound-panel").hidden = true;
}

function initSoundPanel() {
  document.querySelectorAll(".js-sound").forEach((btn) => {
    btn.onclick = () => (isSoundPanelOpen() ? closeSoundPanel() : openSoundPanel());
  });
  el("btn-sound-close").onclick = closeSoundPanel;
  el("btn-mute").onclick = () => {
    AUDIO.toggleMuted();
    renderSoundLabel();
  };
  const bind = (kind, input, out, preview) => {
    input.oninput = () => {
      AUDIO.setLevel(kind, input.value / 100);
      out.textContent = input.value;
    };
    // 離した時に一度鳴らして、いまの大きさを聞かせる
    input.onchange = () => { if (preview) preview(); };
  };
  bind("bgm", el("vol-bgm"), el("vol-bgm-out"), null);
  bind("se", el("vol-se"), el("vol-se-out"), () => AUDIO.se("heartSmall"));
  // パネルの外をタップしたら閉じる。開くボタン自身のタップは除く
  document.addEventListener("pointerdown", (ev) => {
    if (!isSoundPanelOpen()) return;
    if (ev.target.closest("#sound-panel") || ev.target.closest(".js-sound")) return;
    closeSoundPanel();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isSoundPanelOpen()) closeSoundPanel();
  });
}

let typeTimer = null;
let finishTyping = null; // 表示中に呼ぶと即座に全文表示する

// raw は改行を \n で含む素のテキスト。1文字ずつ出し、タップで即全表示できる
const TYPE_MS_READ = { narration: 8, line: 16 };

/* ---------------- 話者 ---------------- */

// 「」の中はセリフ、外は地の文。セリフの9割はハナエなので、それを既定にして
// 例外だけを名指しする。前後の地の文からの推測では、ハナエと西野が同じ場面に
// いる時に取り違える(全セリフを目視して確定させた結果がこのリスト)。
// 本文を書き換えるとここから外れてハナエ扱いになるだけで、壊れはしない。
// voice は AUDIO.blip の音色。0 = 地の文 / 1 = ハナエ / 2 = ハナエ以外 / 3 = 主人公
const SPEAKERS = {
  hanae:     { name: () => "ハナエ", voice: 1 },
  hero:      { name: () => state.name || "俺", voice: 3 },
  nishino:   { name: () => "西野", voice: 2 },
  touma:     { name: () => "トウマ", voice: 2 },
  komori:    { name: () => "小森", voice: 2 },
  iin:       { name: () => "委員", voice: 2 },
  broadcast: { name: () => "放送", voice: 2 },
  // E1 でまだ名乗っていないハナエ。ここで名前を出すと
  // 「それが味村ハナエとの、最初の会話だった」という締めが先に割れる
  unknown:   { name: () => "？？？", voice: 1 },
};

const SPEAKER_BY_LINE = new Map([
  ["「文化祭実行委員、集まってー」", "broadcast"],
  ["「あ、ちょうどええわ。そっちの机、こっち持ってきてくれる?」", "unknown"],
  ["「ハナエ、差し入れ。みんなでどうぞ」", "touma"],
  ["「昔から、コイツ試合負けた日は決まってコレなんですわ」", "touma"],
  ["「そういえば、西野が『ハナエに告白しよかな』とか言うてたで」", "iin"],
  ["「手伝うわ」", "nishino"],
  ["「せやろ、こう見えて器用やねん」", "nishino"],
  ["「ハナエさん、今度みんなでカラオケ行くらしいで、来る?」", "nishino"],
  ["「重そうやな、持とか?」", "nishino"],
  // 西野に礼を言っているのはハナエ。地の文に西野しか出てこないので推測が外れる
  ["「あ……うん、おおきに」", "hanae"],
  ["「え、今から?」", "hero"],
  ["「よろしく」", "hero"],
  ["「ハナエ、付き合ってほしい」", "hero"],
]);

// リストに無い新しいセリフ用の保険。地の文にハナエの名前が無く、他の登場人物の
// 名前だけがある時は別人とみなす。「兄」は入れない —— ハナエ自身が兄の話を
// 頻繁にするので、彼女のセリフを別人と誤判定する
const OTHER_SPEAKERS = [
  { word: "トウマ", key: "touma" },
  { word: "西野", key: "nishino" },
  { word: "小森", key: "komori" },
];

function speakerKeyFor(quote, raw, open, close) {
  const fixed = SPEAKER_BY_LINE.get(quote);
  if (fixed) return fixed;
  const near =
    raw.slice(Math.max(0, open - 24), open) + raw.slice(close + 1, close + 25);
  if (!near.includes("ハナエ")) {
    const other = OTHER_SPEAKERS.find((s) => near.includes(s.word));
    if (other) return other.key;
  }
  return "hanae";
}

// 記号では鳴らさない。句読点や鉤括弧まで鳴らすと、喋りではなく打鍵音に聞こえる
const NO_BLIP = /[\s、。，．・…‥「」『』【】（）()！!？?ー―—〜~＿_]/;

// 改行だけ <br> にして、それ以外は文字として出す。プレイヤーが入力した名前が
// 本文に混ざるので、素通しすると "<" ひとつで表示が壊れる
function toHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

// 名札。枠(.textbox)の data-speaker に話者名を入れ、CSS の ::before が左上に出す。
// 地の文では外す。本文は名前を含まない body を流す
function setSpeakerTab(elm, block) {
  const box = elm.closest(".textbox") || elm;
  if (block.speaker) {
    box.dataset.speaker = block.speaker;
    box.dataset.voice = String(block.voice);
  } else {
    delete box.dataset.speaker;
    delete box.dataset.voice;
  }
}

function clearSpeakerTab(box) {
  if (!box) return;
  delete box.dataset.speaker;
  delete box.dataset.voice;
}

// 読み上げ用。1文字ずつの書き換えをそのまま読ませると煩いので、出し終えた全文だけ渡す
function announce(text) {
  const live = el("sr-live");
  if (live) live.textContent = text;
}

function typeText(elm, block, onDone, readKey) {
  clearTimeout(typeTimer);
  const raw = block.body !== undefined ? block.body : block.text;
  const voice = block.voice;
  const html = toHtml(raw);
  setSpeakerTab(elm, block);
  const done = () => {
    clearTimeout(typeTimer);
    typeTimer = null;
    finishTyping = null;
    elm.innerHTML = html;
    elm.classList.remove("is-typing");
    markRead(readKey);
    announce(block.text);
    if (onDone) onDone();
  };
  if (raw.length === 0) {
    done();
    return;
  }
  // パネルの高さは CSS で固定してある(ブロックごとに測ると、文章の長短で
  // 枠がガタガタ動いて画面酔いの原因になる)

  const speed = readKey && readSet.has(readKey) ? TYPE_MS_READ : TYPE_MS;
  // ブロックの中に地の文とセリフが混ざることはもう無いので、間隔も音色も
  // ブロックごとに1つで足りる(混ざっていた頃は1文字ずつ引いていた)
  const per = voice === 0 ? speed.narration : speed.line;

  // 話者名は枠の名札に出してあるので、本文は括弧から1文字ずつ
  let i = 0;
  elm.innerHTML = "";
  elm.classList.add("is-typing");
  finishTyping = done;

  const step = () => {
    const ch = raw[i];
    i += 1;
    elm.innerHTML = toHtml(raw.slice(0, i));
    if (!NO_BLIP.test(ch)) AUDIO.blip(voice);
    if (i >= raw.length) {
      done();
      return;
    }
    typeTimer = setTimeout(step, per);
  };
  typeTimer = setTimeout(step, 0);
}

function skipTyping() {
  if (finishTyping) finishTyping();
}

/* ---------------- 本文のページ送り ---------------- */

// 1ブロックの上限。パネルの高さを固定して枠が動かないようにしたいので、
// 長い段落は文単位に割ってこの長さに収める
const BLOCK_MAX = 46;

// 「。」「!」「?」で切る。閉じ括弧は前の文に付ける。
// 正規表現の後読みは古い iOS Safari に無いので使わない
function splitSentences(p) {
  const out = [];
  let buf = "";
  for (let i = 0; i < p.length; i++) {
    buf += p[i];
    if ("。！？!?".indexOf(p[i]) >= 0) {
      while (i + 1 < p.length && "」』）)".indexOf(p[i + 1]) >= 0) {
        i += 1;
        buf += p[i];
      }
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

/* ---------------- 地の文とセリフの分離 ---------------- */

// 1つの枠に地の文とセリフを混ぜない。混ぜると文字送りの音が途中で入れ替わり、
// 地の文の音と会話の音が交ざって耳障りになる(2026-08-28 本人指示)。
// セリフは 名前「〜」 の形にして、誰が喋っているかを一目で分かるようにする。

// 言い切っているか(地の文の断片を繋ぎ直すかの判定に使う)
const SENT_END = /[。！？!?]$/;

// 断片を繋ぎ直す時に読点を入れるか。助詞で終わっていればそのまま次の語に続くので
// 入れない(「西野が」＋「加わってきた。」)。体言や連用形で終わる時は入れる
// (「翌日」＋「困惑される。」→「翌日、困惑される。」)
const TAIL_PARTICLE = /[がをにへとでもはのやか]$/;

// セリフを別ブロックに出すと、地の文の側に引用の「と」だけが残る。
// (「素直でよろしい」と軽く言われる。→ 「と軽く言われる。」)
function stripQuoteParticle(text) {
  return text.replace(/^\s*(?:と|って)(?=.)/, "").replace(/^[、，]\s*/, "");
}

// 1行を [{kind:"n"|"q", text, key}] に割る。
// raw と offset は話者推測(前後24字を見る)のために受け取る
function splitVoiceParts(line, raw, offset) {
  const toks = [];
  let i = 0;
  while (i < line.length) {
    const open = line.indexOf("「", i);
    if (open < 0) {
      toks.push({ kind: "n", text: line.slice(i) });
      break;
    }
    const close = line.indexOf("」", open + 1);
    if (close < 0) {
      // 閉じ括弧が無い行は割らない(壊れたデータで本文が消えるより出した方がよい)
      toks.push({ kind: "n", text: line.slice(i) });
      break;
    }
    if (open > i) toks.push({ kind: "n", text: line.slice(i, open) });
    const quote = line.slice(open, close + 1);
    toks.push({
      kind: "q",
      text: quote,
      key: speakerKeyFor(quote, raw, offset + open, offset + close),
    });
    i = close + 1;
  }
  toks.forEach((t, k) => {
    if (t.kind === "n" && k > 0 && toks[k - 1].kind === "q") {
      t.text = stripQuoteParticle(t.text);
    }
  });

  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === "q") {
      out.push(t);
      continue;
    }
    const txt = t.text.trim();
    if (!txt) continue;
    // セリフの前の地の文が言い切っていない時は、セリフの後ろの地の文と繋いで
    // 1つの文に戻す(「一瞬驚いた顔をして、」＋「と珍しく照れる。」)。
    // 言い切っている文はその場に残す —— 動かすと前後関係が変わってしまう
    const sents = splitSentences(txt);
    const tail =
      sents.length && !SENT_END.test(sents[sents.length - 1]) ? sents.pop() : "";
    if (tail && toks[k + 1] && toks[k + 1].kind === "q" && toks[k + 2] && toks[k + 2].kind === "n") {
      const head = sents.join("");
      if (head) out.push({ kind: "n", text: head });
      const joiner = /[、，]$/.test(tail) || TAIL_PARTICLE.test(tail) ? "" : "、";
      out.push({ kind: "n", text: tail + joiner + toks[k + 2].text.trim() });
      toks[k + 2].text = "";
      continue;
    }
    out.push({ kind: "n", text: txt });
  }
  return out;
}

// セリフ1つを 名前「〜」 のブロックにする。
// 長いセリフは文で割り、そのつど「」を閉じ直す(括弧が開きっぱなしにならない)
function dialogueBlocks(quote, key) {
  const speaker = SPEAKERS[key] || SPEAKERS.hanae;
  const label = speaker.name();
  const lead = label.length + 1; // 名前「 まではラベルなので一気に出す
  // text はバックログ用の全文(名前「〜」)、body は枠に流す本文(「〜」だけ)。
  // 名前は typeText が枠の名札に出すので、本文には含めない
  const wrap = (body) => ({
    text: label + "「" + body + "」",
    body: "「" + body + "」",
    speaker: label,
    voice: speaker.voice,
    lead: lead,
  });
  const inner = quote.slice(1, -1);
  const limit = Math.max(16, BLOCK_MAX - (label.length + 2));
  if (inner.length <= limit) return [wrap(inner)];
  const out = [];
  let buf = "";
  splitSentences(inner).forEach((sen) => {
    if (buf && (buf + sen).length > limit) {
      out.push(wrap(buf.replace(/[。、]$/, "")));
      buf = sen;
    } else {
      buf += sen;
    }
  });
  if (buf) out.push(wrap(buf.replace(/[。、]$/, "")));
  return out;
}

function narrationBlocks(text) {
  const mk = (t) => ({ text: t, body: t, speaker: "", voice: 0, lead: 0 });
  if (text.length <= BLOCK_MAX) return [mk(text)];
  const out = [];
  let buf = "";
  splitSentences(text).forEach((sen) => {
    if (buf && (buf + sen).length > BLOCK_MAX) {
      out.push(mk(buf));
      buf = sen;
    } else {
      buf += sen;
    }
  });
  if (buf) out.push(mk(buf));
  return out;
}

// 本文を送り単位に切る。改行で割り、地の文とセリフに分け、長いものは文で割る
function splitBlocks(raw) {
  const out = [];
  let offset = 0;
  raw.split("\n").forEach((line) => {
    const lead = line.length - line.replace(/^\s+/, "").length;
    const p = line.trim();
    if (p) {
      splitVoiceParts(p, raw, offset + lead).forEach((part) => {
        if (part.kind === "q") out.push(...dialogueBlocks(part.text, part.key));
        else out.push(...narrationBlocks(part.text));
      });
    }
    offset += line.length + 1;
  });
  return out;
}

// 次のブロックを待っている時だけ入る。表示中は null(タップは早送りに使う)
let pagerNext = null;

function clearPager(elm) {
  pagerNext = null;
  if (elm) elm.classList.remove("has-next");
}

// ブロックを1つずつ出し、最後まで出し終えたら onDone を呼ぶ
function playBlocks(elm, raw, readKey, onDone) {
  const blocks = splitBlocks(raw);
  clearPager(elm);
  if (!blocks.length) {
    if (onDone) onDone();
    return;
  }
  let i = 0;
  const show = () => {
    const last = i === blocks.length - 1;
    typeText(elm, blocks[i], () => {
      if (last) {
        clearPager(elm);
        if (onDone) onDone();
        return;
      }
      // ▼ を出してタップを待つ
      elm.classList.add("has-next");
      pagerNext = () => {
        pagerNext = null;
        elm.classList.remove("has-next");
        i += 1;
        show();
      };
    }, readKey ? readKey + "#" + i : null);
  };
  show();
}

/* ---------------- バックログ(これまでの話) ---------------- */

// 読み飛ばした本文を後から読み返すための履歴。
// 「選び直す」と違って選択そのものは取り消せない。取り消せると、反応を見てから
// 選び直す総当たりが成立してしまい、好感度を伏せている意味が無くなる
const LOG_LIMIT = 40;

function pushLog(title, body) {
  if (!Array.isArray(state.log)) state.log = [];
  const last = state.log[state.log.length - 1];
  // リロードで同じイベントが出し直された時に、同じ話が二重に積まれないようにする
  if (last && !last.c && last.t === title && last.b === body) return;
  state.log.push({ t: title || "", b: body || "", c: "", r: "" });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

// 選択を確定した時点で、直前の履歴に「選んだ内容」と「ハナエの反応」を足す
function attachLogChoice(label, reaction) {
  if (!Array.isArray(state.log) || !state.log.length) return;
  const last = state.log[state.log.length - 1];
  last.c = label || "";
  last.r = reaction || "";
}

// 履歴も本編と同じ割り方で見せる(セリフは 名前「〜」)。
// 表示と履歴で見え方が違うと、読み返した時に別物に見える
function logBody(text) {
  return splitBlocks(text)
    .map((b) => b.text)
    .join("\n");
}

// 本文は textContent で入れて CSS の pre-wrap で折る。
// innerHTML だと、シナリオに < が混ざった時に壊れる
function logLine(cls, text) {
  const p = document.createElement("p");
  p.className = cls;
  p.textContent = text;
  return p;
}

function renderLog() {
  const box = el("log-body");
  box.innerHTML = "";
  const entries = Array.isArray(state.log) ? state.log : [];
  if (!entries.length) {
    box.appendChild(logLine("log-empty", "まだ記録がありません。"));
    return;
  }
  entries.forEach((e) => {
    const item = document.createElement("section");
    item.className = "log-item";
    if (e.t) {
      const h = document.createElement("h3");
      h.className = "log-title";
      h.textContent = e.t;
      item.appendChild(h);
    }
    if (e.b) item.appendChild(logLine("log-text", logBody(e.b)));
    if (e.c) item.appendChild(logLine("log-choice", "→ " + e.c));
    if (e.r) item.appendChild(logLine("log-react", logBody(e.r)));
    box.appendChild(item);
  });
}

function isLogOpen() {
  return el("log-overlay").classList.contains("is-open");
}

function openLog() {
  renderLog();
  const box = el("log-overlay");
  box.classList.add("is-open");
  box.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  el("btn-log-close").focus();
  // いま読んでいる場面(いちばん下)を開く。上から読み直したい時だけ遡ればよい
  const scroller = el("log-body");
  scroller.scrollTop = scroller.scrollHeight;
}

function closeLog() {
  const box = el("log-overlay");
  box.classList.remove("is-open");
  box.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  const btn = el("btn-log");
  if (btn && btn.offsetParent !== null) btn.focus();
}

/* ---------------- イベント表示 ---------------- */

function buildEventText(rawText, key) {
  let text = rawText;
  // 伏線は一度だけ差し込む。毎回付けると同じ一文が終盤まで延々繰り返され、
  // 伏線ではなく表示バグに見える
  if (!state.foreshadowShown && state.rival >= GAME_DATA.foreshadowThreshold) {
    state.foreshadowShown = true;
    text += GAME_DATA.foreshadowLine;
  }
  // 噂を聞いて「様子を見る」を選んだ後の E19 だけ、西野の影を一行足す
  if (key === "E19" && state.rivalInsertShown && !state.senshu && GAME_DATA.events.E19.rumorLine) {
    text += GAME_DATA.events.E19.rumorLine;
  }
  return text;
}

// onCommit は「選択を押した瞬間」に呼ぶ。ここで進行状態まで確定させて保存する。
// onChoice は「つづける」を押した後の画面遷移だけを担当する
function showEvent(key, eventData, scene, onChoice, onCommit) {
  showScreen("screen-event");
  applyScene(scene);
  AUDIO.playBgm(bgmForKey(key));
  el("event-reaction").innerHTML = "";
  el("reaction-wrap").classList.remove("is-shown");
  clearSpeakerTab(el("reaction-wrap"));
  el("reaction-actions").innerHTML = "";
  el("reaction-actions").classList.remove("is-shown");
  el("screen-event").classList.remove("is-reacting");
  const choicesEl = el("event-choices");
  choicesEl.innerHTML = "";
  // 本文を読み終わるまで選択肢は出さない。連打で読み飛ばして誤爆するのを防ぐ
  choicesEl.style.display = "none";
  window.scrollTo(0, 0);

  // 伏線の差し込みまで済ませた「実際に表示した本文」を履歴に残す
  const bodyText = buildEventText(eventData.text, key);
  pushLog(eventData.title || "", bodyText);

  // 本文と選択肢を同時に出すと、読み終える前に選ぶことになる。
  // 最後のブロックを読んだあと、もう一度タップさせてから選択肢を出す
  const textEl = el("event-text");
  textEl.innerHTML = "";
  clearSpeakerTab(textEl.closest(".textbox"));
  const token = ++showEvent._token;
  showTelop(dateLabel("screen-event"), placeFor(scene), readSet.has("t:" + key + "#0")).then(() => {
    // テロップの間にタイトルへ戻られたら、その本文は出さない
    if (token !== showEvent._token) return;
    playBlocks(textEl, bodyText, "t:" + key, () => {
      textEl.classList.add("has-next");
      pagerNext = () => {
        pagerNext = null;
        textEl.classList.remove("has-next");
        renderChoices(key, eventData, scene, choicesEl, onChoice, onCommit);
      };
    });
  });
}
showEvent._token = 0;

function renderChoices(key, eventData, scene, choicesEl, onChoice, onCommit) {
  choicesEl.innerHTML = "";
  choicesEl.style.display = "flex";

  // 本文を早送りしたタップがそのまま選択肢に流れ込まないよう、描画直後は受け付けない
  choicesEl.classList.add("is-locked");
  clearTimeout(showEvent._unlockTimer);
  showEvent._unlockTimer = setTimeout(() => {
    choicesEl.classList.remove("is-locked");
  }, CHOICE_LOCK_MS + eventData.choices.length * CHOICE_STAGGER_MS);

  eventData.choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = choice.label;
    btn.style.animationDelay = (i * CHOICE_STAGGER_MS) / 1000 + "s";
    btn.onclick = () => {
      if (choicesEl.classList.contains("is-locked")) return;
      AUDIO.se("choice");
      // 選んだ肢だけ残して他を沈め、一拍置いてから消す。押した実感を出すため
      choicesEl.classList.add("is-locked", "is-decided");
      btn.classList.add("is-chosen");
      const points = choice.points || 0;
      state.score += points;
      state.rival = Math.max(0, state.rival + (choice.rival || 0));
      if (choice.tag === "pushy") state.pushyCount++;
      if (choice.tag === "passive") state.passiveCount++;
      attachLogChoice(choice.label, choice.reaction);
      // 進行(queueIndex など)も選択と同時に確定させてから保存する。
      // ここを「つづける」まで遅らせると、反応を読んでいる途中で閉じた時に
      // 点数だけ入った状態で同じイベントがもう一度出て、二重に加算される
      if (onCommit) onCommit(choice);
      saveGame();
      const hold = reducedMotion() ? 0 : CHOICE_HOLD_MS;
      setTimeout(() => {
        // 一拍の間にタイトルへ戻られていたら、反応は出さない(進行は保存済み)
        const active = document.querySelector(".screen.active");
        if (!active || active.id !== "screen-event") return;
        choicesEl.style.display = "none";
        choicesEl.classList.remove("is-decided");
        btn.classList.remove("is-chosen");
        showReaction(key, choice, scene, points, onChoice);
      }, hold);
    };
    choicesEl.appendChild(btn);
  });
}

function showReaction(key, choice, scene, points, onChoice) {
      // 表情は選択肢ごとの指定を最優先する。点数からの自動判定は指定漏れの保険。
      // 本文中は不在の場面(E6)でも、反応では reactionSprite で顔を出す。
      // ハートより先に出すこと —— ハートは立ち絵の顔めがけて飛ばすので、
      // 立ち絵が出ていないと画面中央の飾りになってしまう
      const outfit = scene && (scene.sprite || scene.reactionSprite);
      const expr = choice.expr || exprFor(points, choice.tag);
      if (outfit) {
        setSprite(outfit, expr);
        playSpriteMotion(SPRITE_MOTION[expr]);
      }
      playHeartEffect(points);

      // 反応も本文と同じページ送りにする。1枠に地の文とセリフを混ぜないため、
      // 「〜」と地の文。の形の反応は2ブロックに割れる
      const reactionEl = el("event-reaction");
      el("reaction-wrap").classList.add("is-shown");
      reactionEl.innerHTML = "";
      // ボタンは枠の中の右下に浮かせる。枠の下に置くと、出た瞬間にその高さぶん
      // 枠が上へ動いてしまう(画面下端に寄せているため)
      const actions = el("reaction-actions");
      actions.innerHTML = "";
      actions.classList.remove("is-shown");
      // 横向きの携帯だけ、反応を出している間は本文を畳む(CSS 側で判定)
      el("screen-event").classList.add("is-reacting");
      playBlocks(reactionEl, choice.reaction || "", "r:" + key + ":" + choice.id, () => {
        const nextBtn = document.createElement("button");
        nextBtn.className = "next-btn";
        nextBtn.textContent = "つづける";
        nextBtn.onclick = () => {
          AUDIO.se("next");
          onChoice(choice);
        };
        actions.appendChild(nextBtn);
        actions.classList.add("is-shown");
      });
}

/* ---------------- 自由行動フェーズ ---------------- */

function showFreeSelect() {
  showScreen("screen-free");
  applyScene(sceneFor("FREE"));
  AUDIO.playBgm(bgmForKey("FREE"));
  el("free-remaining").textContent = `あと${state.freePicksLeft}つ選べます`;
  const list = el("free-list");
  list.innerHTML = "";
  // 選択肢と同じ理由で、描画直後は受け付けない
  list.classList.add("is-locked");
  clearTimeout(showFreeSelect._unlockTimer);
  showFreeSelect._unlockTimer = setTimeout(() => {
    list.classList.remove("is-locked");
  }, CHOICE_LOCK_MS + state.freeRemaining.length * CHOICE_STAGGER_MS);

  state.freeRemaining.forEach((key, i) => {
    const data = GAME_DATA.freePool[key];
    const card = document.createElement("button");
    card.className = "free-card";
    const cardTitle = document.createElement("span");
    cardTitle.className = "free-card-title";
    cardTitle.textContent = data.title;
    card.appendChild(cardTitle);
    if (data.blurb) {
      const blurb = document.createElement("span");
      blurb.className = "free-blurb";
      blurb.textContent = data.blurb;
      card.appendChild(blurb);
    }
    card.style.animationDelay = (i * CHOICE_STAGGER_MS) / 1000 + "s";
    card.onclick = () => {
      if (list.classList.contains("is-locked")) return;
      AUDIO.se("choice");
      state.freeChosen.push(key);
      state.freeRemaining = state.freeRemaining.filter((k) => k !== key);
      state.freePicksLeft--;
      showEvent(
        key,
        data,
        sceneFor(key),
        () => {
          if (state.freePicksLeft > 0) showFreeSelect();
          else advanceQueue();
        },
        () => {
          if (state.freePicksLeft > 0) return;
          // 3つ選び終えた。西野の場面を避けたぶんはここでライバル度に乗せる
          if (!state.freeChosen.includes("F5_nishino")) {
            state.rival = Math.max(0, state.rival + GAME_DATA.SKIP_F5_RIVAL_PENALTY);
          }
          state.queueIndex++;
        }
      );
    };
    list.appendChild(card);
  });
}

/* ---------------- 進行 ---------------- */

function advanceQueue() {
  saveGame();
  if (state.queueIndex >= QUEUE.length) {
    startConfession();
    return;
  }
  const key = QUEUE[state.queueIndex];

  if (key === "FREE") {
    if (state.freePicksLeft <= 0) {
      state.queueIndex++;
      advanceQueue();
      return;
    }
    showFreeSelect();
    return;
  }

  // Act3開始時にドリフトを一度だけ加算
  if (key === "E14" && !state.act3DriftApplied) {
    state.rival = Math.max(0, state.rival + GAME_DATA.ACT3_RIVAL_DRIFT);
    state.act3DriftApplied = true;
  }

  // E19直前、ライバル度が閾値以上なら割り込みイベント
  if (key === "E19" && state.rival >= GAME_DATA.RIVAL_FAIL_THRESHOLD && !state.rivalInsertShown) {
    state.rivalInsertShown = true;
    saveGame();
    showEvent(
      "RIVAL",
      GAME_DATA.rivalInsert,
      sceneFor("RIVAL"),
      (choice) => {
        if (choice.flag === "senshu") advanceQueue();
        else advanceEventThenNext(key);
      },
      (choice) => {
        // 先手を打つ: 西野エンドは回避できるが、最後の一日(E19)を捨てることになる
        if (choice.flag !== "senshu") return;
        state.senshu = true;
        state.queueIndex = QUEUE.length;
      }
    );
    return;
  }

  advanceEventThenNext(key);
}

function advanceEventThenNext(key) {
  const eventData = GAME_DATA.events[key];
  showEvent(
    key,
    eventData,
    sceneFor(key),
    () => advanceQueue(),
    (choice) => {
      if (GAME_DATA.perfectRoute[key]) {
        state.perfect[key] = choice.id === GAME_DATA.perfectRoute[key];
      }
      state.queueIndex++;
    }
  );
}

/* ---------------- 告白・エンディング ---------------- */

function startConfession() {
  showScreen("screen-confession");
  applyScene(sceneFor("CONFESSION"));
  AUDIO.playBgm(bgmForKey("CONFESSION"));
  const intro = state.senshu ? GAME_DATA.confessionIntroSenshu : GAME_DATA.confessionIntro;
  const btn = el("btn-confess");
  btn.style.display = "none";
  btn.disabled = false;
  // 曲を切って無音の一拍を置き、暗転してから結末へ。ここは音楽で押すより、止めた方が効く
  btn.onclick = () => {
    btn.disabled = true;
    AUDIO.se("next");
    AUDIO.stopBgm(450);
    fadeTo(true, 800).then(() => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 500)))
      .then(() => {
        resolveEnding();
        return fadeTo(false, 1100);
      });
  };
  window.scrollTo(0, 0);
  const introText = withName(intro);
  pushLog("告白", introText);
  const readKey = state.senshu ? "confession:senshu" : "confession";
  const confEl = el("confession-text");
  confEl.innerHTML = "";
  showTelop(dateLabel("screen-confession"), placeFor(sceneFor("CONFESSION")), readSet.has(readKey + "#0")).then(() => {
    if (document.querySelector(".screen.active").id !== "screen-confession") return;
    playBlocks(confEl, introText, readKey, () => {
      btn.style.display = "block";
    });
  });
}

function resolveEnding() {
  let endingKey;
  if (!state.senshu && state.rival >= GAME_DATA.RIVAL_FAIL_THRESHOLD) {
    endingKey = "nishino";
  } else if (state.score >= GAME_DATA.SUCCESS_THRESHOLD) {
    const allPerfect = Object.keys(GAME_DATA.perfectRoute).every((k) => state.perfect[k]);
    endingKey = allPerfect ? "successPerfect" : "success";
  } else if (state.score >= GAME_DATA.FRIEND_THRESHOLD) {
    endingKey = "friend";
  } else {
    endingKey = state.pushyCount > state.passiveCount ? "awkward" : "soretigai";
  }

  state.finished = true;
  saveGame();
  const isNew = recordEnding(endingKey);

  const ending = GAME_DATA.endings[endingKey];
  showScreen("screen-ending");
  applyScene(GAME_DATA.endingScenes[endingKey]);
  AUDIO.playBgm(BGM_ENDING[endingKey], 700);
  if (isNew) setTimeout(() => AUDIO.se("ending"), 250);
  const badge = el("ending-new");
  badge.style.display = isNew ? "block" : "none";
  badge.textContent = endingKey === "successPerfect"
    ? "NEW — 最も到達が難しいエンディングです"
    : "NEW — 初めて見るエンディングです";
  el("ending-title").textContent = ending.title;
  // エンディングは本編で一番長い(パーフェクトは21ブロック)。ここもページ送りにする
  const restartBtn = el("btn-restart");
  restartBtn.style.display = "none";
  el("ending-foot").style.display = "none";
  playBlocks(el("ending-text"), ending.text, "end:" + endingKey, () => {
    restartBtn.style.display = "block";
    el("ending-foot").style.display = "block";
  });
  const seen = loadSeenEndings();
  // 1行に詰めると狭い画面で3行に折れて読みにくい。文の切れ目で必ず改行する
  // (.ending-note は white-space: pre-line)
  el("ending-note").textContent =
    `エンディングは全${GAME_DATA.endingOrder.length}種類(到達済み ${seen.length})。\n選択を変えると結末が変わります。`;
  window.scrollTo(0, 0);
  el("btn-restart").onclick = () => {
    AUDIO.se("next");
    fadeTo(true, 500).then(() => {
      state = freshState();
      initTitleScreen();
      return fadeTo(false, 600);
    });
  };
}

/* ---------------- 起動 ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  preloadAssets();
  preloadExpressions();
  initSpriteMotion();
  // ロゴは復号が済んでから浮かび上がらせる。読み込み中に空白の場所へ
  // 「画面をタップ」だけが先に出るのを防ぐ
  const logo = document.querySelector(".game-logo");
  if (logo) {
    const ready = () => logo.classList.add("is-ready");
    (logo.decode ? logo.decode() : Promise.resolve()).then(ready, ready);
  }
  // 進行はセーブ済みなので、タイトルに戻っても「つづきから」で復帰できる
  initSoundPanel();
  renderSoundLabel();
  // iOS も Chrome も、最初のタップより前は音を出せない。
  // 環境によって拾えるイベントが違うので、最初に来たものを使う
  const UNLOCK_EVENTS = ["pointerdown", "touchstart", "mousedown", "click", "keydown"];
  const unlockAudio = () => {
    AUDIO.unlock();
    UNLOCK_EVENTS.forEach((n) => document.removeEventListener(n, unlockAudio));
  };
  UNLOCK_EVENTS.forEach((n) => document.addEventListener(n, unlockAudio));
  // 解錠しても最初の1曲が鳴り出さないことがある(読み込み待ち・play() の空振り)。
  // 操作のたびに鳴っているか確かめて、止まっていれば鳴らし直す。
  // 鳴っていれば何もしないので、押すたびに曲が頭出しされることはない
  document.addEventListener("pointerdown", () => AUDIO.resume(), { passive: true });
  // 画面をロックして戻ってくると音が止まったままになることがある
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") AUDIO.resume();
  });
  el("btn-log").onclick = openLog;
  el("btn-log-close").onclick = closeLog;
  // 余白をタップしても閉じる。パネルの中のタップは拾わない
  el("log-overlay").addEventListener("click", (ev) => {
    if (ev.target === el("log-overlay")) closeLog();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isLogOpen()) closeLog();
  });
  el("btn-title").onclick = () => {
    clearTimeout(typeTimer);
    finishTyping = null;
    pagerNext = null;
    showEvent._token++;
    saveGame();
    initTitleScreen();
  };
  // 表示中のタップは早送り、出し終わっていればページ送り。
  // ボタンの上だけは拾わない(選択肢の誤爆を防ぐ)
  ["screen-event", "screen-confession", "screen-prologue", "screen-ending"].forEach((id) => {
    el(id).addEventListener("click", (ev) => {
      if (ev.target.closest("button") || ev.target.closest("a")) return;
      if (finishTyping) {
        skipTyping();
        return;
      }
      if (pagerNext) pagerNext();
    });
  });
  initTitleScreen();
});
