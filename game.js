/* ==========================================================================
   センチメンタル・ハナエ - ゲームエンジン
   ========================================================================== */

const SAVE_KEY = "sentimentalHanaeSave";
const ASSET_DIR = "assets/";

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

/* ---------------- 画面制御 ---------------- */

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el(id).classList.add("active");
}

/* ---------------- 背景・立ち絵 ---------------- */

let currentBg = null;
let currentOutfit = null;

function setBackground(bgName) {
  const layer = el("bg-layer");
  if (!bgName) {
    layer.style.backgroundImage = "none";
    currentBg = null;
    return;
  }
  if (bgName === currentBg) return;
  currentBg = bgName;
  layer.style.backgroundImage = `url("${ASSET_DIR}${bgName}.webp")`;
  layer.classList.remove("bg-fade");
  void layer.offsetWidth; // アニメーションを再生し直す
  layer.classList.add("bg-fade");
}

// 表情差分ファイルがあれば使い、無ければ基本立ち絵にフォールバックする。
// 追加する場合のファイル名: assets/hanae_summer_<expr>.webp (expr = joy/smile/normal/trouble/sad)
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
  if (state.rival >= GAME_DATA.foreshadowThreshold) {
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

  eventData.choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = choice.label;
    btn.onclick = () => {
      choicesEl.style.display = "none";
      const points = choice.points || 0;
      state.score += points;
      state.rival = Math.max(0, state.rival + (choice.rival || 0));
      if (choice.tag === "pushy") state.pushyCount++;
      if (choice.tag === "passive") state.passiveCount++;
      // 選択を確定した時点で保存する(リアクション表示中に閉じても巻き戻らない)
      saveGame();
      playHeartEffect(points);
      if (scene && scene.sprite) setSprite(scene.sprite, heartTier(points).expr);
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
  state.freeRemaining.forEach((key) => {
    const data = GAME_DATA.freePool[key];
    const card = document.createElement("button");
    card.className = "free-card";
    card.textContent = data.title;
    card.onclick = () => {
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

  const ending = GAME_DATA.endings[endingKey];
  showScreen("screen-ending");
  applyScene(GAME_DATA.endingScenes[endingKey]);
  el("ending-title").textContent = ending.title;
  el("ending-text").innerHTML = ending.text.replace(/\n/g, "<br>");
  window.scrollTo(0, 0);
  el("btn-restart").onclick = () => {
    state = freshState();
    initTitleScreen();
  };
}

/* ---------------- 起動 ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  preloadAssets();
  initTitleScreen();
});
