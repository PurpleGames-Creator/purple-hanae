/* ==========================================================================
   センチメンタル・ハナエ - ゲームエンジン
   ========================================================================== */

const SAVE_KEY = "sentimentalHanaeSave";
const ASSET_DIR = "assets/";

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

/* ---------------- 画面制御 ---------------- */

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el(id).classList.add("active");
  renderHud(id);
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
  back.style.backgroundImage = `url("${ASSET_DIR}${bgName}.webp")`;
  void back.offsetWidth;
  back.classList.add("bg-show");
  front.classList.remove("bg-show");
  bgFront = back.id;
  currentBg = bgName;
}

// 表情差分ファイルがあれば使い、無ければ基本立ち絵にフォールバックする。
// 追加する場合のファイル名: assets/hanae_summer_<expr>.webp
// expr = joy / smile / normal / trouble / sad / angry
function setSprite(outfit, expr) {
  const img = el("sprite");
  if (!outfit) {
    img.style.display = "none";
    img.removeAttribute("src");
    currentOutfit = null;
    return;
  }
  const base = `${ASSET_DIR}hanae_${outfit}.webp`;
  const wanted = expr ? `${ASSET_DIR}hanae_${outfit}_${expr}.webp` : base;
  img.onerror = () => {
    img.onerror = null;
    if (img.getAttribute("src") !== base) img.src = base;
  };
  img.style.display = "block";
  if (img.getAttribute("src") !== wanted) img.src = wanted;
  if (outfit !== currentOutfit) {
    currentOutfit = outfit;
    img.classList.remove("sprite-in");
    void img.offsetWidth;
    img.classList.add("sprite-in");
  }
}

function applyScene(scene) {
  if (!scene) return;
  setBackground(scene.bg);
  setSprite(scene.sprite, null);
}

function sceneFor(key) {
  return GAME_DATA.scenes[key] || null;
}

function preloadAssets() {
  const names = new Set();
  Object.values(GAME_DATA.scenes).forEach((s) => { if (s.bg) names.add(s.bg); });
  Object.values(GAME_DATA.endingScenes).forEach((s) => { if (s.bg) names.add(s.bg); });
  names.forEach((n) => { new Image().src = `${ASSET_DIR}${n}.webp`; });
  ["summer", "winter"].forEach((o) => { new Image().src = `${ASSET_DIR}hanae_${o}.webp`; });
}

/* ---------------- タイトル ---------------- */

function initTitleScreen() {
  showScreen("screen-title");
  applyScene(sceneFor("TITLE"));
  renderEndingGallery();
  window.scrollTo(0, 0);
  const saved = loadGame();
  const continueBtn = el("btn-continue");
  if (saved && !saved.finished) {
    continueBtn.style.display = "inline-block";
    continueBtn.onclick = () => {
      state = saved;
      el("player-name-input").value = state.name;
      advanceQueue();
    };
  } else {
    continueBtn.style.display = "none";
  }
  el("btn-start").onclick = () => {
    const nameInput = el("player-name-input").value.trim();
    state = freshState();
    state.name = nameInput || "あなた";
    saveGame();
    advanceQueue();
  };
}

/* ---------------- ハート演出 ---------------- */

function heartTier(points) {
  if (points >= 4) return { count: 3, cls: "heart-huge", expr: "joy" };
  if (points >= 2) return { count: 2, cls: "heart-big", expr: "smile" };
  if (points >= 1) return { count: 1, cls: "heart-small", expr: "smile" };
  if (points === 0) return { count: 0, cls: "", expr: "normal" };
  if (points <= -3) return { count: 1, cls: "heart-break", expr: "sad" };
  return { count: 1, cls: "heart-shrink", expr: "trouble" };
}

// 同じ減点でも、無神経な言動(pushy)は怒り、それ以外は落胆として出し分ける
function exprFor(points, tag) {
  const base = heartTier(points).expr;
  if (points < 0 && tag === "pushy") return "angry";
  return base;
}

function playHeartEffect(points) {
  const layer = el("heart-layer");
  layer.innerHTML = "";
  const tier = heartTier(points);
  if (tier.count === 0) return;
  for (let i = 0; i < tier.count; i++) {
    const h = document.createElement("div");
    h.className = "heart " + tier.cls;
    h.style.left = 40 + Math.random() * 20 + i * 8 + "%";
    h.style.animationDelay = (i * 0.12) + "s";
    h.textContent = tier.cls === "heart-break" ? "💔" : "💗";
    layer.appendChild(h);
  }
  setTimeout(() => { layer.innerHTML = ""; }, 1400);
}

/* ---------------- イベント表示 ---------------- */

function renderEventText(rawText) {
  let text = rawText;
  // 伏線は一度だけ差し込む。毎回付けると同じ一文が終盤まで延々繰り返され、
  // 伏線ではなく表示バグに見える
  if (!state.foreshadowShown && state.rival >= GAME_DATA.foreshadowThreshold) {
    state.foreshadowShown = true;
    text += GAME_DATA.foreshadowLine;
  }
  return text.replace(/\n/g, "<br>");
}

function showEvent(eventData, scene, onChoice) {
  showScreen("screen-event");
  applyScene(scene);
  el("event-title").textContent = eventData.title || "";
  el("event-text").innerHTML = renderEventText(eventData.text);
  el("event-reaction").innerHTML = "";
  el("event-reaction").style.display = "none";
  const choicesEl = el("event-choices");
  choicesEl.innerHTML = "";
  choicesEl.style.display = "flex";
  window.scrollTo(0, 0);

  // 直前の「つづける」を連打していると、同じ座標に現れた次の選択肢を
  // そのまま確定してしまう。選択は取り消せないので、描画直後は受け付けない
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
      choicesEl.style.display = "none";
      const points = choice.points || 0;
      state.score += points;
      state.rival = Math.max(0, state.rival + (choice.rival || 0));
      if (choice.tag === "pushy") state.pushyCount++;
      if (choice.tag === "passive") state.passiveCount++;
      // 選択を確定した時点で保存する(リアクション表示中に閉じても巻き戻らない)
      saveGame();
      playHeartEffect(points);
      if (scene && scene.sprite) setSprite(scene.sprite, exprFor(points, choice.tag));
      el("event-reaction").style.display = "block";
      el("event-reaction").innerHTML = choice.reaction ? choice.reaction.replace(/\n/g, "<br>") : "";
      const nextBtn = document.createElement("button");
      nextBtn.className = "next-btn";
      nextBtn.textContent = "つづける";
      nextBtn.onclick = () => { onChoice(choice); };
      el("event-reaction").appendChild(document.createElement("br"));
      el("event-reaction").appendChild(nextBtn);
    };
    choicesEl.appendChild(btn);
  });
}

/* ---------------- 自由行動フェーズ ---------------- */

function showFreeSelect() {
  showScreen("screen-free");
  applyScene(sceneFor("FREE"));
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
      state.freeChosen.push(key);
      state.freeRemaining = state.freeRemaining.filter((k) => k !== key);
      state.freePicksLeft--;
      showEvent(data, sceneFor(key), () => {
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
    showEvent(GAME_DATA.rivalInsert, sceneFor("RIVAL"), (choice) => {
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
  showEvent(eventData, sceneFor(key), (choice) => {
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
  const intro = state.senshu ? GAME_DATA.confessionIntroSenshu : GAME_DATA.confessionIntro;
  el("confession-text").innerHTML = intro.replace("{name}", state.name).replace(/\n/g, "<br>");
  el("btn-confess").onclick = () => { resolveEnding(); };
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
  const badge = el("ending-new");
  badge.style.display = isNew ? "block" : "none";
  badge.textContent = endingKey === "successPerfect"
    ? "NEW — 最も到達が難しいエンディングです"
    : "NEW — 初めて見るエンディングです";
  el("ending-title").textContent = ending.title;
  el("ending-text").innerHTML = ending.text.replace(/\n/g, "<br>");
  const seen = loadSeenEndings();
  el("ending-note").textContent =
    `エンディングは全${GAME_DATA.endingOrder.length}種類(到達済み ${seen.length})。選択を変えると結末が変わります。`;
  window.scrollTo(0, 0);
  el("btn-restart").onclick = () => {
    state = freshState();
    initTitleScreen();
  };
}

/* ---------------- 起動 ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  preloadAssets();
  // 進行はセーブ済みなので、タイトルに戻っても「つづきから」で復帰できる
  el("btn-title").onclick = () => {
    saveGame();
    initTitleScreen();
  };
  initTitleScreen();
});
