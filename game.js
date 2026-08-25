/* ==========================================================================
   センチメンタル・ハナエ - ゲームエンジン
   ========================================================================== */

const SAVE_KEY = "sentimentalHanaeSave";
const ASSET_DIR = "assets/";
// 画像にもキャッシュバスターを付ける。付けないと、後から表情を差し替えたり
// 追加したりした時に、古い画像や過去の404がブラウザに残り続ける。
// index.html の ?v= と同じ数字に揃えること
const ASSET_V = "?v=28";

// 選択肢を描画してから受け付けるまでの猶予(誤タップ防止)と、1つずつ現れる間隔
const CHOICE_LOCK_MS = 320;
const CHOICE_STAGGER_MS = 55;

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
  let label;
  if (screenId === "screen-confession") label = "文化祭 最終日 ―― 後夜祭のあと";
  else if (left <= 1) label = "文化祭 前日";
  else label = `文化祭まで あと${left}日`;
  el("hud-progress").textContent = label;

  const done = Math.max(0, totalSteps() - left);
  el("hud-bar-fill").style.width = Math.min(100, (done / totalSteps()) * 100) + "%";
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
  updateLayout();
}

// 広い画面では、立ち絵が出ている間だけ本文を左カラムに寄せる。
// 常に寄せるとタイトル画面まで左に偏り、立ち絵の有無で切り替えるだけだと
// プレイ中に本文の位置が飛ぶので、「プレイ中」も条件に含める
function updateLayout() {
  const active = document.querySelector(".screen.active");
  const id = active ? active.id : "";
  const playing = id === "screen-event" || id === "screen-free" || id === "screen-confession";
  // 表示中かどうかは currentOutfit で見る。要素の inline style は初回描画前が
  // 空文字なので、"none ではない" だと立ち絵を出す前から出ている扱いになる
  const spriteVisible = !!currentOutfit;
  el("app").classList.toggle("col-left", playing || spriteVisible);
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
  // 広い画面だけ、タイトルにもハナエを立たせる。狭い画面の立ち絵は右上の
  // 円形アイコンになる作りなので、出すとロゴに重なってしまう
  const wide = window.matchMedia && window.matchMedia("(min-width: 1060px)").matches;
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
  el("btn-start").onclick = () => {
    AUDIO.se("next");
    const nameInput = el("player-name-input").value.trim();
    state = freshState();
    state.name = nameInput || "あなた";
    saveGame();
    showPrologue();
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
  const openTitle = () => {
    AUDIO.unlock();
    screen.classList.remove("is-gated");
    document.removeEventListener("click", openTitle);
  };
  document.addEventListener("click", openTitle);
}

/* ---------------- プロローグ ---------------- */

// 新規プレイの時だけ出す回想フレーム。「つづきから」では出さない
function showPrologue() {
  showScreen("screen-prologue");
  applyScene(sceneFor("PROLOGUE"));
  const btn = el("btn-prologue-next");
  btn.style.display = "none";
  btn.onclick = () => { advanceQueue(); };
  window.scrollTo(0, 0);
  pushLog("プロローグ", GAME_DATA.prologue);
  playBlocks(el("prologue-text"), GAME_DATA.prologue, "prologue", () => {
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
// 既読は速める。1周で約100タップ・本文6000字あり、図鑑を埋めるには何周も要る。
// ただし即時にはしない — 文字送りの音が本作の手触りそのものなので、周回でも鳴らす
const READ_KEY = "sentimentalHanaeRead";
const SPEED_KEY = "sentimentalHanaeSpeed";

let readSet = (() => {
  try {
    const a = JSON.parse(localStorage.getItem(READ_KEY) || "[]");
    return new Set(Array.isArray(a) ? a : []);
  } catch (e) {
    return new Set();
  }
})();

// "type" = 逐次表示(既定) / "instant" = 常に即時表示
let textSpeed = (() => {
  try {
    return localStorage.getItem(SPEED_KEY) === "instant" ? "instant" : "type";
  } catch (e) {
    return "type";
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

function toggleTextSpeed() {
  textSpeed = textSpeed === "instant" ? "type" : "instant";
  try { localStorage.setItem(SPEED_KEY, textSpeed); } catch (e) {}
  renderSpeedLabel();
}

function renderSoundLabel() {
  const on = !AUDIO.isMuted();
  document.querySelectorAll(".js-sound").forEach((btn) => {
    btn.textContent = on ? "♪ オン" : "♪ オフ";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "音を消す" : "音を出す");
  });
}

function renderSpeedLabel() {
  const btn = el("btn-speed");
  if (!btn) return;
  btn.textContent = textSpeed === "instant" ? "文字送り: 即時" : "文字送り: 逐次";
  btn.setAttribute("aria-pressed", textSpeed === "instant" ? "true" : "false");
}

let typeTimer = null;
let finishTyping = null; // 表示中に呼ぶと即座に全文表示する

// raw は改行を \n で含む素のテキスト。1文字ずつ出し、タップで即全表示できる
const TYPE_MS_READ = { narration: 8, line: 16 };

// 「」の中はセリフ、外は地の文。セリフの9割はハナエなので、それを既定にして
// 例外だけを名指しする。前後の地の文からの推測では、ハナエと西野が同じ場面に
// いる時に取り違える(全59セリフを目視して確定させた結果がこの2つのリスト)。
// 本文を書き換えるとここから外れてハナエの声になるだけで、壊れはしない
const LINES_OTHER = new Set([
  "「文化祭実行委員、集まってー」",
  "「ハナエ、差し入れ。みんなでどうぞ」",
  "「昔から、コイツ試合負けた日は決まってコレなんですわ」",
  "「手伝うわ」",
  "「せやろ、こう見えて器用やねん」",
  "「ハナエさん、今度みんなでカラオケ行くらしいで、来る?」",
  "「重そうやな、持とか?」",
  "「そういえば、西野が『ハナエに告白しよかな』とか言うてたで」",
]);
const LINES_HERO = new Set(["「え、今から?」", "「よろしく」"]);

// リストに無い新しいセリフ用の保険。地の文にハナエの名前が無く、他の登場人物の
// 名前だけがある時は別人とみなす。「兄」は入れない —— ハナエ自身が兄の話を
// 頻繁にするので、彼女のセリフを別人と誤判定する
const OTHER_SPEAKERS = ["トウマ", "西野", "小森"];

// 0 = 地の文 / 1 = ハナエ / 2 = ハナエ以外の登場人物 / 3 = 主人公
function voiceMapFor(raw) {
  const map = new Array(raw.length).fill(0);
  let i = 0;
  while (i < raw.length) {
    const open = raw.indexOf("「", i);
    if (open < 0) break;
    let close = raw.indexOf("」", open + 1);
    if (close < 0) close = raw.length - 1;
    const quote = raw.slice(open, close + 1);
    let voice = 1;
    if (LINES_HERO.has(quote)) {
      voice = 3;
    } else if (LINES_OTHER.has(quote)) {
      voice = 2;
    } else {
      const near =
        raw.slice(Math.max(0, open - 24), open) + raw.slice(close + 1, close + 25);
      if (!near.includes("ハナエ") && OTHER_SPEAKERS.some((n) => near.includes(n))) {
        voice = 2;
      }
    }
    for (let k = open; k <= close; k++) map[k] = voice;
    i = close + 1;
  }
  return map;
}

// 記号では鳴らさない。句読点や鉤括弧まで鳴らすと、喋りではなく打鍵音に聞こえる
const NO_BLIP = /[\s、。，．・…‥「」『』（）()！!？?ー―—〜~＿_]/;

function typeText(elm, raw, onDone, readKey) {
  clearTimeout(typeTimer);
  const html = raw.replace(/\n/g, "<br>");
  const done = () => {
    clearTimeout(typeTimer);
    typeTimer = null;
    finishTyping = null;
    elm.innerHTML = html;
    elm.classList.remove("is-typing");
    markRead(readKey);
    if (onDone) onDone();
  };
  // アニメーション低減はここでは見ない。文字送りは飾りではなく本作の読ませ方
  // そのもので、止めると喋り音も鳴らなくなる。飛ばしたい人は HUD の「即時」で
  const instant = textSpeed === "instant";
  if (instant || raw.length === 0) {
    done();
    return;
  }
  // パネルの高さは CSS で固定してある(ブロックごとに測ると、文章の長短で
  // 枠がガタガタ動いて画面酔いの原因になる)

  const voices = voiceMapFor(raw);
  const speed = readKey && readSet.has(readKey) ? TYPE_MS_READ : TYPE_MS;

  let i = 0;
  elm.innerHTML = "";
  elm.classList.add("is-typing");
  finishTyping = done;

  const step = () => {
    const ch = raw[i];
    i += 1;
    elm.innerHTML = raw.slice(0, i).replace(/\n/g, "<br>");
    if (!NO_BLIP.test(ch)) AUDIO.blip(voices[i - 1]);
    if (i >= raw.length) {
      done();
      return;
    }
    typeTimer = setTimeout(step, voices[i] ? speed.line : speed.narration);
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

// 本文を送り単位に切る。空行と改行で割り、それでも長いものは文で割って詰め直す
function splitBlocks(raw) {
  const out = [];
  raw.split(/\n/).forEach((line) => {
    const p = line.trim();
    if (!p) return;
    if (p.length <= BLOCK_MAX) {
      out.push(p);
      return;
    }
    let buf = "";
    splitSentences(p).forEach((s) => {
      if (buf && (buf + s).length > BLOCK_MAX) {
        out.push(buf);
        buf = s;
      } else {
        buf += s;
      }
    });
    if (buf) out.push(buf);
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
    if (e.b) item.appendChild(logLine("log-text", e.b));
    if (e.c) item.appendChild(logLine("log-choice", "→ " + e.c));
    if (e.r) item.appendChild(logLine("log-react", e.r));
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

function buildEventText(rawText) {
  let text = rawText;
  // 伏線は一度だけ差し込む。毎回付けると同じ一文が終盤まで延々繰り返され、
  // 伏線ではなく表示バグに見える
  if (!state.foreshadowShown && state.rival >= GAME_DATA.foreshadowThreshold) {
    state.foreshadowShown = true;
    text += GAME_DATA.foreshadowLine;
  }
  return text;
}

function showEvent(key, eventData, scene, onChoice) {
  showScreen("screen-event");
  applyScene(scene);
  AUDIO.playBgm(bgmForKey(key));
  el("event-reaction").innerHTML = "";
  el("event-reaction").style.display = "none";
  const choicesEl = el("event-choices");
  choicesEl.innerHTML = "";
  // 本文を読み終わるまで選択肢は出さない。連打で読み飛ばして誤爆するのを防ぐ
  choicesEl.style.display = "none";
  window.scrollTo(0, 0);

  // 伏線の差し込みまで済ませた「実際に表示した本文」を履歴に残す
  const bodyText = buildEventText(eventData.text);
  pushLog(eventData.title || "", bodyText);

  playBlocks(el("event-text"), bodyText, "t:" + key, () => {
    renderChoices(key, eventData, scene, choicesEl, onChoice);
  });
}

function renderChoices(key, eventData, scene, choicesEl, onChoice) {
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
      choicesEl.style.display = "none";
      const points = choice.points || 0;
      state.score += points;
      state.rival = Math.max(0, state.rival + (choice.rival || 0));
      if (choice.tag === "pushy") state.pushyCount++;
      if (choice.tag === "passive") state.passiveCount++;
      attachLogChoice(choice.label, choice.reaction);
      // 選択を確定した時点で保存する(リアクション表示中に閉じても巻き戻らない)
      saveGame();
      playHeartEffect(points);
      // 表情は選択肢ごとの指定を最優先する。点数からの自動判定は指定漏れの保険
      if (scene && scene.sprite) setSprite(scene.sprite, choice.expr || exprFor(points, choice.tag));

      const reactionEl = el("event-reaction");
      reactionEl.style.display = "block";
      reactionEl.innerHTML = "";
      const body = document.createElement("div");
      reactionEl.appendChild(body);
      typeText(body, choice.reaction || "", () => {
        const row = document.createElement("div");
        row.className = "reaction-actions";

        const nextBtn = document.createElement("button");
        nextBtn.className = "next-btn";
        nextBtn.textContent = "つづける";
        nextBtn.onclick = () => {
          AUDIO.se("next");
          onChoice(choice);
        };
        row.appendChild(nextBtn);

        reactionEl.appendChild(row);
      }, "r:" + key + ":" + choice.id);
    };
    choicesEl.appendChild(btn);
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
    card.textContent = data.title;
    card.style.animationDelay = (i * CHOICE_STAGGER_MS) / 1000 + "s";
    card.onclick = () => {
      if (list.classList.contains("is-locked")) return;
      AUDIO.se("choice");
      state.freeChosen.push(key);
      state.freeRemaining = state.freeRemaining.filter((k) => k !== key);
      state.freePicksLeft--;
      showEvent(key, data, sceneFor(key), () => {
        if (state.freePicksLeft > 0) {
          saveGame();
          showFreeSelect();
        } else {
          if (!state.freeChosen.includes("F5_nishino")) {
            state.rival = Math.max(0, state.rival + GAME_DATA.SKIP_F5_RIVAL_PENALTY);
          }
          state.queueIndex++;
          saveGame();
          advanceQueue();
        }
      });
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
    showEvent("RIVAL", GAME_DATA.rivalInsert, sceneFor("RIVAL"), (choice) => {
      if (choice.flag === "senshu") {
        // 先手を打つ: 西野エンドは回避できるが、最後の一日(E19)を捨てることになる
        state.senshu = true;
        state.queueIndex = QUEUE.length;
        saveGame();
        advanceQueue();
        return;
      }
      advanceEventThenNext(key);
    });
    return;
  }

  advanceEventThenNext(key);
}

function advanceEventThenNext(key) {
  const eventData = GAME_DATA.events[key];
  showEvent(key, eventData, sceneFor(key), (choice) => {
    if (GAME_DATA.perfectRoute[key]) {
      state.perfect[key] = choice.id === GAME_DATA.perfectRoute[key];
    }
    state.queueIndex++;
    advanceQueue();
  });
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
  // 曲を切って無音の一拍を置く。ここは音楽で押すより、止めた方が効く
  btn.onclick = () => {
    btn.disabled = true;
    AUDIO.se("next");
    AUDIO.stopBgm(450);
    setTimeout(resolveEnding, 950);
  };
  window.scrollTo(0, 0);
  const introText = intro.replace("{name}", state.name);
  pushLog("告白", introText);
  playBlocks(el("confession-text"), introText, state.senshu ? "confession:senshu" : "confession", () => {
    btn.style.display = "block";
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
  el("ending-note").textContent =
    `エンディングは全${GAME_DATA.endingOrder.length}種類(到達済み ${seen.length})。選択を変えると結末が変わります。`;
  window.scrollTo(0, 0);
  el("btn-restart").onclick = () => {
    AUDIO.se("next");
    state = freshState();
    initTitleScreen();
  };
}

/* ---------------- 起動 ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  preloadAssets();
  preloadExpressions();
  // 進行はセーブ済みなので、タイトルに戻っても「つづきから」で復帰できる
  el("btn-speed").onclick = toggleTextSpeed;
  renderSpeedLabel();
  renderSoundLabel();
  document.querySelectorAll(".js-sound").forEach((btn) => {
    btn.onclick = () => {
      AUDIO.toggleMuted();
      renderSoundLabel();
    };
  });
  // iOS も Chrome も、最初のタップより前は音を出せない。
  // 環境によって拾えるイベントが違うので、最初に来たものを使う
  const UNLOCK_EVENTS = ["pointerdown", "touchstart", "mousedown", "click", "keydown"];
  const unlockAudio = () => {
    AUDIO.unlock();
    UNLOCK_EVENTS.forEach((n) => document.removeEventListener(n, unlockAudio));
  };
  UNLOCK_EVENTS.forEach((n) => document.addEventListener(n, unlockAudio));
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
