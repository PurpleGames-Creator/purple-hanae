/* ==========================================================================
   センチメンタル・ハナエ - ゲームエンジン
   ========================================================================== */

const SAVE_KEY = "sentimentalHanaeSave";

function freshState() {
  return {
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
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/* ---------------- 画面制御 ---------------- */

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el(id).classList.add("active");
}

function initTitleScreen() {
  showScreen("screen-title");
  const saved = loadGame();
  const continueBtn = el("btn-continue");
  if (saved && !saved.finished) {
    continueBtn.style.display = "inline-block";
    continueBtn.onclick = () => {
      state = saved;
      el("player-name-input").value = state.name;
      advanceQueue(true);
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
  if (points >= 4) return { count: 3, cls: "heart-huge" };
  if (points >= 2) return { count: 2, cls: "heart-big" };
  if (points >= 1) return { count: 1, cls: "heart-small" };
  if (points === 0) return { count: 0, cls: "" };
  if (points <= -3) return { count: 1, cls: "heart-break" };
  return { count: 1, cls: "heart-shrink" };
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

function showEvent(eventData, onChoice) {
  showScreen("screen-event");
  el("event-title").textContent = eventData.title || "";
  el("event-text").innerHTML = renderEventText(eventData.text);
  el("event-reaction").innerHTML = "";
  el("event-reaction").style.display = "none";
  const choicesEl = el("event-choices");
  choicesEl.innerHTML = "";
  choicesEl.style.display = "flex";

  eventData.choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = choice.label;
    btn.onclick = () => {
      choicesEl.style.display = "none";
      state.score += choice.points || 0;
      state.rival = Math.max(0, state.rival + (choice.rival || 0));
      if (choice.tag === "pushy") state.pushyCount++;
      if (choice.tag === "passive") state.passiveCount++;
      playHeartEffect(choice.points || 0);
      el("event-reaction").style.display = "block";
      el("event-reaction").innerHTML = choice.reaction ? choice.reaction.replace(/\n/g, "<br>") : "";
      const nextBtn = document.createElement("button");
      nextBtn.className = "next-btn";
      nextBtn.textContent = "つづける";
      nextBtn.onclick = () => {
        onChoice(choice);
      };
      el("event-reaction").appendChild(document.createElement("br"));
      el("event-reaction").appendChild(nextBtn);
    };
    choicesEl.appendChild(btn);
  });
}

/* ---------------- 自由行動フェーズ ---------------- */

function showFreeSelect() {
  showScreen("screen-free");
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
      showEvent(data, () => {
        if (state.freePicksLeft > 0) {
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

function advanceQueue(isResume) {
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
    showEvent(GAME_DATA.rivalInsert, () => {
      advanceEventThenNext(key);
    });
    return;
  }

  advanceEventThenNext(key);
}

function advanceEventThenNext(key) {
  const eventData = GAME_DATA.events[key];
  showEvent(eventData, (choice) => {
    if (GAME_DATA.perfectRoute[key] && choice.id === GAME_DATA.perfectRoute[key]) {
      state.perfect[key] = true;
    } else if (GAME_DATA.perfectRoute[key]) {
      state.perfect[key] = false;
    }
    state.queueIndex++;
    advanceQueue();
  });
}

/* ---------------- 告白・エンディング ---------------- */

function startConfession() {
  showScreen("screen-confession");
  const text = GAME_DATA.confessionIntro.replace("{name}", state.name);
  el("confession-text").innerHTML = text.replace(/\n/g, "<br>");
  el("btn-confess").onclick = () => {
    resolveEnding();
  };
}

function resolveEnding() {
  let endingKey;
  if (state.rival >= GAME_DATA.RIVAL_FAIL_THRESHOLD) {
    endingKey = "nishino";
  } else if (state.score >= GAME_DATA.SUCCESS_THRESHOLD) {
    const allPerfect = Object.keys(GAME_DATA.perfectRoute).every((k) => state.perfect[k]);
    endingKey = allPerfect ? "successPerfect" : "success";
  } else if (state.score >= 40) {
    endingKey = "friend";
  } else {
    endingKey = state.pushyCount > state.passiveCount ? "awkward" : "soretigai";
  }

  state.finished = true;
  saveGame();

  const ending = GAME_DATA.endings[endingKey];
  showScreen("screen-ending");
  el("ending-title").textContent = ending.title;
  el("ending-text").innerHTML = ending.text.replace(/\n/g, "<br>");
  el("btn-restart").onclick = () => {
    state = freshState();
    initTitleScreen();
  };
}

/* ---------------- 起動 ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  initTitleScreen();
});
