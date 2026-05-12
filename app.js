import {
  evaluateRoundRights,
  generateInitialCharacter,
  generateCourtEvent,
  generateSceneEvent,
  resolveRelationshipAction,
} from "./llm.js";
import { buildHistorySummary } from "./prompts.js";
import {
  applyEffects,
  applyLocalDelta,
  calculateEffectiveDelta,
  applyRoundEvaluation,
  canOpenCounseling,
  checkWinOrLose,
  consumeRoundDecisionLog,
  createMarriage,
  createInitialStateFromPlayers,
  decayIntimacyForRound,
  dissolveMarriage,
  logRoundDecision,
  markPlayersLinkedByPvp,
  updateIntimacyPair,
} from "./state.js";

let state = createInitialStateFromPlayers(null);

const el = {
  screenLayer: document.getElementById("screenLayer"),
  gameViews: Array.from(document.querySelectorAll(".game-view")),
  leftPanel: document.getElementById("leftPanel"),
  feedList: document.getElementById("feedList"),
  roundNum: document.getElementById("roundNum"),
  currentPlayerName: document.getElementById("currentPlayerName"),
  turnStage: document.getElementById("turnStage"),
  globalGap: document.getElementById("globalGap"),
  balanceLeft: document.getElementById("balanceLeft"),
  balanceRight: document.getElementById("balanceRight"),
  eventModal: document.getElementById("eventModal"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  closeModal: document.getElementById("closeModal"),
  optionTemplate: document.getElementById("optionTemplate"),
  mobileFab: document.getElementById("mobileFab"),
  courtBtn: document.getElementById("courtBtn"),
  boardButtons: Array.from(document.querySelectorAll(".board-card")),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
};

const apiEnabled = true;
let loadingDepth = 0;
let loadingOpSeq = 0;
let mandatoryCourtSession = null;
let courtSessionLoading = false;
let runtimeStatus = {
  mode: "mock",
  message: "尚未检测运行环境。",
};

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_GAME_HEIGHT = 1080;
const LOCAL_PLAYER_ID = "p1";
const STARTING_ACTION_POINTS = 30;
const PLAYER_ROLES = [
  { id: "p1", label: "您", controller: "local" },
  { id: "p2", label: "人类", controller: "sim-human" },
  { id: "p3", label: "AI", controller: "ai" },
  { id: "p4", label: "AI", controller: "ai" },
];

let matchSession = createEmptyMatchSession();
let syncSession = createSyncSession();

function createEmptyMatchSession() {
  return {
    batchId: 0,
    targetGenders: [],
    players: [null, null, null, null],
    statuses: ["idle", "idle", "idle", "idle"],
    errors: [null, null, null, null],
  };
}

function createSyncSession() {
  return {
    screen: "start",
    roundPhase: "idle",
    localPlayerId: LOCAL_PLAYER_ID,
    playerControllers: Object.fromEntries(PLAYER_ROLES.map((role) => [role.id, role.controller])),
    turnSubmissions: {},
    pendingGlobalEffects: [],
    pendingPvpActions: [],
    journalEntries: [],
    overlay: null,
    selectedEventOptionId: null,
    actionSpentThisRound: 0,
    emergencyCourtUsed: false,
  };
}

function isCourtRoundPending() {
  return state.round % 5 === 0 && !state.courtDoneRounds.includes(state.round);
}

function isMandatoryCourtActive() {
  return Boolean(mandatoryCourtSession && mandatoryCourtSession.round === state.round && isCourtRoundPending());
}

function withOneDecimal(v) {
  return Math.round(Number(v || 0) * 10) / 10;
}

function clampNum(v, min, max) {
  return Math.max(min, Math.min(max, Number(v || 0)));
}

function displayNum(value) {
  return String(Math.round(Number(value || 0)));
}

function displayLevel(level) {
  if (level === "high") return "高";
  if (level === "low") return "低";
  return "中";
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function genderLabel(gender) {
  return gender === "female" ? "女" : "男";
}

function setGameVisible(visible) {
  el.gameViews.forEach((node) => {
    node.classList.toggle("hidden", !visible);
  });
  el.screenLayer.classList.toggle("hidden", visible);
}

function setRect(node, x, y, w, h, z = 0) {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.width = `${w}px`;
  node.style.height = `${h}px`;
  node.style.zIndex = String(z);
}

function updateScreenScale() {
  const frame = el.screenLayer.querySelector(".screen-frame");
  if (!frame) return;
  const designHeight = Number(frame.dataset.designHeight || DESIGN_HEIGHT);
  const scaleGetter = frame.dataset.scaleMode === "cover" ? Math.max : Math.min;
  const scale = scaleGetter(window.innerWidth / DESIGN_WIDTH, window.innerHeight / designHeight);
  frame.style.transform = `scale(${scale})`;
}

function createScreenFrame(designHeight = DESIGN_HEIGHT, scaleMode = "contain") {
  el.screenLayer.innerHTML = "";
  const frame = document.createElement("div");
  frame.className = "screen-frame";
  frame.dataset.designHeight = String(designHeight);
  frame.dataset.scaleMode = scaleMode;
  frame.style.height = `${designHeight}px`;
  el.screenLayer.appendChild(frame);
  updateScreenScale();
  return frame;
}

function addAsset(frame, src, x, y, w, h, z, className = "") {
  const img = document.createElement("img");
  img.className = `screen-asset ${className}`.trim();
  img.src = src;
  img.alt = "";
  setRect(img, x, y, w, h, z);
  frame.appendChild(img);
  return img;
}

function addImageButton(frame, src, x, y, w, h, z, onClick, disabled = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "screen-button";
  btn.disabled = disabled;
  btn.onclick = onClick;
  setRect(btn, x, y, w, h, z);

  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  btn.appendChild(img);
  frame.appendChild(btn);
  return btn;
}

function addScreenText(frame, text, x, y, w, h, z, className = "") {
  const box = document.createElement("div");
  box.className = `screen-text ${className}`.trim();
  box.textContent = text;
  setRect(box, x, y, w, h, z);
  frame.appendChild(box);
  return box;
}

function addHotspot(frame, x, y, w, h, z, onClick, disabled = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "screen-hotspot";
  btn.disabled = disabled;
  btn.onclick = onClick;
  setRect(btn, x, y, w, h, z);
  frame.appendChild(btn);
  return btn;
}

function renderStartScreen() {
  syncSession.screen = "start";
  setGameVisible(false);
  const frame = createScreenFrame();
  addAsset(frame, "./image_UI/背景1.png", 0, 0, 1920, 1080, 0);
  addAsset(frame, "./image_UI/标题1.png", 589, 25, 734, 833, 1);
  addImageButton(frame, "./image_UI/按键1.png", 615, 890, 692, 122, 2, startParallelCharacterGeneration);
}

function renderStartLoadingScreen() {
  syncSession.screen = "generating";
  setGameVisible(false);
  const frame = createScreenFrame();
  addAsset(frame, "./image_UI/背景1.png", 0, 0, 1920, 1080, 0);
  const mask = document.createElement("div");
  mask.className = "loading-mask";
  mask.innerHTML = `
    <div class="loading-mask-card">
      <div class="loading-spinner"></div>
      <div>AI正在生成人物...</div>
    </div>
  `;
  frame.appendChild(mask);
}

function statusLabel(status) {
  if (status === "ready") return "已就绪";
  if (status === "generating") return "生成中";
  if (status === "error") return "已就绪";
  return "等待中";
}

function playerStatusLine(index) {
  const role = PLAYER_ROLES[index];
  const divider = index === 0 ? "  -" : "-";
  return `${role.label}${divider}${index + 1}号玩家 【${statusLabel(matchSession.statuses[index])}】`;
}

function formatMatchBio(player) {
  if (!player) return "人物小传：\n\n生成中...";
  return `人物小传：\n\n${player.bio || "背景生成中..."}`;
}

function formatMatchStats(player) {
  if (!player) {
    return "身心健康值：--\n社会声誉值：--\n财富值：-- 万\n权利：--\n风险：--\n存活进度：--";
  }
  return `身心健康值：${displayNum(player.stats?.health)}\n社会声誉值：${displayNum(player.stats?.reputation)}\n财富值：${displayNum(player.stats?.wealth)} 万\n权利：${displayLevel(player.stats?.rightsLevel)}\n风险：${displayLevel(player.stats?.riskLevel)}\n存活进度：${displayNum(player.survivalProgress)}`;
}

function renderMatchScreen() {
  syncSession.screen = "match";
  setGameVisible(false);
  const frame = createScreenFrame();
  const player = matchSession.players[0];
  const allReady = matchSession.statuses.every((status) => status === "ready" || status === "error");

  addAsset(frame, "./image_UI/背景2.png", 0, 0, 1920, 1080, 0);
  addAsset(frame, "./image_UI/信息卡片背景2.png", 611.4, 228, 743.54, 694.85, 1);
  addAsset(frame, "./image_UI/玩家准备状态框2.png", 98, 418, 1726, 245, 2);
  addAsset(frame, "./image_UI/生存目标背景框2.png", 770, 719, 430, 63, 3);
  addImageButton(frame, "./image_UI/返回2.png", 61, 29, 130, 82, 4, cancelMatchAndReturn);
  addImageButton(frame, "./image_UI/开启按键2.png", 655, 912, 610, 122, 5, startGameFromMatch, !allReady);

  const avatarSrc = player?.gender === "female" ? "./image_UI/女头像.png" : "./image_UI/男头像.png";
  addAsset(frame, avatarSrc, 777, 290, 110, 110, 6);

  addScreenText(
    frame,
    player ? `姓名：${player.name}\n${genderLabel(player.gender)}/${player.age}岁\n职业：${player.job}` : "姓名：生成中\n--/--岁\n职业：生成中",
    915,
    300,
    147,
    93,
    7,
    "match-info"
  );
  addScreenText(frame, playerStatusLine(0), 200, 462, 270, 31, 7, "match-status");
  addScreenText(frame, playerStatusLine(1), 200, 591, 270, 31, 7, "match-status");
  addScreenText(frame, playerStatusLine(2), 1438, 461, 270, 31, 7, "right match-status");
  addScreenText(frame, playerStatusLine(3), 1438, 591, 270, 31, 7, "right match-status");
  addScreenText(frame, formatMatchBio(player), 775, 424, 426, 130, 7, "bio match-info auto-height");
  addScreenText(frame, formatMatchStats(player), 775, 586, 426, 125, 7, "stats small");
  addScreenText(
    frame,
    `当前生存目标：${player?.survivalTask || "生成中..."}`,
    790,
    739,
    390,
    24,
    7,
    "match-survival center auto-height"
  );
}

async function startParallelCharacterGeneration() {
  const batchId = matchSession.batchId + 1;
  matchSession = {
    batchId,
    targetGenders: shuffle(["male", "male", "female", "female"]),
    players: [null, null, null, null],
    statuses: ["generating", "generating", "generating", "generating"],
    errors: [null, null, null, null],
  };
  renderStartLoadingScreen();

  matchSession.targetGenders.forEach((targetGender, idx) => {
    void generateInitialCharacter(
      {
        slot: idx + 1,
        targetGender,
      },
      runtimeStatus.mode === "online"
    )
      .then((result) => {
        if (matchSession.batchId !== batchId) return;
        matchSession.players[idx] = result.player;
        matchSession.statuses[idx] = "ready";
      })
      .catch((error) => {
        if (matchSession.batchId !== batchId) return;
        console.warn(`[match] player ${idx + 1} generation fallback`, error);
        matchSession.players[idx] = null;
        matchSession.statuses[idx] = "error";
        matchSession.errors[idx] = error;
      })
      .finally(() => {
        if (matchSession.batchId !== batchId) return;
        if (idx === 0 || syncSession.screen === "match") {
          renderMatchScreen();
        }
      });
  });
}

function cancelMatchAndReturn() {
  matchSession = {
    ...createEmptyMatchSession(),
    batchId: matchSession.batchId + 1,
  };
  renderStartScreen();
}

function initializeSyncSession() {
  syncSession = createSyncSession();
  syncSession.screen = "game";
  syncSession.roundPhase = "acting";
  state.currentPlayerIndex = 0;
  state.stage = "primary";
  state.maxRound = 15;
  state.players.forEach((player) => {
    player.actionPoints = STARTING_ACTION_POINTS;
  });
}

function startGameFromMatch() {
  const allReady = matchSession.statuses.every((status) => status === "ready" || status === "error");
  if (!allReady) return;

  state = createInitialStateFromPlayers(matchSession.players);
  initializeSyncSession();
  syncSession.overlay = { type: "tutorial" };
  renderGameScreen();

  addFeed({
    player: state.players[0],
    tag: runtimeStatus.mode === "online" ? "✅" : "🚀",
    summary: `《看见》已启动。${runtimeStatus.message} 1号玩家由您操作，2-4号暂由随机决策模拟。`,
  });
  renderGameScreen();
}

function getLocalPlayer() {
  return state.players.find((p) => p.id === syncSession.localPlayerId) || state.players[0];
}

function ensureActionPoints(player) {
  if (!player) return 0;
  if (!Number.isFinite(Number(player.actionPoints))) {
    player.actionPoints = STARTING_ACTION_POINTS;
  }
  return player.actionPoints;
}

function spendActionPoint(player, count = 1) {
  if (!player) return;
  ensureActionPoints(player);
  player.actionPoints = Math.max(0, player.actionPoints - count);
}

function marriageStatus(player) {
  if (!player?.marriedTo) return "未婚";
  return `已婚：${state.players.find((p) => p.id === player.marriedTo)?.name || "未知"}`;
}

function sceneIsAvailable(scene, subScene = null) {
  const player = getLocalPlayer();
  if (!player?.alive || ensureActionPoints(player) <= 0) return false;
  if (syncSession.roundPhase !== "acting" || syncSession.overlay) return false;
  if (state.stage === "primary") return ["workplace", "family"].includes(scene);
  if (state.stage === "culture") {
    if (scene !== "culture") return false;
    if (subScene === "counseling") return canOpenCounseling(player);
    return ["library", "square"].includes(subScene);
  }
  return false;
}

function canOpenCourtFromGame() {
  const player = getLocalPlayer();
  return isCourtRoundPending() || (player?.survivalProgress < 10 && !syncSession.emergencyCourtUsed);
}

function addProgressBar(frame, x, y, w, h, z, value, min = 0, max = 100) {
  const bar = document.createElement("div");
  bar.className = "game-progress";
  setRect(bar, x, y, w, h, z);
  const fill = document.createElement("div");
  fill.className = "game-progress-fill";
  const ratio = Math.max(0, Math.min(1, (Number(value || 0) - min) / (max - min || 1)));
  fill.style.width = `${Math.round(ratio * 100)}%`;
  bar.appendChild(fill);
  frame.appendChild(bar);
  return bar;
}

function addSignedProgressBar(frame, x, y, w, h, z, value) {
  const bar = document.createElement("div");
  bar.className = "game-progress signed";
  setRect(bar, x, y, w, h, z);
  const number = Math.max(-100, Math.min(100, Number(value || 0)));
  const fill = document.createElement("div");
  fill.className = number >= 0 ? "game-progress-fill positive" : "game-progress-fill negative";
  fill.style.width = `${Math.round(Math.abs(number))}%`;
  bar.appendChild(fill);
  frame.appendChild(bar);
  return bar;
}

function addRightsProgressBars(frame) {
  const x = 62;
  const y = 36;
  const w = 1423;
  const h = 56;
  const gap = 28;
  const halfW = (w - gap) / 2;
  const femaleRatio = Math.max(0, Math.min(1, Number(state.femaleRights || 0) / 100));
  const maleRatio = Math.max(0, Math.min(1, Number(state.maleRights || 0) / 100));

  const leftTrack = document.createElement("div");
  leftTrack.className = "rights-progress left";
  setRect(leftTrack, x, y, halfW, h, 2);
  const femaleFill = document.createElement("div");
  femaleFill.className = "rights-progress-fill female";
  femaleFill.style.width = `${Math.round(femaleRatio * 100)}%`;
  leftTrack.appendChild(femaleFill);
  frame.appendChild(leftTrack);

  const gapNode = document.createElement("div");
  gapNode.className = "rights-progress-gap";
  setRect(gapNode, x + halfW, y, gap, h, 2);
  frame.appendChild(gapNode);

  const rightTrack = document.createElement("div");
  rightTrack.className = "rights-progress right";
  setRect(rightTrack, x + halfW + gap, y, halfW, h, 2);
  const maleFill = document.createElement("div");
  maleFill.className = "rights-progress-fill male";
  maleFill.style.width = `${Math.round(maleRatio * 100)}%`;
  rightTrack.appendChild(maleFill);
  frame.appendChild(rightTrack);
}

function addJournalEntries(frame) {
  let top = 106;
  const entries = syncSession.journalEntries.slice(-9);
  entries.forEach((entry) => {
    const box = document.createElement("div");
    box.className = "game-journal-entry";
    box.textContent = `${entry.playerLabel}-${entry.playerName}\n${entry.title}\n${entry.summary}`;
    setRect(box, 1610, top, 250, 92, 4);
    frame.appendChild(box);
    top += 112;
  });
}

function renderGameScreen() {
  syncSession.screen = "game";
  setGameVisible(false);
  const frame = createScreenFrame(DESIGN_GAME_HEIGHT);
  const player = getLocalPlayer();
  ensureActionPoints(player);

  addAsset(frame, "./image_UI/背景4.png", 0, 0, 1920, 1080, 0);
  addAsset(frame, player.gender === "female" ? "./image_UI/女头像.png" : "./image_UI/男头像.png", 90, 163, 110, 110, 3);
  addAsset(frame, "./image_UI/行动点背景4.png", 1193, 118, 292, 46, 1);
  addAsset(frame, "./image_UI/经历手账背景图4.png", 1578, -30, 342, 1188, 1);
  addAsset(frame, "./image_UI/人物信息背景4.png", 63, 127, 422, 594, 1);
  addAsset(frame, "./image_UI/当前生存目标背景框4.png", 86, 638, 362, 68, 2);
  addImageButton(frame, "./image_UI/法庭4.png", 928, 475, 243, 243, 2, () => openCourtAlert("emergency"), !canOpenCourtFromGame());
  addAsset(frame, "./image_UI/背包背景框4.png", 63, 733, 422, 158, 2);

  const bagSlots = Math.min(3, Math.max(0, player.items?.length || 0));
  [87, 232, 377].slice(0, bagSlots).forEach((x, idx) => {
    addImageButton(frame, "./image_UI/背包框4.png", x, 776, 82, 82, 3, () =>
      showNoticeOverlay(`道具页面将在后续流程中接入。\n当前道具：${player.items[idx]?.name || "未知道具"}`)
    );
  });

  addAsset(frame, "./image_UI/文化广场底图4.png", 618, 702, 300, 300, 1);
  addImageButton(frame, "./image_UI/职场按键4.png", 603, 175, 330, 330, 3, () => openSceneFromGame("workplace"), !sceneIsAvailable("workplace"));
  addImageButton(frame, "./image_UI/家庭按键4.png", 1180, 190, 300, 300, 3, () => openSceneFromGame("family"), !sceneIsAvailable("family"));
  addImageButton(frame, "./image_UI/机遇场按键4.png", 1180, 702, 300, 300, 3, () => showNoticeOverlay("人生机遇场将在第10轮后开放，具体页面后续接入。"), true);
  addImageButton(frame, "./image_UI/图书馆按键4.png", 784, 811, 115, 58, 3, () => openSceneFromGame("culture", "library"), !sceneIsAvailable("culture", "library"));
  addImageButton(frame, "./image_UI/咨询室按键4.png", 640, 721, 115, 58, 3, () => openSceneFromGame("culture", "counseling"), !sceneIsAvailable("culture", "counseling"));
  addImageButton(frame, "./image_UI/广场按键4.png", 712, 911, 109, 58, 3, () => openSceneFromGame("culture", "square"), !sceneIsAvailable("culture", "square"));
  addImageButton(frame, "./image_UI/进入下一轮4.png", 1318, 1028, 162.5, 32, 4, submitNextRoundFromGame, state.stage !== "ready" || syncSession.roundPhase !== "acting");

  addRightsProgressBars(frame);
  addScreenText(frame, "女性社会权益值", 95, 51, 178, 40, 4, "center large");
  addScreenText(frame, displayNum(state.femaleRights), 577, 51, 178, 40, 4, "center large");
  addScreenText(frame, displayNum(state.maleRights), 813, 51, 178, 40, 4, "center large");
  addScreenText(frame, "男性社会权益值", 1309, 51, 178, 40, 4, "center large");
  addScreenText(frame, `当前行动点余额：${displayNum(player.actionPoints)}`, 1229.5, 123, 218, 33, 4, "small center");

  addScreenText(frame, player.name, 220, 160, 140, 29, 4, "large");
  addScreenText(frame, `${player.age}岁\n${player.job}\n${marriageStatus(player)}`, 220, 202, 180, 60, 4, "small");
  addScreenText(frame, `角色小传：\n\n${player.bio || "暂无小传"}`, 90, 289, 364, 135, 4, "small auto-height");

  addProgressBar(frame, 86, 479, 368, 16, 3, player.stats.health, 0, 100);
  addSignedProgressBar(frame, 86, 527, 368, 16, 3, player.stats.reputation);
  addScreenText(frame, "身心健康值", 87, 449, 90, 17, 4, "mini");
  addScreenText(frame, `${displayNum(player.stats.health)}/100`, 405, 449, 60, 17, 4, "mini right");
  addScreenText(frame, "社会声誉值", 87, 504, 90, 17, 4, "mini");
  addScreenText(frame, `${displayNum(player.stats.reputation)}/100`, 395, 501, 70, 17, 4, "mini right");
  addScreenText(frame, "财富值", 87, 556, 60, 17, 4, "mini");
  addScreenText(frame, `￥${displayNum(player.stats.wealth)}万`, 384, 556, 70, 17, 4, "mini right");
  addScreenText(frame, "权利指数", 87, 579, 70, 17, 4, "mini");
  addScreenText(frame, displayLevel(player.stats.rightsLevel), 426, 579, 28, 17, 4, "mini right");
  addScreenText(frame, "风险等级", 87, 605, 70, 17, 4, "mini");
  addScreenText(frame, displayLevel(player.stats.riskLevel), 426, 605, 28, 17, 4, "mini right");
  addScreenText(frame, `当前生存目标\n${player.survivalTask || "暂无目标"}`, 99, 650, 250, 48, 4, "small auto-height");
  addScreenText(frame, "背包", 87, 739, 60, 28, 4, "small");

  addScreenText(frame, "注意：每轮必须在广场或图书馆中消耗一次行动点", 621.5, 1010, 360, 24, 4, "mini");
  addScreenText(frame, "注意：第10轮开启", 1267, 1010, 180, 24, 4, "mini");
  addScreenText(frame, "生存状态告急、每8轮强制开启一次", 883, 723, 320, 24, 4, "mini center");
  addJournalEntries(frame);

  renderGameOverlay(frame);
}

function renderGameOverlay(frame) {
  const overlay = syncSession.overlay;
  if (!overlay) return;

  if (overlay.type === "tutorial") {
    addAsset(frame, "./image_UI/背景遮罩3.png", 0, 0, 1920, 1158, 20);
    addAsset(frame, "./image_UI/背景3.png", 612, 91.31, 743.29, 932.67, 21);
    addImageButton(frame, "./image_UI/按键3.png", 786, 827, 342, 97, 22, () => {
      syncSession.overlay = null;
      renderGameScreen();
    });
    return;
  }

  if (overlay.type === "notice") {
    renderNoticeOverlay(frame, overlay.message);
    return;
  }

  if (overlay.type === "event") {
    renderEventChoiceOverlay(frame, overlay);
    return;
  }

  if (overlay.type === "courtAlert") {
    renderCourtAlertOverlay(frame, overlay);
    return;
  }

  if (overlay.type === "courtVote") {
    renderCourtVoteOverlay(frame);
    return;
  }

  if (overlay.type === "courtResult") {
    renderCourtResultOverlay(frame, overlay);
  }
}

function showNoticeOverlay(message) {
  syncSession.overlay = { type: "notice", message };
  renderGameScreen();
}

function renderNoticeOverlay(frame, message) {
  addAsset(frame, "./image_UI/背景模糊遮罩4-1.png", 5, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/背景框4-1.png", 410, 247, 1099, 638, 21);
  addScreenText(frame, message, 560, 470, 800, 180, 22, "center large auto-height");
  addImageButton(frame, "./image_UI/确定4-1.png", 893, 782, 161, 57, 23, () => {
    syncSession.overlay = null;
    renderGameScreen();
  });
}

function renderEventChoiceOverlay(frame, overlay) {
  const eventData = overlay.eventData;
  addAsset(frame, "./image_UI/背景模糊遮罩4-1.png", 5, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/背景框4-1.png", 410, 247, 1099, 638, 21);
  addImageButton(frame, "./image_UI/取消4-1.png", 1433, 281, 30, 30, 23, cancelEventSelection);
  addImageButton(frame, "./image_UI/确定4-1.png", 893, 782, 161, 57, 23, confirmEventSelection, !syncSession.selectedEventOptionId);

  addScreenText(frame, eventData.title || "事件", 485, 310, 978, 34, 22, "large center");
  addScreenText(frame, eventData.narrative || "", 485, 350, 978, 96, 22, "small auto-height");

  const list = document.createElement("div");
  list.className = "screen-text";
  setRect(list, 485, 470, 978, 285, 22);
  list.style.pointerEvents = "auto";
  list.style.overflow = "auto";
  list.style.fontSize = "16px";
  list.style.whiteSpace = "normal";

  eventData.options.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `event-option ${syncSession.selectedEventOptionId === option.id ? "selected" : ""}`;
    btn.innerHTML = `
      <div class="event-option-title">${esc(option.label || "选项")}</div>
      <div class="event-option-desc">${esc(option.description || "")}</div>
      <div class="event-option-desc">${esc(effectPreview(option.effects, getLocalPlayer()))}</div>
    `;
    btn.onclick = () => {
      syncSession.selectedEventOptionId = option.id;
      renderGameScreen();
    };
    list.appendChild(btn);
  });

  frame.appendChild(list);
}

async function openSceneFromGame(scene, subScene = null) {
  if (!sceneIsAvailable(scene, subScene)) return;
  const player = getLocalPlayer();
  try {
    const historySummary = buildHistorySummary(state.events, player.id, state);
    const raw = await runWithLoading("AI正在生成事件与选项...", () =>
      generateSceneEvent(
        {
          scene,
          subScene,
          player,
          gameState: state,
          historySummary,
        },
        apiEnabled
      )
    );
    const eventData = normalizeEvent(raw, scene, subScene, player);
    syncSession.selectedEventOptionId = null;
    syncSession.overlay = {
      type: "event",
      scene,
      subScene,
      eventData,
    };
    renderGameScreen();
  } catch (error) {
    console.error("[openSceneFromGame] failed", error);
    showNoticeOverlay(`事件生成失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
}

function writeEventRecord(player, eventData, option) {
  const summary = option.summary || `${eventData.title} -> ${option.label}`;
  const thread = {
    ...eventData.thread,
    ...(option.thread || {}),
    threadId: eventData.thread?.threadId || `thr_${Date.now()}`,
  };

  state.events.unshift({
    round: state.round,
    playerId: player.id,
    relatedPlayerIds: [player.id],
    playerName: player.name,
    tag: option.effects?.meta?.tag || "📌",
    summary,
    title: eventData.title,
    choiceLabel: option.label,
    narrative: eventData.narrative,
    thread,
  });

  logChoice(player, option.effects?.meta?.tag || "scene", option.label, summary);
  return summary;
}

function confirmEventSelection() {
  const overlay = syncSession.overlay;
  if (!overlay || overlay.type !== "event") return;
  const player = getLocalPlayer();
  const option = overlay.eventData.options.find((item) => item.id === syncSession.selectedEventOptionId);
  if (!option) return;

  if (overlay.scene === "culture" && overlay.subScene === "counseling") {
    player.counselingUsed += 1;
  }

  applyImmediateChoiceEffects(player, option.effects);
  const summary = writeEventRecord(player, overlay.eventData, option);
  queueGlobalEffects(player, option.effects, summary);
  syncSession.overlay = null;
  syncSession.selectedEventOptionId = null;
  consumeLocalAction();
}

function cancelEventSelection() {
  const overlay = syncSession.overlay;
  const player = getLocalPlayer();
  if (overlay?.type === "event") {
    const sceneName = overlay.scene === "culture" ? `culture/${overlay.subScene || "square"}` : overlay.scene;
    const summary = `${player.name}取消了本次事件选择，保留状态等待本轮后续。`;
    addFeed({ player, tag: "取消", summary });
    logChoice(player, sceneName, "取消", summary);
  }
  syncSession.overlay = null;
  syncSession.selectedEventOptionId = null;
  consumeLocalAction();
}

function consumeLocalAction() {
  const player = getLocalPlayer();
  spendActionPoint(player, 1);
  syncSession.actionSpentThisRound += 1;

  if (ensureActionPoints(player) <= 0) {
    state.stage = "ready";
  } else if (state.stage === "primary") {
    state.stage = "culture";
  } else {
    state.stage = "ready";
  }

  renderGameScreen();
}

function submitNextRoundFromGame() {
  if (state.stage !== "ready" || syncSession.roundPhase !== "acting") {
    showNoticeOverlay("请先完成本轮两个行动点的选择。");
    return;
  }
  void submitLocalTurnAndResolveRound();
}

function openCourtAlert(kind = "forced") {
  if (!canOpenCourtFromGame()) return;
  syncSession.overlay = { type: "courtAlert", kind: isCourtRoundPending() ? "forced" : kind };
  renderGameScreen();
}

function renderCourtAlertOverlay(frame, overlay) {
  addAsset(frame, "./image_UI/背景模糊遮罩4-2.png", -8, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/法庭4-2.png", 749, 323, 422, 422, 21);
  addAsset(frame, "./image_UI/感叹号4-2.png", 1204, 123, 294, 333.63, 22);
  addScreenText(
    frame,
    overlay.kind === "forced" ? "强制开庭已开启\n所有玩家需参与投票" : "生存状态告急\n可主动开启一次法庭",
    735,
    740,
    450,
    70,
    23,
    "center large auto-height"
  );
  addImageButton(frame, "./image_UI/确定4-2.png", 778, 834, 365, 57, 23, confirmCourtAlert);
}

async function confirmCourtAlert() {
  const player = getLocalPlayer();
  const kind = syncSession.overlay?.kind || "forced";
  try {
    const historySummary = buildHistorySummary(state.events, player.id, state);
    const raw = await runWithLoading("AI正在生成法庭议题...", () =>
      generateCourtEvent(
        {
          player,
          gameState: state,
          historySummary,
        },
        apiEnabled
      )
    );
    const eventData = normalizeEvent(raw, "court", null, player);
    mandatoryCourtSession = {
      round: state.round,
      kind,
      eventData: {
        ...eventData,
        options: eventData.options.slice(0, 2),
      },
      votes: [],
    };
    syncSession.overlay = { type: "courtVote" };
    renderGameScreen();
  } catch (error) {
    console.error("[confirmCourtAlert] failed", error);
    showNoticeOverlay(`法庭议题生成失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
}

function renderCourtVoteOverlay(frame) {
  const session = mandatoryCourtSession;
  if (!session) return;
  addAsset(frame, "./image_UI/背景模糊遮罩4-3.png", 5, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/审批背景框4-3.png", 410, 274, 1100, 611, 21);
  addScreenText(frame, session.eventData.title || "法庭议题", 485, 330, 930, 36, 22, "center large");
  addScreenText(frame, session.eventData.narrative || "", 505, 390, 890, 180, 22, "auto-height");
  const support = session.eventData.options[0];
  const oppose = session.eventData.options[1];
  addScreenText(
    frame,
    `支持：${support?.label || "改革方案"}\n反对：${oppose?.label || "维持现状"}\n弃权：不计入正反结果`,
    560,
    590,
    800,
    100,
    22,
    "small auto-height"
  );
  addImageButton(frame, "./image_UI/支持4-3.png", 573, 766, 138.5, 57, 23, () => castDesignedCourtVote("support"));
  addImageButton(frame, "./image_UI/反对4-3.png", 892, 766, 138.5, 57, 23, () => castDesignedCourtVote("oppose"));
  addImageButton(frame, "./image_UI/弃权4-3.png", 1211, 766, 138.5, 57, 23, () => castDesignedCourtVote("abstain"));
}

function castDesignedCourtVote(vote) {
  const session = mandatoryCourtSession;
  if (!session || session.votes.some((item) => item.playerId === LOCAL_PLAYER_ID)) return;

  session.votes.push({
    playerId: LOCAL_PLAYER_ID,
    playerName: getLocalPlayer().name,
    vote,
  });

  state.players.slice(1).forEach((player) => {
    // TODO: Replace random court votes with real network submissions or LLM voting decisions.
    session.votes.push({
      playerId: player.id,
      playerName: player.name,
      vote: randomFrom(["support", "oppose", "abstain"]),
    });
  });

  finalizeDesignedCourtVote();
}

function voteLabel(vote) {
  if (vote === "support") return "支持";
  if (vote === "oppose") return "反对";
  return "弃权";
}

function finalizeDesignedCourtVote() {
  const session = mandatoryCourtSession;
  if (!session) return;
  const supportCount = session.votes.filter((item) => item.vote === "support").length;
  const opposeCount = session.votes.filter((item) => item.vote === "oppose").length;
  const abstainCount = session.votes.filter((item) => item.vote === "abstain").length;
  let resultText = `票型：支持${supportCount} / 反对${opposeCount} / 弃权${abstainCount}`;
  let impactText = "你受到的数值影响：无";

  let winner = null;
  if (supportCount > opposeCount) {
    winner = session.eventData.options[0];
    resultText += "\n结果：支持方通过。";
  } else if (opposeCount > supportCount) {
    winner = session.eventData.options[1];
    resultText += "\n结果：反对方通过。";
  } else {
    resultText += "\n结果：正反票平局，本次法庭不改变规则。";
  }

  if (winner) {
    state.players.forEach((player, idx) => {
      applyEffects(state, player.id, {
        ...winner.effects,
        global: idx === 0 ? winner.effects.global : emptyGlobalEffects(),
      });
    });
    impactText = `你受到的数值影响：${effectPreview(winner.effects, getLocalPlayer())}`;
    addFeed({
      player: getLocalPlayer(),
      tag: "⚖️",
      summary: winner.summary || `法庭结果：${winner.label}`,
    });
  } else {
    addFeed({
      player: getLocalPlayer(),
      tag: "⚖️",
      summary: "法庭投票未形成多数结果，本次不产生规则影响。",
    });
  }

  session.votes.forEach((item) => {
    logChoice(
      state.players.find((player) => player.id === item.playerId) || getLocalPlayer(),
      "court",
      voteLabel(item.vote),
      `${item.playerName}在法庭中投下${voteLabel(item.vote)}票。`
    );
  });

  if (session.kind === "forced") {
    state.courtDoneRounds.push(state.round);
  } else {
    syncSession.emergencyCourtUsed = true;
  }

  mandatoryCourtSession = null;
  syncSession.overlay = {
    type: "courtResult",
    message: `${session.eventData.narrative || ""}\n\n${resultText}\n\n${impactText}`,
  };
  renderGameScreen();
}

function renderCourtResultOverlay(frame, overlay) {
  addAsset(frame, "./image_UI/背景模糊遮罩4-4.png", 5, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/通知背景框4-4.png", 712, 380, 797, 505, 21);
  addAsset(frame, "./image_UI/结果宣判4-4.png", 1026, 460, 170, 47, 22);
  addScreenText(frame, overlay.message || "法庭结果已结算。", 767, 542, 713, 193, 22, "auto-height");
  addImageButton(frame, "./image_UI/确定4-4.png", 318, 402, 161, 57, 23, () => {
    syncSession.overlay = null;
    renderGameScreen();
  });
}

function setLoading(active, message = "正在生成剧情...") {
  if (active) {
    loadingDepth += 1;
    console.log(`[ui-loading] + depth=${loadingDepth} message=${message}`);
    document.body.classList.add("is-loading");
    if (el.loadingText) el.loadingText.textContent = message;
    return;
  }

  loadingDepth = Math.max(0, loadingDepth - 1);
  console.log(`[ui-loading] - depth=${loadingDepth}`);
  if (loadingDepth === 0) {
    document.body.classList.remove("is-loading");
  }
}

async function runWithLoading(message, fn) {
  loadingOpSeq += 1;
  const opId = loadingOpSeq;
  const startedAt = performance.now();
  console.log(`[ui-op#${opId}] start ${message}`);
  setLoading(true, message);
  try {
    const result = await fn();
    console.log(`[ui-op#${opId}] success ms=${Math.round(performance.now() - startedAt)}`);
    return result;
  } catch (error) {
    console.error(
      `[ui-op#${opId}] failed ms=${Math.round(performance.now() - startedAt)} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  } finally {
    setLoading(false);
  }
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function effectPreview(effects, player = null) {
  const self = effects?.self || {};
  const global = effects?.global || {};
  const combinedSelf = {
    health: Number(self.health || 0),
    reputation: Number(self.reputation || 0),
    wealth: Number(self.wealth || 0),
  };
  const effective = player ? calculateEffectiveDelta(player, combinedSelf) : combinedSelf;
  const chunks = [];

  const pushNum = (label, val) => {
    if (!val) return;
    const rounded = Math.round(Number(val || 0));
    if (!rounded) return;
    chunks.push(`${label}${rounded > 0 ? "+" : ""}${rounded}`);
  };

  pushNum("健康", effective.health || 0);
  pushNum("名誉", effective.reputation || 0);
  pushNum("财富", effective.wealth || 0);
  pushNum("存活", effective.survivalProgress || effects?.meta?.survivalProgress || 0);
  pushNum("全体健康", global.allHealthDelta || 0);
  pushNum("平等", -(global.socialGap || 0));
  if (effects?.intimacyDelta?.initiator || effects?.intimacyDelta?.target) {
    chunks.push(`亲密度Δ${(effects.intimacyDelta.initiator || 0) + (effects.intimacyDelta.target || 0)}`);
  }

  return chunks.join(" | ") || "数值变化平缓";
}

function renderLeftPanel() {
  const current = state.players[state.currentPlayerIndex];

  const currentHtml = state.players
    .map((p) => {
      const delta = p.lastDelta || {};
      const cls = p.id === current.id ? "player-card current" : "player-card";
      return `
        <section class="${cls}">
          <div class="player-head">
            <span>${esc(p.name)} ${p.alive ? "" : "(出局)"}</span>
            <span class="player-mini">${p.gender === "male" ? "男" : "女"} | ${p.age}岁 | ${esc(p.job)}</span>
          </div>
          <div class="bio">${esc(p.bio)}</div>
          <div class="stat-grid">
            <div class="stat">身心健康 <b class="${delta.health > 0 ? "delta-plus" : delta.health < 0 ? "delta-minus" : ""}">${displayNum(p.stats.health)}</b></div>
            <div class="stat">社会名誉 <b class="${delta.reputation > 0 ? "delta-plus" : delta.reputation < 0 ? "delta-minus" : ""}">${displayNum(p.stats.reputation)}</b></div>
            <div class="stat">财富(万) <b class="${delta.wealth > 0 ? "delta-plus" : delta.wealth < 0 ? "delta-minus" : ""}">${displayNum(p.stats.wealth)}</b></div>
            <div class="stat">存活进度 <b class="${delta.survivalProgress > 0 ? "delta-plus" : delta.survivalProgress < 0 ? "delta-minus" : ""}">${displayNum(p.survivalProgress)}</b></div>
            <div class="stat">权利指数 <b>${displayLevel(p.stats.rightsLevel)}</b></div>
            <div class="stat">风险等级 <b>${displayLevel(p.stats.riskLevel)}</b></div>
          </div>
          <div class="tag-row">
            ${p.marriedTo ? `<span class="tag">婚姻: ${esc(state.players.find((x) => x.id === p.marriedTo)?.name || "未知")}</span>` : '<span class="tag">婚姻: 无</span>'}
            ${p.marriedTo ? `<span class="tag">亲密度: ${p.intimacy}</span>` : ""}
            ${p.items
              .map((item) => `<span class="tag">${esc(item.name)}(${item.turnsLeft}回合)</span>`)
              .join("")}
            ${p.items.length === 0 ? '<span class="tag">无道具</span>' : ""}
            <span class="tag">咨询室: ${p.counselingUsed}/3</span>
          </div>
        </section>
      `;
    })
    .join("");

  el.leftPanel.innerHTML = currentHtml;
}

function renderTop() {
  const current = state.players.find((p) => p.id === syncSession.localPlayerId) || state.players[state.currentPlayerIndex];
  el.roundNum.textContent = String(Math.min(state.round, state.maxRound));
  el.currentPlayerName.textContent = `${current.name}${current.alive ? "" : "(出局)"}`;
  if (syncSession.roundPhase === "waiting") {
    el.turnStage.textContent = "等待其他玩家";
  } else if (syncSession.roundPhase === "settlement") {
    el.turnStage.textContent = "结算阶段";
  } else {
    el.turnStage.textContent = state.stage === "primary" ? "主行动" : "文化行动";
  }
  el.globalGap.textContent = String(state.socialGap);

  const total = Math.max(1, state.maleRights + state.femaleRights);
  const malePct = Math.round((state.maleRights / total) * 100);
  const femalePct = 100 - malePct;

  el.balanceLeft.style.width = `${malePct}%`;
  el.balanceRight.style.width = `${femalePct}%`;

  const mustCourt = isCourtRoundPending();
  el.courtBtn.classList.toggle("must", mustCourt);
}

function renderFeed() {
  el.feedList.innerHTML = state.events
    .slice(0, 120)
    .map(
      (e) => `
      <article class="feed-item">
        <div class="meta">[回合${e.round}] ${esc(e.playerName)} ${esc(e.tag || "")}</div>
        <div>${esc(e.summary)}</div>
      </article>
    `
    )
    .join("");
}

function syncBoardAvailability() {
  const current = state.players.find((p) => p.id === syncSession.localPlayerId) || state.players[state.currentPlayerIndex];
  const mustCourt = isCourtRoundPending();
  const courtLocked = mustCourt || isMandatoryCourtActive() || courtSessionLoading;

  const alive = current.alive;
  el.boardButtons.forEach((btn) => {
    const scene = btn.dataset.scene;
    let allowed = alive;

    if (courtLocked) {
      allowed = false;
    }

    if (state.stage === "primary") {
      if (!["workplace", "family", "opportunity", "pvp", "meditate"].includes(scene)) {
        allowed = false;
      }
      if (scene === "opportunity" && state.round < 10) allowed = false;
    } else {
      if (!["culture", "pvp", "meditate"].includes(scene)) {
        allowed = false;
      }
    }

    btn.disabled = !allowed || loadingDepth > 0 || syncSession.roundPhase !== "acting";
  });

  el.courtBtn.disabled = loadingDepth > 0 || !mustCourt || syncSession.roundPhase !== "acting";
}

function renderAll() {
  renderTop();
  renderLeftPanel();
  renderFeed();
  syncBoardAvailability();
}

function addFeed({ player, tag, summary }) {
  state.events.unshift({
    round: state.round,
    playerId: player.id,
    relatedPlayerIds: [player.id],
    playerName: player.name,
    tag,
    summary,
    title: summary,
  });
}

function emptyGlobalEffects() {
  return { socialGap: 0, maleRights: 0, femaleRights: 0, allHealthDelta: 0 };
}

function hasGlobalEffect(global = {}) {
  return ["socialGap", "maleRights", "femaleRights", "allHealthDelta"].some((key) => Number(global[key] || 0) !== 0);
}

function applyImmediateChoiceEffects(player, effects) {
  applyEffects(state, player.id, {
    self: effects?.self || {},
    global: emptyGlobalEffects(),
    meta: effects?.meta || {},
  });
}

function queueGlobalEffects(player, effects, summary) {
  const global = effects?.global || {};
  if (!hasGlobalEffect(global)) return;
  syncSession.pendingGlobalEffects.push({
    round: state.round,
    playerId: player.id,
    playerName: player.name,
    global: { ...emptyGlobalEffects(), ...global },
    summary,
  });
}

function logChoice(player, scene, choice, summary, relatedPlayerIds = [player.id]) {
  logRoundDecision(state, {
    round: state.round,
    playerId: player.id,
    relatedPlayerIds,
    playerName: player.name,
    scene,
    choice,
    summary,
  });
}

function applyMeditate(player) {
  const effects = {
    self: { health: 6, reputation: 0, wealth: 0 },
    global: { socialGap: 0, maleRights: 0, femaleRights: 0, allHealthDelta: 0 },
    meta: { survivalProgress: 4, equalityProgress: 0, major: false, tag: "🧘" },
  };
  applyImmediateChoiceEffects(player, effects);

  addFeed({ player, tag: "🧘", summary: `${player.name}选择冥想，短暂恢复状态。` });
  logChoice(player, "meditate", "冥想", `${player.name}选择冥想。`);
  closeModal();
  void endActionAndMaybeAdvance();
}

function closeModal() {
  if (isMandatoryCourtActive()) return;
  el.eventModal.classList.add("hidden");
}

function openModal(title, bodyBuilder) {
  el.modalTitle.textContent = title;
  el.modalBody.innerHTML = "";
  bodyBuilder(el.modalBody);
  el.eventModal.classList.remove("hidden");
}

function wealthDeltaLimit(scene, subScene) {
  if (scene === "opportunity") return 8;
  if (scene === "court") return 6;
  if (scene === "culture" && subScene === "square") return 2;
  if (scene === "culture") return 1.2;
  return 1.8;
}

function allowsAllHealthDelta(scene, subScene) {
  return scene === "court" || (scene === "culture" && subScene === "square");
}

function sanitizeOptionEffects(option, scene, subScene, player = null) {
  const safe = option;
  safe.effects = safe.effects || {};
  safe.effects.self = safe.effects.self || {};
  safe.effects.global = safe.effects.global || {};
  safe.effects.meta = safe.effects.meta || {};

  const isNoDiscuss = safe.id === "opt_no_discuss";

  if (isNoDiscuss) {
    safe.effects.self.health = -3;
    safe.effects.self.reputation = 0;
    safe.effects.self.wealth = 0;
    safe.effects.global.socialGap = 0;
    safe.effects.global.maleRights = 0;
    safe.effects.global.femaleRights = 0;
    safe.effects.global.allHealthDelta = 0;
    safe.effects.meta.survivalProgress = -2;
    safe.effects.meta.equalityProgress = 0;
    safe.effects.meta.major = false;
    safe.effects.meta.tag = "🗣️";
  }

  if (scene === "culture" && subScene === "library" && !isNoDiscuss) {
    const h = Number(safe.effects.self.health || 0);
    const r = Number(safe.effects.self.reputation || 0);
    const w = Number(safe.effects.self.wealth || 0);

    safe.effects.self.health = h > 0 ? h : 3;
    safe.effects.self.reputation = r >= 0 ? r : 1;
    safe.effects.self.wealth = w <= 0 ? w : -1;

    safe.effects.global.allHealthDelta = 0;
    safe.effects.meta.major = false;
    safe.effects.meta.tag = "📚";

    const survival = Number(safe.effects.meta.survivalProgress || 0);
    const equality = Number(safe.effects.meta.equalityProgress || 0);
    safe.effects.meta.survivalProgress = survival > 0 ? survival : 2;
    safe.effects.meta.equalityProgress = equality > 0 ? equality : 2;
  }

  if (scene === "culture" && subScene === "counseling" && !isNoDiscuss) {
    const h = Number(safe.effects.self.health || 0);
    const r = Number(safe.effects.self.reputation || 0);
    const w = Number(safe.effects.self.wealth || 0);

    safe.effects.self.health = h > 0 ? h : 6;

    const hasCost = r < 0 || w < 0;
    if (!hasCost) {
      safe.effects.self.wealth = -1;
      safe.effects.self.reputation = r > 0 ? 0 : r;
    }

    safe.effects.global.allHealthDelta = 0;
    safe.effects.meta.major = false;
    safe.effects.meta.tag = "🛋️";

    const survival = Number(safe.effects.meta.survivalProgress || 0);
    safe.effects.meta.survivalProgress = survival > 0 ? survival : 2;
  }

  const wealthCap = wealthDeltaLimit(scene, subScene);
  safe.effects.self.wealth = withOneDecimal(clampNum(safe.effects.self.wealth, -wealthCap, wealthCap));
  safe.effects.self.health = Math.round(clampNum(safe.effects.self.health, -35, 20));
  safe.effects.self.reputation = Math.round(clampNum(safe.effects.self.reputation, -30, 30));

  safe.effects.global.socialGap = Math.round(clampNum(safe.effects.global.socialGap, -10, 10));
  safe.effects.global.maleRights = Math.round(clampNum(safe.effects.global.maleRights, -6, 6));
  safe.effects.global.femaleRights = Math.round(clampNum(safe.effects.global.femaleRights, -6, 6));
  safe.effects.global.allHealthDelta = allowsAllHealthDelta(scene, subScene)
    ? Math.round(clampNum(safe.effects.global.allHealthDelta, -10, 10))
    : 0;

  safe.effects.meta.survivalProgress = Math.round(clampNum(safe.effects.meta.survivalProgress, -20, 20));
  safe.effects.meta.equalityProgress = Math.round(clampNum(safe.effects.meta.equalityProgress, -20, 20));
  safe.effects.meta.tag = String(safe.effects.meta.tag || "📌");

  if (player) {
    const effective = calculateEffectiveDelta(player, {
      health: Number(safe.effects.self.health || 0),
      reputation: safe.effects.self.reputation || 0,
      wealth: safe.effects.self.wealth || 0,
    });
    safe.effects.meta.survivalProgress = Math.round(effective.survivalProgress || 0);
  }

  return safe;
}

function normalizeEvent(raw, scene = "workplace", subScene = null, player = null) {
  const safe = raw || {};
  safe.title = safe.title || "未命名事件";
  safe.narrative = safe.narrative || "模型未返回叙事，已使用降级文本。";
  safe.options = Array.isArray(safe.options) && safe.options.length > 0 ? safe.options.slice(0, 3) : [];

  if (safe.options.length === 0) {
    safe.options = [
      {
        id: "fallback_opt",
        label: "保持谨慎",
        description: "避免极端损益",
        summary: `${player?.name || "玩家"}在${safe.title}中选择谨慎处理，暂时稳住局面。`,
        thread: { status: "closed", summary: "事件以谨慎方式收束，暂无后续悬念。" },
        effects: {
          self: { health: -1, reputation: 0, wealth: 0 },
          global: { socialGap: 0, maleRights: 0, femaleRights: 0, allHealthDelta: 0 },
          meta: { survivalProgress: 0, equalityProgress: 0, major: false, tag: "🧩" },
        },
      },
    ];
  }

  safe.thread = safe.thread || {
    threadId: `thr_${Date.now()}`,
    status: "open",
    summary: "自动补全事件线",
  };
  safe.thread.threadId = String(safe.thread.threadId || `thr_${Date.now()}`);
  safe.thread.status = ["open", "closed"].includes(safe.thread.status) ? safe.thread.status : "open";
  safe.thread.summary = String(safe.thread.summary || "事件线状态待观察。").slice(0, 120);

  if (scene === "culture" && subScene === "square") {
    safe.options = safe.options.filter((opt) => opt?.id !== "opt_no_discuss");
    safe.options.push({
      id: "opt_no_discuss",
      label: "不参与讨论",
      description: "保持沉默并离场，固定承受-3点身心健康值。",
      summary: `${player?.name || "玩家"}没有参与这场公共争议，选择把注意力收回到自身状态。`,
      thread: { status: "closed", summary: "玩家未介入公共讨论，事件线不再延展。" },
      effects: {
        self: { health: -3, reputation: 0, wealth: 0 },
        global: { socialGap: 0, maleRights: 0, femaleRights: 0, allHealthDelta: 0 },
        meta: { survivalProgress: -2, equalityProgress: 0, major: false, tag: "🗣️" },
      },
    });
  }

  safe.options = safe.options.map((opt) => {
    const normalized = sanitizeOptionEffects(opt, scene, subScene, player);
    normalized.summary = String(
      normalized.summary ||
        `${player?.name || "玩家"}在“${safe.title}”中选择“${normalized.label || "行动"}”，事件留下新的影响。`
    ).slice(0, 120);
    normalized.thread = normalized.thread && typeof normalized.thread === "object" ? normalized.thread : {};
    normalized.thread.status = ["open", "closed"].includes(normalized.thread.status)
      ? normalized.thread.status
      : safe.thread.status;
    normalized.thread.summary = String(normalized.thread.summary || safe.thread.summary || "事件线状态已更新。").slice(
      0,
      120
    );
    return normalized;
  });
  return safe;
}

function handleOptionChoose(eventData, option) {
  const player = state.players.find((p) => p.id === syncSession.localPlayerId) || state.players[state.currentPlayerIndex];

  applyImmediateChoiceEffects(player, option.effects);

  const summary = option.summary || `${eventData.title} -> ${option.label}`;
  queueGlobalEffects(player, option.effects, summary);
  const thread = {
    ...eventData.thread,
    ...(option.thread || {}),
    threadId: eventData.thread?.threadId || `thr_${Date.now()}`,
  };

  state.events.unshift({
    round: state.round,
    playerId: player.id,
    relatedPlayerIds: [player.id],
    playerName: player.name,
    tag: option.effects?.meta?.tag || "📌",
    summary,
    title: eventData.title,
    choiceLabel: option.label,
    narrative: eventData.narrative,
    thread,
  });

  logChoice(player, option.effects?.meta?.tag || "scene", option.label, summary);

  closeModal();
  void endActionAndMaybeAdvance();
}

function itemNameByType(type) {
  if (type === "swap") return "转运卡";
  if (type === "support") return "社会支持卡";
  return "正义裁决";
}

function grantRandomItem(player) {
  const types = ["swap", "support", "justice"];
  const t = types[Math.floor(Math.random() * types.length)];
  player.items.push({ type: t, name: itemNameByType(t), turnsLeft: 2 });
  addFeed({ player, tag: "🎁", summary: `${player.name}在机遇场获得${itemNameByType(t)}。` });
}

async function runScene(scene) {
  if (loadingDepth > 0) return;
  if (syncSession.roundPhase !== "acting") return;

  if (isCourtRoundPending()) {
    await runCourt();
    return;
  }

  const player = state.players.find((p) => p.id === syncSession.localPlayerId) || state.players[state.currentPlayerIndex];
  if (!player.alive) return;

  if (scene === "meditate") {
    applyMeditate(player);
    renderAll();
    return;
  }

  if (scene === "court") {
    await runCourt();
    return;
  }

  if (scene === "pvp") {
    await openPvpSelector(player);
    return;
  }

  if (scene === "culture") {
    openCultureSelector(player);
    return;
  }

  if (scene === "opportunity") {
    if (state.round < 10) return;
    grantRandomItem(player);
  }

  try {
    const historySummary = buildHistorySummary(state.events, player.id, state);
    const raw = await runWithLoading("AI正在生成事件与选项...", () =>
      generateSceneEvent(
        {
          scene,
          subScene: null,
          player,
          gameState: state,
          historySummary,
        },
        apiEnabled
      )
    );

    const eventData = normalizeEvent(raw, scene, null, player);
    showEventModal(eventData);
  } catch (error) {
    console.error("[runScene] failed", error);
    addFeed({
      player,
      tag: "⚠️",
      summary: `事件生成失败：${error instanceof Error ? error.message : "未知错误"}`,
    });
    renderAll();
  }
}

function openCultureSelector(player) {
  const canCounsel = canOpenCounseling(player);

  openModal("文化广场", (body) => {
    const text = document.createElement("p");
    text.textContent = "请选择子板块：图书馆(认知提升) / 社交广场(全员联动) / 咨询室(低血量修复)。";
    body.appendChild(text);

    const rows = [
      {
        key: "library",
        label: "图书馆",
        desc: "知识科普，偏向稳定增益。",
      },
      {
        key: "square",
        label: "社交广场",
        desc: "触发舆论冲突，所有玩家健康联动。",
      },
      {
        key: "counseling",
        label: "咨询室",
        desc: canCounsel
          ? "你满足条件，可进行身心修复(有代价)。"
          : "仅当健康<50且每局最多3次可进入。",
        disabled: !canCounsel,
      },
    ];

    rows.forEach((r) => {
      const btn = document.createElement("button");
      btn.className = "option-btn";
      btn.disabled = Boolean(r.disabled);
      btn.innerHTML = `<div class="option-title">${r.label}</div><div class="option-desc">${r.desc}</div>`;
      btn.onclick = async () => {
        if (loadingDepth > 0) return;
        try {
          const historySummary = buildHistorySummary(state.events, player.id, state);
          const raw = await runWithLoading("AI正在生成文化场景事件...", () =>
            generateSceneEvent(
              {
                scene: "culture",
                subScene: r.key,
                player,
                gameState: state,
                historySummary,
              },
              apiEnabled
            )
          );

          const eventData = normalizeEvent(raw, "culture", r.key, player);

          if (r.key === "counseling") {
            player.counselingUsed += 1;
          }

          showEventModal(eventData);
        } catch (error) {
          console.error("[openCultureSelector] failed", error);
          addFeed({
            player,
            tag: "⚠️",
            summary: `文化事件生成失败：${error instanceof Error ? error.message : "未知错误"}`,
          });
          renderAll();
        }
      };
      body.appendChild(btn);
    });
  });
}

function showEventModal(eventData) {
  const player = state.players.find((p) => p.id === syncSession.localPlayerId) || state.players[state.currentPlayerIndex];

  openModal(eventData.title, (body) => {
    const para = document.createElement("p");
    para.textContent = eventData.narrative;
    body.appendChild(para);

    eventData.options.forEach((opt) => {
      const node = el.optionTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".option-title").textContent = opt.label;
      node.querySelector(".option-desc").textContent = opt.description || "";
      node.querySelector(".option-impact").textContent = effectPreview(opt.effects, player);
      node.onclick = () => handleOptionChoose(eventData, opt);
      body.appendChild(node);
    });
  });
}

async function runCourt() {
  if (loadingDepth > 0 || courtSessionLoading) return;
  if (!isCourtRoundPending()) return;

  if (!mandatoryCourtSession) {
    courtSessionLoading = true;
    renderAll();

    const player = state.players[state.currentPlayerIndex];
    try {
      const historySummary = buildHistorySummary(state.events, player.id, state);

      const raw = await runWithLoading("AI正在生成法庭议题...", () =>
        generateCourtEvent(
          {
            player,
            gameState: state,
            historySummary,
          },
          apiEnabled
        )
      );

      const eventData = normalizeEvent(raw, "court", null, player);
      mandatoryCourtSession = {
        round: state.round,
        eventData: {
          ...eventData,
          options: eventData.options.slice(0, 2),
        },
        voterOrder: state.players.map((p) => p.id),
        votes: [],
      };
    } catch (error) {
      console.error("[runCourt] failed", error);
      addFeed({
        player,
        tag: "⚠️",
        summary: `法庭议题生成失败：${error instanceof Error ? error.message : "未知错误"}`,
      });
      renderAll();
      return;
    } finally {
      courtSessionLoading = false;
      renderAll();
    }
  }

  openMandatoryCourtModal();
}

function openMandatoryCourtModal() {
  if (!isMandatoryCourtActive()) return;
  const session = mandatoryCourtSession;
  const voteIndex = session.votes.length;
  const voterId = session.voterOrder[voteIndex];
  const voter = state.players.find((p) => p.id === voterId) || state.players[0];

  openModal(`⚖️ ${session.eventData.title}`, (body) => {
    const p = document.createElement("p");
    p.textContent = session.eventData.narrative;
    body.appendChild(p);

    const note = document.createElement("p");
    note.textContent = `第${state.round}回合法庭强制投票：${session.votes.length}/${session.voterOrder.length}。当前投票人：${voter.name}。`;
    body.appendChild(note);

    const rule = document.createElement("p");
    rule.textContent = "规则：4人全部投票后，少数服从多数；若平票，本回合法庭结果不生效。";
    body.appendChild(rule);

    session.eventData.options.forEach((opt) => {
      const node = el.optionTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".option-title").textContent = opt.label;
      node.querySelector(".option-desc").textContent = opt.description || "";
      node.querySelector(".option-impact").textContent = effectPreview(opt.effects, voter);
      node.onclick = () => castCourtVote(opt, voter);
      body.appendChild(node);
    });

    if (voter.id !== LOCAL_PLAYER_ID) {
      const autoOption = randomFrom(session.eventData.options);
      window.setTimeout(() => castCourtVote(autoOption, voter), 250);
    }
  });
}

function castCourtVote(option, voter) {
  if (!isMandatoryCourtActive()) return;
  const session = mandatoryCourtSession;
  const expectedVoterId = session.voterOrder[session.votes.length];
  if (!voter || voter.id !== expectedVoterId) return;

  session.votes.push({
    playerId: voter.id,
    playerName: voter.name,
    optionId: option.id,
    optionLabel: option.label,
  });

  logRoundDecision(state, {
    round: state.round,
    playerId: voter.id,
    playerName: voter.name,
    scene: "court",
    choice: option.label,
    summary: option.summary || `${voter.name}法庭投票: ${option.label}`,
  });

  addFeed({
    player: voter,
    tag: "⚖️",
    summary: `${voter.name}已完成法庭投票(${session.votes.length}/${session.voterOrder.length})。`,
  });

  if (session.votes.length < session.voterOrder.length) {
    openMandatoryCourtModal();
    return;
  }

  finalizeCourtVote();
}

function finalizeCourtVote() {
  if (!isMandatoryCourtActive()) return;
  const session = mandatoryCourtSession;
  const counter = new Map();

  session.votes.forEach((v) => {
    counter.set(v.optionId, (counter.get(v.optionId) || 0) + 1);
  });

  const ranked = Array.from(counter.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked[0] || [null, 0];
  const second = ranked[1] || [null, 0];

  if (top[1] > second[1]) {
    const winner = session.eventData.options.find((x) => x.id === top[0]);
    if (winner) {
      state.players.forEach((p2, idx) => {
        applyEffects(state, p2.id, {
          ...winner.effects,
          global:
            idx === 0
              ? winner.effects.global
              : { socialGap: 0, maleRights: 0, femaleRights: 0, allHealthDelta: 0 },
        });
      });
      addFeed({
        player: state.players[0],
        tag: "⚖️",
        summary: winner.summary || `法庭多数决通过：${winner.label}（${top[1]}票）。`,
      });
    }
  } else {
    addFeed({
      player: state.players[0],
      tag: "⚖️",
      summary: "法庭投票平票，本回合法庭结果作废。",
    });
  }

  state.courtDoneRounds.push(state.round);
  mandatoryCourtSession = null;
  el.eventModal.classList.add("hidden");
  renderAll();
}

async function openPvpSelector(initiator) {
  const others = state.players.filter((p) => p.id !== initiator.id && p.alive);

  openModal("PVP互动", (body) => {
    const info = document.createElement("p");
    info.textContent = "可发起：结婚 / 离婚 / 援助。PVP将在所有玩家提交回合后统一结算。";
    body.appendChild(info);

    const rows = [
      {
        action: "marriage",
        label: "发起结婚",
        available: !initiator.marriedTo,
        hint: initiator.marriedTo ? "你已处于婚姻关系中" : "选择一名异性且未婚角色",
      },
      {
        action: "divorce",
        label: "发起离婚",
        available: Boolean(initiator.marriedTo),
        hint: initiator.marriedTo ? "将解除关系并平分共同财富" : "当前无婚姻关系",
      },
      {
        action: "support",
        label: "申请社会支持",
        available: others.length > 0,
        hint: "选择一名玩家进行援助互动",
      },
    ];

    rows.forEach((row) => {
      const btn = document.createElement("button");
      btn.className = "option-btn";
      btn.disabled = !row.available;
      btn.innerHTML = `<div class="option-title">${row.label}</div><div class="option-desc">${row.hint}</div>`;
      btn.onclick = async () => {
        if (row.action === "divorce") {
          const spouse = state.players.find((p) => p.id === initiator.marriedTo);
          if (!spouse) return;
          queuePvpAction(row.action, initiator, spouse);
          return;
        }

        const candidates =
          row.action === "marriage"
            ? others.filter((p) => p.gender !== initiator.gender && !p.marriedTo)
            : others;

        pickTargetAndResolve(row.action, initiator, candidates);
      };
      body.appendChild(btn);
    });
  });
}

function pickTargetAndResolve(action, initiator, candidates) {
  openModal("选择互动对象", (body) => {
    if (candidates.length === 0) {
      const p = document.createElement("p");
      p.textContent = "当前没有可选对象。";
      body.appendChild(p);
      return;
    }

    candidates.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "option-btn";
      btn.innerHTML = `<div class="option-title">${c.name}</div><div class="option-desc">${
        c.gender === "male" ? "男" : "女"
      } | 财富${displayNum(c.stats.wealth)} | 健康${displayNum(c.stats.health)}</div>`;
      btn.onclick = async () => {
        queuePvpAction(action, initiator, c);
      };
      body.appendChild(btn);
    });
  });
}

function pvpActionLabel(action) {
  if (action === "marriage") return "发起结婚";
  if (action === "divorce") return "发起离婚";
  return "申请社会支持";
}

function queuePvpAction(action, initiator, target, { advance = true } = {}) {
  if (!initiator || !target) return;
  const label = pvpActionLabel(action);
  const summary = `${initiator.name}向${target.name}${label}，等待本回合结算阶段同步处理。`;
  syncSession.pendingPvpActions.push({
    round: state.round,
    action,
    initiatorId: initiator.id,
    targetId: target.id,
  });
  addFeed({ player: initiator, tag: "🤝", summary });
  logChoice(initiator, "pvp", label, summary, [initiator.id, target.id]);
  if (advance) {
    closeModal();
    void endActionAndMaybeAdvance();
  }
}

async function resolveRelationshipAndApply(action, initiator, target) {
  const applied = await resolveRelationshipActionNow(action, initiator, target);
  if (!applied) return;
  closeModal();
  await endActionAndMaybeAdvance();
}

async function resolveRelationshipActionNow(action, initiator, target) {
  if (!initiator || !target || !initiator.alive || !target.alive) return false;
  if (action === "marriage" && (initiator.marriedTo || target.marriedTo)) {
    addFeed({
      player: initiator,
      tag: "🤝",
      summary: `${initiator.name}与${target.name}的结婚申请因关系状态变化未能生效。`,
    });
    return false;
  }
  if (action === "divorce" && initiator.marriedTo !== target.id) {
    addFeed({
      player: initiator,
      tag: "🤝",
      summary: `${initiator.name}的离婚申请因关系状态变化未能生效。`,
    });
    return false;
  }

  let result = null;
  try {
    const historySummary = buildHistorySummary(state.events, initiator.id, state);
    result = await runWithLoading("AI正在结算关系互动...", () =>
      resolveRelationshipAction(
        {
          action,
          initiator,
          target,
          gameState: state,
          historySummary,
        },
        apiEnabled
      )
    );
  } catch (error) {
    console.error("[resolveRelationshipAndApply] failed", error);
    addFeed({
      player: initiator,
      tag: "⚠️",
      summary: `关系互动结算失败：${error instanceof Error ? error.message : "未知错误"}`,
    });
    renderAll();
    return false;
  }

  applyLocalDelta(state, initiator, result.effects?.initiator);
  applyLocalDelta(state, target, result.effects?.target);

  const global = result.effects?.global || {};
  state.socialGap = Math.max(0, state.socialGap + (global.socialGap || 0));
  state.maleRights = Math.max(0, Math.min(100, state.maleRights + (global.maleRights || 0)));
  state.femaleRights = Math.max(0, Math.min(100, state.femaleRights + (global.femaleRights || 0)));

  if (action === "marriage") {
    createMarriage(state, initiator.id, target.id, result.effects?.marriage?.initIntimacy || 60);
  }

  if (action === "divorce") {
    dissolveMarriage(state, initiator.id, target.id);
  }

  if (initiator.marriedTo === target.id || action === "marriage") {
    updateIntimacyPair(
      state,
      initiator.id,
      target.id,
      result.effects?.intimacyDelta?.initiator || 0,
      result.effects?.intimacyDelta?.target || 0
    );
  }

  markPlayersLinkedByPvp(state, initiator.id, target.id);

  const summary = result.summary || `${initiator.name}与${target.name}：${result.title || action}`;
  addFeed({
    player: initiator,
    tag: result.tag || "🤝",
    summary,
  });

  if (state.events[0]) {
    state.events[0].relatedPlayerIds = [initiator.id, target.id];
  }

  return true;
}

function buildSimulatedEffects(scene, subScene = null) {
  if (scene === "meditate") {
    return {
      self: { health: 5, reputation: 0, wealth: 0 },
      global: emptyGlobalEffects(),
      meta: { tag: "🧘" },
    };
  }

  if (scene === "culture" && subScene === "library") {
    return {
      self: { health: 3, reputation: 1, wealth: -1 },
      global: { socialGap: -1, maleRights: 0, femaleRights: 1, allHealthDelta: 0 },
      meta: { tag: "📚" },
    };
  }

  if (scene === "culture" && subScene === "square") {
    return {
      self: { health: -4, reputation: 2, wealth: 0 },
      global: { socialGap: -1, maleRights: 1, femaleRights: 1, allHealthDelta: -1 },
      meta: { tag: "🗣️" },
    };
  }

  const assertive = Math.random() > 0.45;
  const tag = scene === "family" ? "🏠" : scene === "opportunity" ? "🎲" : "💼";
  return assertive
    ? {
        self: { health: -4, reputation: 3, wealth: -1 },
        global: { socialGap: -2, maleRights: 1, femaleRights: 2, allHealthDelta: 0 },
        meta: { tag },
      }
    : {
        self: { health: -1, reputation: -1, wealth: 1 },
        global: { socialGap: 1, maleRights: 1, femaleRights: 0, allHealthDelta: 0 },
        meta: { tag },
      };
}

function applySimulatedSceneAction(player, scene, subScene = null) {
  const effects = buildSimulatedEffects(scene, subScene);
  const label =
    scene === "meditate"
      ? "冥想"
      : scene === "culture" && subScene === "library"
      ? "图书馆学习"
      : scene === "culture" && subScene === "square"
      ? "参与公共讨论"
      : scene === "family"
      ? "处理家庭议题"
      : scene === "opportunity"
      ? "尝试人生机遇"
      : "处理职场议题";
  const summary = `${player.name}${label}。`;

  applyImmediateChoiceEffects(player, effects);
  queueGlobalEffects(player, effects, summary);
  addFeed({ player, tag: effects.meta.tag, summary });
  logChoice(player, scene === "culture" ? `culture/${subScene || "square"}` : scene, label, summary);
}

function queueRandomPvpAction(player) {
  const others = state.players.filter((p) => p.id !== player.id && p.alive);
  if (others.length === 0) return false;

  const actions = ["support"];
  if (!player.marriedTo) {
    const marriageCandidates = others.filter((p) => p.gender !== player.gender && !p.marriedTo);
    if (marriageCandidates.length > 0) actions.push("marriage");
  } else {
    actions.push("divorce");
  }

  const action = randomFrom(actions);
  const target =
    action === "divorce"
      ? state.players.find((p) => p.id === player.marriedTo)
      : action === "marriage"
      ? randomFrom(others.filter((p) => p.gender !== player.gender && !p.marriedTo))
      : randomFrom(others);

  if (!target) return false;
  queuePvpAction(action, player, target, { advance: false });
  return true;
}

async function simulateControllerTurn(player) {
  if (!player.alive) {
    syncSession.turnSubmissions[player.id] = { round: state.round, skipped: true };
    return;
  }

  // TODO: Replace this random controller with real network submissions or LLM decision agents.
  const primaryScenes = ["workplace", "family"];
  const cultureScenes = ["culture:library", "culture:square"];

  for (const choice of [randomFrom(primaryScenes), randomFrom(cultureScenes)]) {
    if (ensureActionPoints(player) <= 0) break;

    if (choice.startsWith("culture:")) {
      applySimulatedSceneAction(player, "culture", choice.split(":")[1]);
      spendActionPoint(player, 1);
      continue;
    }

    applySimulatedSceneAction(player, choice);
    spendActionPoint(player, 1);
  }

  syncSession.turnSubmissions[player.id] = { round: state.round, submittedAt: Date.now() };
  await delay(120);
}

async function simulateRemotePlayersForRound(roundNumber) {
  for (const player of state.players.slice(1)) {
    if (state.round !== roundNumber) return;
    await simulateControllerTurn(player);
  }
}

async function resolvePendingPvpActions(roundNumber) {
  const actions = syncSession.pendingPvpActions.filter((entry) => entry.round === roundNumber);
  for (const entry of actions) {
    const initiator = state.players.find((p) => p.id === entry.initiatorId);
    const target = state.players.find((p) => p.id === entry.targetId);
    await resolveRelationshipActionNow(entry.action, initiator, target);
  }
  syncSession.pendingPvpActions = syncSession.pendingPvpActions.filter((entry) => entry.round !== roundNumber);
}

function applyPendingGlobalEffects(roundNumber) {
  const entries = syncSession.pendingGlobalEffects.filter((entry) => entry.round === roundNumber);
  entries.forEach((entry) => {
    const player = state.players.find((p) => p.id === entry.playerId) || state.players[0];
    applyEffects(state, player.id, {
      self: {},
      global: entry.global,
      meta: { tag: "📊" },
    });
  });

  if (entries.length > 0) {
    addFeed({
      player: state.players[0],
      tag: "📊",
      summary: `回合${roundNumber}同步应用了${entries.length}项全局影响。`,
    });
  }

  syncSession.pendingGlobalEffects = syncSession.pendingGlobalEffects.filter((entry) => entry.round !== roundNumber);
}

function appendRoundJournal(rows, roundNumber) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  state.players.forEach((player, idx) => {
    const playerRows = rows.filter((row) => row.playerId === player.id);
    if (playerRows.length === 0) return;
    syncSession.journalEntries.push({
      round: roundNumber,
      playerLabel: `${idx + 1}号玩家`,
      playerName: player.name,
      title: `第${roundNumber}回合记录`,
      summary: playerRows.map((row) => row.summary || `${row.scene}：${row.choice}`).join("\n"),
    });
  });
}

function tickRoundItems() {
  state.players.forEach((p) => {
    p.items = p.items
      .map((it) => ({ ...it, turnsLeft: it.turnsLeft - 1 }))
      .filter((it) => it.turnsLeft > 0);
  });
}

async function submitLocalTurnAndResolveRound() {
  const roundNumber = state.round;
  syncSession.turnSubmissions[LOCAL_PLAYER_ID] = { round: roundNumber, submittedAt: Date.now() };
  syncSession.roundPhase = "waiting";
  renderGameScreen();

  await runWithLoading("等待其他玩家完成回合并进入同步结算...", async () => {
    await simulateRemotePlayersForRound(roundNumber);
    syncSession.roundPhase = "settlement";
    renderGameScreen();
    await resolvePendingPvpActions(roundNumber);
    applyPendingGlobalEffects(roundNumber);
    decayIntimacyForRound(state, 2);
    tickRoundItems();
    await settleRoundEvaluation(roundNumber);

    state.round += 1;
    state.currentPlayerIndex = 0;
    state.stage = "primary";
    syncSession.turnSubmissions = {};
    syncSession.roundPhase = "acting";
    syncSession.actionSpentThisRound = 0;
  });

  const result = checkWinOrLose(state);
  if (result) {
    showTerminalResult(result);
    return;
  }

  renderGameScreen();
  if (isCourtRoundPending()) {
    openCourtAlert("forced");
  }
}

async function settleRoundEvaluation(roundNumber) {
  const rows = consumeRoundDecisionLog(state, roundNumber);
  if (rows.length === 0) return;
  appendRoundJournal(rows, roundNumber);

  const roundChoicesText = rows
    .map((x, idx) => `${idx + 1}. ${x.playerName} [${x.scene}] 选择: ${x.choice}; ${x.summary}`)
    .join("\n");

  let result = null;
  try {
    result = await runWithLoading("AI正在进行本轮7维平等结算...", () =>
      evaluateRoundRights(
        {
          gameState: state,
          roundChoicesText,
        },
        apiEnabled
      )
    );
  } catch (error) {
    console.error("[settleRoundEvaluation] failed", error);
    addFeed({
      player: state.players[state.currentPlayerIndex],
      tag: "⚠️",
      summary: `回合评估失败：${error instanceof Error ? error.message : "未知错误"}`,
    });
    renderGameScreen();
    return;
  }

  applyRoundEvaluation(state, result);

  const current = state.players[state.currentPlayerIndex];
  addFeed({
    player: current,
    tag: "📊",
    summary: `回合${roundNumber}评估：${result.summary || "完成7维平等结算"}`,
  });
}

async function endActionAndMaybeAdvance() {
  if (syncSession.roundPhase !== "acting") return;

  if (state.stage === "primary") {
    state.stage = "culture";
    renderAll();
    return;
  }

  await submitLocalTurnAndResolveRound();
}

function showTerminalResult(result) {
  if (result === "success") {
    syncSession.overlay = { type: "notice", message: "结局：社会共进\n\n超过半数玩家存活，且社会权利差值小于5。你们在冲突中推动了更均衡的秩序。" };
  }

  if (result === "failed") {
    syncSession.overlay = { type: "notice", message: "结局：失衡坍塌\n\n在限定回合内未达成目标，或角色存活失败。请复盘关键抉择并重开新局。" };
  }
  renderGameScreen();
}

function bindEvents() {
  el.boardButtons.forEach((btn) => {
    btn.addEventListener("click", () => runScene(btn.dataset.scene));
  });

  el.courtBtn.addEventListener("click", () => runScene("court"));
  el.closeModal.addEventListener("click", closeModal);

  el.eventModal.addEventListener("click", (e) => {
    if (e.target === el.eventModal) closeModal();
  });

  el.mobileFab.addEventListener("click", () => {
    el.leftPanel.classList.toggle("open");
  });
}

async function detectRuntimeStatus() {
  try {
    const resp = await fetch("/api/health");
    if (!resp.ok) {
      return {
        mode: "mock",
        message: "未检测到后端模型代理（可能是静态服务器模式），将使用本地Mock事件。",
      };
    }

    const info = await resp.json();
    if (!info?.hasApiKey) {
      return {
        mode: "mock",
        message: "检测到后端代理，但未读取到 DEEPSEEK_API_KEY，将使用Mock事件。",
      };
    }

    return {
      mode: "online",
      message: `已连接DeepSeek模型：${info.model}`,
    };
  } catch {
    return {
      mode: "mock",
      message: "无法连接后端模型代理，将使用本地Mock事件。",
    };
  }
}

async function bootstrap() {
  try {
    bindEvents();
    window.addEventListener("resize", updateScreenScale);
    runtimeStatus = await detectRuntimeStatus();
    renderStartScreen();
  } catch (error) {
    console.error("[bootstrap] failed", error);
    runtimeStatus = {
      mode: "mock",
      message: `初始化检测失败，将使用本地Mock：${error instanceof Error ? error.message : "未知错误"}`,
    };
    renderStartScreen();
  }
}

void bootstrap();
