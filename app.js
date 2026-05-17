import {
  generateCharacterCohort,
  evaluateRoundRights,
  generateInitialCharacter,
  generateCourtEvent,
  generateCourtResult,
  generateOpportunityEvent,
  generatePersonalEnding,
  generateSceneEvent,
  generateSocialEnding,
  resolveRelationshipAction,
} from "./llm.js";
import { buildHistorySummary } from "./prompts.js";
import {
  applyEffects,
  applyLocalDelta,
  calculateEffectiveDelta,
  applyRoundEvaluation,
  canOpenCounseling,
  consumeRoundDecisionLog,
  createMarriage,
  createInitialStateFromPlayers,
  decayIntimacyForRound,
  deriveLevelsFromReputation,
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
  loadingFrame: document.getElementById("loadingFrame"),
  loadingVideo: document.getElementById("loadingVideo"),
  loadingText: document.getElementById("loadingText"),
};

const apiEnabled = true;
let loadingDepth = 0;
let loadingOpSeq = 0;
let mandatoryCourtSession = null;
let courtSessionLoading = false;
let selectedDebugNode = null;
let debugHudNode = null;
let runtimeStatus = {
  mode: "mock",
  message: "尚未检测运行环境。",
};

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_GAME_HEIGHT = 1080;
const LOCAL_PLAYER_ID = "p1";
const STARTING_ACTION_POINTS = 30;
const OPPORTUNITY_UNLOCK_ROUND = 6;
const OPPORTUNITY_ACTION_COST = 2;
const MAX_ITEM_COUNT = 2;
const SUPPORT_CARD_MAX_USES = 3;
const FORTUNE_CARD_MAX_USES = 2;
const ITEM_TYPES = ["swap", "support"];
const RIGHTS_EVALUATION_INTERVAL = 3;
const EARLY_DEATH_SOCIAL_ENDING = "当生存本身已耗尽全部力气，\n人便很难再看见“未来”。";
const UI_DEBUG_ENABLED =
  new URLSearchParams(window.location.search).has("debugUi") ||
  window.localStorage.getItem("kanjian_debug_ui") === "1";
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
    cohort: null,
    roleSeeds: [],
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
    pendingRightsEvaluationRows: [],
    pendingPvpActions: [],
    pvpRequests: [],
    pvpRequestSeq: 0,
    selectedPvpTargetId: null,
    pvpPanelMode: null,
    ending: null,
    journalEntries: [],
    overlay: null,
    selectedEventOptionId: null,
    actionSpentThisRound: 0,
    emergencyCourtUsed: false,
    opportunityNoticeShown: false,
    deathEndingTriggered: false,
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

function tagForScene(scene, subScene = null) {
  if (scene === "workplace") return "💼";
  if (scene === "family") return "🏠";
  if (scene === "opportunity") return "🎲";
  if (scene === "court") return "⚖️";
  if (scene === "culture" && subScene === "library") return "📚";
  if (scene === "culture" && subScene === "counseling") return "🛋️";
  if (scene === "culture") return "🗣️";
  if (scene === "meditate") return "🧘";
  return "📌";
}

function tagForRelationshipAction(action) {
  if (action === "marriage") return "💍";
  if (action === "divorce") return "💔";
  return "🤝";
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
  if (UI_DEBUG_ENABLED) {
    updateDebugRect(node, x, y, w, h, z);
    attachDebugNode(node);
  }
}

function formatDebugNumber(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function getDebugRect(node) {
  return {
    x: Number.parseFloat(node.style.left) || 0,
    y: Number.parseFloat(node.style.top) || 0,
    w: Number.parseFloat(node.style.width) || 0,
    h: Number.parseFloat(node.style.height) || 0,
    z: Number.parseFloat(node.style.zIndex) || 0,
  };
}

function debugRectText(rect) {
  return `XYWH=(${formatDebugNumber(rect.x)}, ${formatDebugNumber(rect.y)}, ${formatDebugNumber(rect.w)}, ${formatDebugNumber(rect.h)}) z=${formatDebugNumber(rect.z)}`;
}

function updateDebugRect(node, x, y, w, h, z = 0) {
  if (!node?.classList?.contains("screen-text")) return;
  const rect = {
    x: Number(x || 0),
    y: Number(y || 0),
    w: Number(w || 0),
    h: Number(h || 0),
    z: Number(z || 0),
  };
  node.dataset.debugRect = debugRectText(rect);
  node.dataset.debugXywh = `${formatDebugNumber(rect.x)}, ${formatDebugNumber(rect.y)}, ${formatDebugNumber(rect.w)}, ${formatDebugNumber(rect.h)}`;
  if (node === selectedDebugNode) updateDebugHud();
}

function attachDebugNode(node) {
  if (!node?.classList?.contains("screen-text")) return;
  if (node.dataset.debugAttached === "1") return;
  node.dataset.debugAttached = "1";
  node.title = "UI Debug: 点击选中；方向键移动；Shift+方向键调整尺寸。";
  node.addEventListener("click", (event) => {
    if (!UI_DEBUG_ENABLED) return;
    event.preventDefault();
    event.stopPropagation();
    selectDebugNode(node);
  });
}

function selectDebugNode(node) {
  if (selectedDebugNode && selectedDebugNode !== node) {
    selectedDebugNode.classList.remove("debug-selected");
  }
  selectedDebugNode = node;
  if (selectedDebugNode) {
    selectedDebugNode.classList.add("debug-selected");
  }
  updateDebugHud();
}

function createDebugHud(frame) {
  if (!UI_DEBUG_ENABLED) return;
  const hud = document.createElement("div");
  hud.className = "debug-ui-hud";
  hud.innerHTML = `
    <div class="debug-ui-title">UI Debug</div>
    <div class="debug-ui-body">点击任意文本框开始调试。</div>
    <div class="debug-ui-help">方向键: 移动 | Shift+方向键: 改尺寸 | Ctrl: 10px | Alt: 0.5px | C: 复制 | Esc: 取消</div>
  `;
  frame.appendChild(hud);
  debugHudNode = hud;
  updateDebugHud();
}

function updateDebugHud(message = "") {
  if (!UI_DEBUG_ENABLED || !debugHudNode) return;
  const body = debugHudNode.querySelector(".debug-ui-body");
  const help = debugHudNode.querySelector(".debug-ui-help");
  if (!selectedDebugNode) {
    body.textContent = message || "点击任意文本框开始调试。";
    help.textContent = "方向键: 移动 | Shift+方向键: 改尺寸 | Ctrl: 10px | Alt: 0.5px | C: 复制 | Esc: 取消";
    return;
  }

  const rect = getDebugRect(selectedDebugNode);
  const preview = String(selectedDebugNode.textContent || "").replace(/\s+/g, " ").slice(0, 36);
  body.textContent = `${debugRectText(rect)}\nclass="${selectedDebugNode.className}"\ntext="${preview}"${message ? `\n${message}` : ""}`;
  help.textContent = `回填: ${selectedDebugNode.dataset.debugXywh}`;
}

async function copySelectedDebugRect() {
  if (!selectedDebugNode) return;
  const rect = getDebugRect(selectedDebugNode);
  const text = `${formatDebugNumber(rect.x)}, ${formatDebugNumber(rect.y)}, ${formatDebugNumber(rect.w)}, ${formatDebugNumber(rect.h)}, ${formatDebugNumber(rect.z)}`;
  try {
    await navigator.clipboard.writeText(text);
    updateDebugHud(`已复制: ${text}`);
  } catch {
    updateDebugHud(`复制失败，请手动记录: ${text}`);
  }
}

function handleDebugKeyDown(event) {
  if (!UI_DEBUG_ENABLED || !selectedDebugNode) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;

  if (event.key === "Escape") {
    selectedDebugNode.classList.remove("debug-selected");
    selectedDebugNode = null;
    updateDebugHud();
    return;
  }

  if (event.key.toLowerCase() === "c") {
    event.preventDefault();
    void copySelectedDebugRect();
    return;
  }

  const arrows = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
  if (!arrows.has(event.key)) return;
  event.preventDefault();

  const step = event.altKey ? 0.5 : event.ctrlKey || event.metaKey ? 10 : 1;
  const rect = getDebugRect(selectedDebugNode);

  if (event.shiftKey) {
    if (event.key === "ArrowLeft") rect.w = Math.max(1, rect.w - step);
    if (event.key === "ArrowRight") rect.w += step;
    if (event.key === "ArrowUp") rect.h = Math.max(1, rect.h - step);
    if (event.key === "ArrowDown") rect.h += step;
  } else {
    if (event.key === "ArrowLeft") rect.x -= step;
    if (event.key === "ArrowRight") rect.x += step;
    if (event.key === "ArrowUp") rect.y -= step;
    if (event.key === "ArrowDown") rect.y += step;
  }

  setRect(selectedDebugNode, rect.x, rect.y, rect.w, rect.h, rect.z);
  updateDebugHud();
}

function updateScreenScale() {
  const frame = el.screenLayer.querySelector(".screen-frame");
  if (!frame) return;
  const designHeight = Number(frame.dataset.designHeight || DESIGN_HEIGHT);
  const scaleGetter = frame.dataset.scaleMode === "cover" ? Math.max : Math.min;
  const scale = scaleGetter(window.innerWidth / DESIGN_WIDTH, window.innerHeight / designHeight);
  frame.style.transform = `scale(${scale})`;
}

function updateLoadingScale() {
  if (!el.loadingFrame) return;
  const scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
  el.loadingFrame.style.transform = `scale(${scale})`;
}

function createScreenFrame(designHeight = DESIGN_HEIGHT, scaleMode = "contain") {
  el.screenLayer.innerHTML = "";
  selectedDebugNode = null;
  debugHudNode = null;
  const frame = document.createElement("div");
  frame.className = `screen-frame${UI_DEBUG_ENABLED ? " debug-ui-frame" : ""}`;
  frame.dataset.designHeight = String(designHeight);
  frame.dataset.scaleMode = scaleMode;
  frame.style.height = `${designHeight}px`;
  el.screenLayer.appendChild(frame);
  createDebugHud(frame);
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

function addVideoAsset(frame, src, x, y, w, h, z, className = "") {
  const video = document.createElement("video");
  video.className = `screen-video ${className}`.trim();
  video.src = src;
  video.autoplay = true;
  video.loop = true;
  video.playsInline = true;
  setRect(video, x, y, w, h, z);
  frame.appendChild(video);
  void video.play().catch((error) => {
    console.warn("[screen-video] autoplay blocked or failed", error);
  });
  return video;
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
  addAsset(frame, "./image_UI/动画遮罩.png", 0, 0, 1920, 1080, 1);
  addAsset(frame, "./image_UI/动画背景.png", 828, 368, 264, 268, 2);
  addScreenText(frame, "故事正在生成中...", 889, 636, 142, 26, 3, "white center");
  addVideoAsset(frame, "./image_UI/加载动画.mp4", 854, 389, 212, 224, 4);
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
  if (!player) return "人物小传：\n生成中...";
  return `人物小传：\n${player.bio || "背景生成中..."}`;
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
    775,
    739,
    405,
    24,
    7,
    "match-survival center auto-height"
  );
}

async function startParallelCharacterGeneration() {
  const batchId = matchSession.batchId + 1;
  matchSession = {
    batchId,
    cohort: null,
    roleSeeds: [],
    players: [null, null, null, null],
    statuses: ["generating", "generating", "generating", "generating"],
    errors: [null, null, null, null],
  };
  renderStartLoadingScreen();

  const apiOn = runtimeStatus.mode === "online";

  try {
    const cohortResult = await generateCharacterCohort(apiOn);
    if (matchSession.batchId !== batchId) return;

    matchSession.cohort = cohortResult.cohort;
    matchSession.roleSeeds = cohortResult.roles;
    renderMatchScreen();
  } catch (error) {
    if (matchSession.batchId !== batchId) return;
    console.warn("[match] cohort generation fallback failed", error);
    matchSession.statuses = ["error", "error", "error", "error"];
    matchSession.errors = [error, error, error, error];
    renderMatchScreen();
    return;
  }

  matchSession.roleSeeds.forEach((seed, idx) => {
    void generateInitialCharacter(
      {
        slot: idx + 1,
        seed,
        cohort: matchSession.cohort,
        allSeeds: matchSession.roleSeeds,
      },
      apiOn
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
  state.initialSnapshot = buildInitialEndingSnapshot();
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

function snapshotPlayerForEnding(player) {
  return {
    id: player.id,
    name: player.name,
    gender: player.gender,
    age: player.age,
    job: player.job,
    bio: player.bio,
    survivalTask: player.survivalTask,
    stats: {
      health: player.stats.health,
      reputation: player.stats.reputation,
      wealth: player.stats.wealth,
      rightsLevel: player.stats.rightsLevel,
      riskLevel: player.stats.riskLevel,
    },
    survivalProgress: player.survivalProgress,
  };
}

function buildInitialEndingSnapshot() {
  return {
    round: state.round,
    maleRights: state.maleRights,
    femaleRights: state.femaleRights,
    socialGap: state.socialGap,
    players: state.players.map(snapshotPlayerForEnding),
  };
}

function getInitialPlayerSnapshot(playerId) {
  return state.initialSnapshot?.players?.find((p) => p.id === playerId) || null;
}

function canEnterOpportunity(player) {
  return (
    Boolean(player?.alive) &&
    state.round >= OPPORTUNITY_UNLOCK_ROUND &&
    !player.opportunityUsed &&
    ensureActionPoints(player) >= OPPORTUNITY_ACTION_COST
  );
}

function getOtherPlayers(player = getLocalPlayer()) {
  return state.players.filter((p) => p.id !== player.id && p.alive);
}

function getSelectedPvpTarget(player = getLocalPlayer()) {
  const others = getOtherPlayers(player);
  if (others.length === 0) return null;
  let target = others.find((p) => p.id === syncSession.selectedPvpTargetId);
  if (!target) {
    target = others[0];
    syncSession.selectedPvpTargetId = target.id;
  }
  return target;
}

function survivalStatusLabel(player) {
  const value = Number(player?.survivalProgress || 0);
  if (value < 10) return "危及";
  if (value <= 50) return "良好";
  return "优秀";
}

function playerActionPoints(player) {
  return ensureActionPoints(player);
}

function areAllActionPointsUsed() {
  return state.players.every((player) => playerActionPoints(player) <= 0);
}

function areAllPlayersDead() {
  return state.players.every((player) => !player.alive || Number(player.survivalProgress || 0) <= 0);
}

function isEndingUnlocked() {
  return areAllActionPointsUsed() || areAllPlayersDead() || state.round > state.maxRound;
}

function isSocialSuccessEnding() {
  const aliveCount = state.players.filter((player) => player.alive && Number(player.survivalProgress || 0) > 0).length;
  const total = state.players.length || 1;
  const rightsGap = Math.abs(Number(state.maleRights || 0) - Number(state.femaleRights || 0));
  return aliveCount > total / 2 && rightsGap < 5;
}

function sceneIsAvailable(scene, subScene = null) {
  const player = getLocalPlayer();
  if (isEndingUnlocked()) return false;
  if (!player?.alive || ensureActionPoints(player) <= 0) return false;
  if (syncSession.roundPhase !== "acting" || syncSession.overlay) return false;
  if (state.stage === "primary") {
    if (["workplace", "family"].includes(scene)) return true;
    if (scene === "opportunity") return canEnterOpportunity(player);
    return false;
  }
  if (state.stage === "culture") {
    if (scene !== "culture") return false;
    if (subScene === "counseling") return canOpenCounseling(player);
    return ["library", "square"].includes(subScene);
  }
  return false;
}

function canOpenCourtFromGame() {
  if (isEndingUnlocked()) return false;
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
  const list = document.createElement("div");
  list.className = "game-journal-list";
  setRect(list, 1630, 106, 270, 874, 4);

  const entries = syncSession.journalEntries.slice().reverse();
  if (entries.length === 0) {
    const box = document.createElement("div");
    box.className = "game-journal-entry";
    box.textContent = "暂无经历记录";
    list.appendChild(box);
  } else {
    entries.forEach((entry) => {
      const box = document.createElement("div");
      box.className = "game-journal-entry";
      box.textContent = `${entry.playerLabel}-${entry.playerName}\n${entry.title}\n${entry.summary}`;
      list.appendChild(box);
    });
  }

  frame.appendChild(list);
}

function itemNameByType(type) {
  if (type === "swap") return "转运卡";
  if (type === "support") return "社会支援卡";
  return "未知道具";
}

function normalizeItems(player) {
  if (!player) return [];
  player.items = Array.isArray(player.items) ? player.items.filter((item) => ITEM_TYPES.includes(item?.type)) : [];
  return player.items;
}

function itemCount(player, type) {
  return normalizeItems(player).filter((item) => item.type === type).length;
}

function courtVoteOption(session, vote) {
  if (!session?.eventData?.options?.length) return null;
  if (vote === "support") return session.eventData.options.find((option) => option.id === "support") || session.eventData.options[0];
  if (vote === "oppose") return session.eventData.options.find((option) => option.id === "oppose") || session.eventData.options[1];
  return session.eventData.options.find((option) => option.id === "abstain") || session.eventData.options[2] || null;
}

function hasItem(player, type) {
  return itemCount(player, type) > 0;
}

function wasItemUsedThisRound(player, type) {
  return Number(player?.itemUseRoundByType?.[type] || 0) === state.round;
}

function markItemUsedThisRound(player, type) {
  player.itemUseRoundByType = player.itemUseRoundByType || {};
  player.itemUseRoundByType[type] = state.round;
}

function consumeItem(player, type) {
  const items = normalizeItems(player);
  const index = items.findIndex((item) => item.type === type);
  if (index < 0) return null;
  const [item] = items.splice(index, 1);
  return item;
}

function grantRandomItem(player, source = "机遇场") {
  const items = normalizeItems(player);
  if (items.length >= MAX_ITEM_COUNT) {
    addFeed({ player, tag: "🎁", summary: `${player.name}获得道具机会，但背包已满。` });
    return null;
  }

  const type = randomFrom(ITEM_TYPES);
  const item = {
    id: `item_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    type,
    name: itemNameByType(type),
    obtainedRound: state.round,
  };
  items.push(item);
  addFeed({ player, tag: "🎁", summary: `${player.name}通过${source}获得${item.name}。` });
  return item;
}

function grantCourtHighVoteItems(source = "法庭高票通过") {
  return state.players.map((player) => ({
    player,
    item: grantRandomItem(player, source),
  }));
}

function renderInventory(frame, player) {
  normalizeItems(player);

  if (hasItem(player, "swap")) {
    addImageButton(frame, "./image_UI/奖券图片-4.png", 93, 798, 71, 38, 3, () =>
      showNoticeOverlay("转运卡：在下方PVP面板选择对象后，点击“转运”即可强制交换双方权利指数与风险等级2轮。")
    );
    addScreenText(frame, "转运卡", 101, 861, 60, 17, 4, "mini center");
  }

  if (hasItem(player, "support")) {
    addImageButton(frame, "./image_UI/奖券图片-4.png", 237, 798, 71, 38, 3, () =>
      showNoticeOverlay("社会支援卡：满足低健康/低存活且财富为负时，可在PVP面板向其他玩家申请经济援助。")
    );
    addScreenText(frame, "社会支援卡", 234, 861, 86, 17, 4, "mini center");
  }
}

function relationLabel(player, target) {
  return player?.marriedTo === target?.id ? "伴侣关系" : "无关系";
}

function canRequestMarriage(initiator, target) {
  return Boolean(
    initiator &&
      target &&
      initiator.alive &&
      target.alive &&
      initiator.gender !== target.gender &&
      !initiator.marriedTo &&
      !target.marriedTo
  );
}

function openPvpPanelMode(mode, target) {
  if (!target) return;
  if (mode === "relationship" && !canRequestMarriage(getLocalPlayer(), target)) return;
  syncSession.selectedPvpTargetId = target.id;
  syncSession.pvpPanelMode = mode;
  renderGameScreen();
}

function renderPvpPanel(frame, player) {
  const others = getOtherPlayers(player);
  if (others.length === 0) return;

  const target = getSelectedPvpTarget(player);
  addAsset(frame, "./image_UI/PVP常驻UI背景4.png", 63, 895, 422, 182, 3);

  const tabXs = [64, 172, 284];
  others.slice(0, 3).forEach((other, idx) => {
    const x = tabXs[idx];
    if (other.id === target?.id) {
      addAsset(frame, "./image_UI/滑块4.png", x, 895, 102, 28, 4);
    }
    addScreenText(frame, `${state.players.findIndex((p) => p.id === other.id) + 1}号梦者`, x + 22, 902, 62, 18, 5, "mini center");
    addHotspot(frame, x, 895, 102, 28, 6, () => {
      syncSession.selectedPvpTargetId = other.id;
      syncSession.pvpPanelMode = null;
      renderGameScreen();
    });
  });

  if (!target) return;

  addScreenText(
    frame,
    `姓名：${target.name}\n年龄：${target.age}\n职业：${target.job}\n当前生存目标：${target.survivalTask || "暂无"}`,
    88,
    946,
    207,
    104,
    4,
    "pvp-info"
  );
  addScreenText(frame, `关系状态：${relationLabel(player, target)}`, 325, 954, 130, 24, 4, "mini");
  addScreenText(frame, `生存状态：${survivalStatusLabel(target)}`, 325, 995, 130, 24, 4, "mini");

  const marriageAvailable = canRequestMarriage(player, target);
  addScreenText(frame, "申请关系", 325, 1037, 58, 24, 4, `mini${marriageAvailable ? "" : " disabled"}`);
  addHotspot(frame, 318, 1027, 72, 34, 6, () => openPvpPanelMode("relationship", target), !marriageAvailable);
  addScreenText(frame, "请求援助", 400, 1037, 58, 24, 4, "mini");
  addHotspot(frame, 403, 1027, 72, 34, 6, () => openPvpPanelMode("support", target));

  if (player.marriedTo === target.id) {
    addImageButton(frame, "./image_UI/解除关系4-9.png", 88, 1068, 67, 20, 7, () => openPvpPanelMode("divorce", target));
  }

  if (hasItem(player, "swap")) {
    addImageButton(frame, "./image_UI/转运4-10.png", 405, 900, 67, 20, 8, () => useFortuneCardOnTarget(player, target));
  }

  renderPvpPanelDialog(frame, player, target);
}

function renderPvpPanelDialog(frame, player, target) {
  const mode = syncSession.pvpPanelMode;
  if (!mode || !target) return;

  const mask =
    mode === "support"
      ? "./image_UI/申请关系遮罩4-8.png"
      : mode === "divorce"
      ? "./image_UI/申请关系遮罩4-9.png"
      : "./image_UI/申请关系遮罩4-7.png";
  const confirmBg =
    mode === "support"
      ? "./image_UI/确认背景4-8.png"
      : mode === "divorce"
      ? "./image_UI/确认背景4-9.png"
      : "./image_UI/确认背景4-7.png";
  addAsset(frame, mask, 63, 895, 422, 182, 5);
  addAsset(frame, confirmBg, 190, 1007, 171, 32, 6);

  if (mode === "support") {
    addScreenText(
      frame,
      "仅限财富值为负数时可发起申请\n不论对方是否同意提供援助，您都将降低5点社会声誉值",
      72,
      900,
      205,
      40,
      7,
      "pvp-dialog-note white"
    );
  }

  const message =
    mode === "support"
      ? `是否向${target.name}申请经济援助？\n对方同意后您的财富值及身心健康值将产生变化`
      : mode === "divorce"
      ? `是否向${target.name}提出离婚申请？\n关系取消成功后将对您的家庭、职场版块以及社会声誉数值产生影响`
      : `是否向${target.name}提出结婚申请？\n关系建立成功后将对您的家庭职场版块产生影响`;
  addScreenText(frame, message, 142, 949, 278, 49, 7, "pvp-dialog center white");

  addScreenText(frame, "是", 225, 1014, 20, 20, 8, "mini center");
  addHotspot(frame, 214, 1004, 45, 34, 9, () => confirmPvpPanelAction(mode, player, target));
  addScreenText(frame, "否", 315, 1014, 20, 20, 8, "mini center");
  addHotspot(frame, 304, 1004, 45, 34, 9, () => {
    syncSession.pvpPanelMode = null;
    renderGameScreen();
  });
}

function renderPvpRequestDot(frame) {
  const request = getPendingInboundPvpRequest();
  if (!request) return;
  addImageButton(frame, "./image_UI/收到pvp请求4.png", 202, 163, 18, 18, 7, () => {
    syncSession.overlay = { type: "pvpRequest", requestId: request.id };
    renderGameScreen();
  });
}

function renderGameScreen() {
  syncSession.screen = "game";
  setGameVisible(false);
  const frame = createScreenFrame(DESIGN_GAME_HEIGHT);
  const player = getLocalPlayer();
  ensureActionPoints(player);
  activatePlayerDeathOverlayIfNeeded(player);
  const endingReady = isEndingUnlocked();

  addAsset(frame, "./image_UI/背景4.png", 0, 0, 1920, 1080, 0);
  addAsset(frame, player.gender === "female" ? "./image_UI/女头像.png" : "./image_UI/男头像.png", 90, 163, 110, 110, 3);
  addAsset(frame, "./image_UI/行动点背景4.png", 1193, 118, 292, 46, 1);
  addAsset(frame, "./image_UI/经历手账背景图4.png", 1578, -30, 342, 1188, 1);
  addAsset(frame, "./image_UI/人物信息背景4.png", 63, 127, 422, 594, 1);
  addAsset(frame, "./image_UI/当前生存目标背景框4.png", 86, 638, 362, 68, 2);
  addImageButton(frame, "./image_UI/法庭4.png", 928, 475, 243, 243, 2, () => openCourtAlert("emergency"), !canOpenCourtFromGame());
  addAsset(frame, "./image_UI/背包背景框4.png", 63, 733, 422, 158, 2);
  addAsset(frame, "./image_UI/背包框4.png", 232, 776, 82, 82, 3);
  addAsset(frame, "./image_UI/背包框4.png", 87, 776, 82, 82, 3);
  renderInventory(frame, player);

  addAsset(frame, "./image_UI/文化广场底图4.png", 618, 702, 300, 300, 1);
  addImageButton(frame, "./image_UI/职场按键4.png", 603, 175, 330, 330, 3, () => openSceneFromGame("workplace"), !sceneIsAvailable("workplace"));
  addImageButton(frame, "./image_UI/家庭按键4.png", 1180, 190, 300, 300, 3, () => openSceneFromGame("family"), !sceneIsAvailable("family"));
  addImageButton(
    frame,
    "./image_UI/机遇场按键4.png",
    1180,
    702,
    300,
    300,
    3,
    openOpportunityFromGame,
    !sceneIsAvailable("opportunity")
  );
  addImageButton(frame, "./image_UI/图书馆按键4.png", 784, 811, 115, 58, 3, () => openSceneFromGame("culture", "library"), !sceneIsAvailable("culture", "library"));
  addImageButton(frame, "./image_UI/咨询室按键4.png", 640, 721, 115, 58, 3, () => openSceneFromGame("culture", "counseling"), !sceneIsAvailable("culture", "counseling"));
  addImageButton(frame, "./image_UI/广场按键4.png", 712, 911, 109, 58, 3, () => openSceneFromGame("culture", "square"), !sceneIsAvailable("culture", "square"));
  addImageButton(
    frame,
    endingReady ? "./image_UI/解锁结局4.png" : "./image_UI/进入下一轮4.png",
    1318,
    1040,
    162.5,
    32,
    4,
    endingReady ? unlockEndingFromGame : submitNextRoundFromGame,
    syncSession.roundPhase !== "acting" || (!endingReady && state.stage !== "ready")
  );
  //if (endingReady) {addScreenText(frame, "解锁结局", 1328, 1032, 145, 24, 5, "mini center");}

  addRightsProgressBars(frame);
  addScreenText(frame, "女性社会权益值", 95, 51, 178, 40, 4, "center large");
  addScreenText(frame, displayNum(state.femaleRights), 577, 51, 178, 40, 4, "center large");
  addScreenText(frame, displayNum(state.maleRights), 813, 51, 178, 40, 4, "center large");
  addScreenText(frame, "男性社会权益值", 1309, 51, 178, 40, 4, "center large");
  addScreenText(frame, `当前行动点余额：${displayNum(player.actionPoints)}`, 1236.5, 132, 218, 33, 4, "small center");

  addScreenText(frame, player.name, 220, 160, 140, 29, 4, "large");
  addScreenText(frame, `${player.age}岁\n${player.job}\n${marriageStatus(player)}`, 220, 202, 180, 60, 4, "small");
  addScreenText(frame, `角色小传：\n\n${player.bio || "暂无小传"}`, 90, 289, 364, 135, 4, "small auto-height");

  addProgressBar(frame, 86, 479, 368, 16, 3, player.stats.health, 0, 100);
  addSignedProgressBar(frame, 86, 527, 368, 16, 3, player.stats.reputation);
  addScreenText(frame, "身心健康值", 87, 449, 90, 17, 4, "mini");
  addScreenText(frame, `${displayNum(player.stats.health)}/100`, 395, 449, 60, 17, 4, "mini right");
  addScreenText(frame, "社会声誉值", 87, 504, 90, 17, 4, "mini");
  addScreenText(frame, `${displayNum(player.stats.reputation)}/100`, 395, 501, 60, 17, 4, "mini right");
  addScreenText(frame, "财富值", 87, 556, 60, 17, 4, "mini");
  addScreenText(frame, `￥${displayNum(player.stats.wealth)}万`, 395, 556, 60, 17, 4, "mini right");
  addScreenText(frame, "权利指数", 87, 579, 70, 17, 4, "mini");
  addScreenText(frame, displayLevel(player.stats.rightsLevel), 426, 579, 28, 17, 4, "mini right");
  addScreenText(frame, "风险等级", 87, 605, 70, 17, 4, "mini");
  addScreenText(frame, displayLevel(player.stats.riskLevel), 426, 605, 28, 17, 4, "mini right");
  addScreenText(frame, `当前生存目标\n${player.survivalTask || "暂无目标"}`, 99, 645, 335, 48, 4, "small auto-height");
  addScreenText(frame, "背包", 87, 739, 60, 28, 4, "small");

  addScreenText(frame, "注意：每轮必须在广场或图书馆中消耗一次行动点", 618.5, 1010, 308, 24, 4, "mini");
  addScreenText(frame, "注意：第6轮开启", 1267, 1010, 180, 24, 4, "mini");
  addScreenText(frame, "生存状态告急、每5轮强制开启一次", 883, 723, 320, 24, 4, "mini center");
  addJournalEntries(frame);
  renderPvpPanel(frame, player);
  renderPvpRequestDot(frame);

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

  if (overlay.type === "opportunityUnlock") {
    renderOpportunityUnlockOverlay(frame);
    return;
  }

  if (overlay.type === "itemReward") {
    renderItemRewardOverlay(frame, overlay);
    return;
  }

  if (overlay.type === "pvpRequest") {
    renderPvpRequestOverlay(frame, overlay);
    return;
  }

  if (overlay.type === "event") {
    renderEventChoiceOverlay(frame, overlay);
    return;
  }

  if (overlay.type === "opportunity") {
    renderOpportunityOverlay(frame, overlay);
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
    return;
  }

  if (overlay.type === "playerDeath") {
    renderPlayerDeathOverlay(frame);
  }
}

function showNoticeOverlay(message) {
  syncSession.overlay = { type: "notice", message };
  renderGameScreen();
}

function isLocalPlayerDead(player = getLocalPlayer()) {
  return Boolean(player && (!player.alive || Number(player.survivalProgress || 0) <= 0 || Number(player.stats?.health || 0) <= 0));
}

function activatePlayerDeathOverlayIfNeeded(player = getLocalPlayer()) {
  if (syncSession.screen === "ending" || syncSession.deathEndingTriggered) return false;
  if (syncSession.overlay && syncSession.overlay.type !== "playerDeath") return false;
  if (!isLocalPlayerDead(player)) return false;
  syncSession.overlay = { type: "playerDeath" };
  return true;
}

function renderPlayerDeathOverlay(frame) {
  addAsset(frame, "./image_UI/玩家死亡遮罩.png", 5, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/玩家死亡提示信息.png", 523, 409, 879, 339, 21);
  addImageButton(frame, "./image_UI/解锁结局.png", 849, 638, 227, 57, 22, unlockDeathEndingFromGame);
}

function queueOpportunityUnlockIfNeeded() {
  if (state.round !== OPPORTUNITY_UNLOCK_ROUND || syncSession.opportunityNoticeShown) return false;
  syncSession.opportunityNoticeShown = true;
  syncSession.overlay = { type: "opportunityUnlock" };
  renderGameScreen();
  return true;
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

function addScrollableScreenText(frame, text, x, y, w, h, z, className = "") {
  const box = addScreenText(frame, text, x, y, w, h, z, className);
  box.classList.remove("auto-height");
  box.classList.add("scrollable");
  box.style.pointerEvents = "auto";
  box.style.height = "auto";
  box.style.maxHeight = `${h}px`;
  box.style.overflowY = "auto";
  box.style.overflowX = "hidden";
  box.style.paddingRight = "18px";
  return box;
}

function fitScrollableTextBox(box, maxHeight, minHeight = 0) {
  const naturalHeight = Math.ceil(box.scrollHeight || 0);
  const resolvedHeight = Math.max(minHeight, Math.min(maxHeight, naturalHeight || minHeight));
  const overflows = naturalHeight > maxHeight;
  box.style.minHeight = minHeight ? `${minHeight}px` : "";
  box.style.height = overflows ? `${maxHeight}px` : "auto";
  box.style.overflowY = overflows ? "auto" : "hidden";

  if (UI_DEBUG_ENABLED) {
    const rect = getDebugRect(box);
    updateDebugRect(box, rect.x, rect.y, rect.w, resolvedHeight, rect.z);
  }

  return resolvedHeight;
}

function renderPersonalEndingScreen() {
  syncSession.screen = "ending";
  syncSession.ending = syncSession.ending || {};
  syncSession.ending.step = "personal";
  setGameVisible(false);
  const frame = createScreenFrame();
  addAsset(frame, "./image_UI/结局背景5-1.png", 0, 0, 1920, 1080, 0);
  addAsset(frame, "./image_UI/个人结局文案背景框5-1.png", 245, 83, 1431, 915, 1);
  addScrollableScreenText(frame, syncSession.ending.personalText || "个人结局生成中。", 667, 291, 881, 416, 2, "ending-text");
  addImageButton(frame, "./image_UI/继续查看5-1.png", 921, 833, 291, 91, 3, renderSocialEndingScreen);
}

function renderSocialEndingScreen() {
  syncSession.screen = "ending";
  syncSession.ending = syncSession.ending || {};
  syncSession.ending.step = "social";
  setGameVisible(false);
  const frame = createScreenFrame();
  addAsset(frame, "./image_UI/结局背景5-2.png", 0, 0, 1920, 1080, 0);
  addAsset(frame, "./image_UI/社会结局文案背景框5-2.png", 245, 83, 1431, 915, 1);
  addScrollableScreenText(frame, syncSession.ending.socialText || "社会结局生成中。", 667, 291, 881, 416, 2, "ending-text");
  addImageButton(frame, "./image_UI/进入轮回5-2.png", 921, 833, 291, 91, 3, returnToStartFromEnding);
}

function returnToStartFromEnding() {
  matchSession = createEmptyMatchSession();
  syncSession = createSyncSession();
  mandatoryCourtSession = null;
  courtSessionLoading = false;
  state = createInitialStateFromPlayers(null);
  renderStartScreen();
}

function renderOpportunityUnlockOverlay(frame) {
  addAsset(frame, "./image_UI/背景模糊遮罩4-5.png", 5, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/机遇场4-5.png", 748, 323, 424, 424, 21);
  addAsset(frame, "./image_UI/感叹号4-5.png", 1204, 123, 294, 333.63, 22);
  addImageButton(frame, "./image_UI/确定4-5.png", 778, 834, 365, 57, 23, () => {
    syncSession.overlay = null;
    renderGameScreen();
  });
}

function renderItemRewardOverlay(frame, overlay) {
  const item = overlay.item;
  addAsset(frame, "./image_UI/背景模糊遮罩4-6.png", 5, 0, 1915, 1158, 20);
  addAsset(
    frame,
    item?.type === "support" ? "./image_UI/社会支援卡4-6.png" : "./image_UI/转运卡4-6.png",
    410,
    247,
    1099,
    638,
    21
  );
  addImageButton(frame, "./image_UI/确定4-6.png", 893, 772, 161, 57, 23, () => {
    syncSession.overlay = overlay.nextOverlay || null;
    renderGameScreen();
  });
}

function renderPvpRequestOverlay(frame, overlay) {
  const request = syncSession.pvpRequests.find((item) => item.id === overlay.requestId);
  if (!request || request.status !== "pending") {
    syncSession.overlay = null;
    return;
  }

  const initiator = state.players.find((p) => p.id === request.initiatorId);
  const actionText =
    request.action === "support" ? "经济援助申请" : request.action === "divorce" ? "离婚申请" : "结婚申请";
  const question = request.action === "support" ? "是否帮助？" : "是否同意？";
  addAsset(frame, "./image_UI/背景模糊遮罩4-1.png", 5, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/背景框4-10.png", 598, 306, 729, 339, 21);
  addScreenText(
    frame,
    `${initiator?.name || "其他玩家"}向您发起${actionText}\n${question}`,
    735,
    430,
    450,
    120,
    22,
    "center large auto-height"
  );
  addScreenText(frame, "是", 733, 529, 80, 40, 22, "center large");
  addHotspot(frame, 700, 509, 160, 80, 23, () => respondToPvpRequest(request.id, true));
  addScreenText(frame, "否", 1153, 529, 80, 40, 22, "center large");
  addHotspot(frame, 1120, 509, 160, 80, 23, () => respondToPvpRequest(request.id, false));
}

function eventPopupContentLayout({ compactOptionsBottom = false } = {}) {
  const top = 350;
  const bottom = 762;
  const height = bottom - top;
  const popupHeight = 638;
  const optionsBottom = compactOptionsBottom ? bottom - Math.round(popupHeight * 0.1) : bottom;
  const minOptionsHeight = compactOptionsBottom ? 96 : 0;
  const gap = compactOptionsBottom ? Math.round(popupHeight * 0.15) : Math.round(height * 0.2);
  const storyHeight = compactOptionsBottom
    ? Math.max(64, optionsBottom - top - gap - minOptionsHeight)
    : Math.round(height * 0.4);
  const optionsTop = top + storyHeight + gap;
  return {
    x: 485,
    width: 978,
    storyTop: top,
    storyHeight,
    optionsGap: gap,
    optionsBottom,
    optionsTop,
    optionsHeight: optionsBottom - optionsTop,
  };
}

function renderEventChoiceOverlay(frame, overlay) {
  const eventData = overlay.eventData;
  addAsset(frame, "./image_UI/背景模糊遮罩4-1.png", 5, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/背景框4-1.png", 410, 247, 1099, 638, 21);
  addImageButton(frame, "./image_UI/取消4-1.png", 1433, 281, 30, 30, 23, cancelEventSelection);
  addImageButton(frame, "./image_UI/确定4-1.png", 893, 782, 161, 57, 23, confirmEventSelection, !syncSession.selectedEventOptionId);

  const layout = eventPopupContentLayout({ compactOptionsBottom: true });
  addScreenText(frame, eventData.title || "事件", 485, 310, 978, 34, 22, "large center");
  const storyBox = addScrollableScreenText(
    frame,
    eventData.narrative || "",
    layout.x,
    layout.storyTop,
    layout.width,
    layout.storyHeight,
    22,
    "event-body event-popup-story"
  );
  const storyHeight = fitScrollableTextBox(storyBox, layout.storyHeight, 56);
  const optionsTop = layout.storyTop + storyHeight + layout.optionsGap;
  const optionsHeight = Math.max(72, layout.optionsBottom - optionsTop);

  const list = document.createElement("div");
  list.className = "screen-text event-options-list";
  setRect(list, layout.x, optionsTop, layout.width, optionsHeight, 22);

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

function renderOpportunityOverlay(frame, overlay) {
  const eventData = overlay.eventData;
  const success = eventData.options.find((option) => option.id === "success") || eventData.options[0];
  const failure = eventData.options.find((option) => option.id === "failure") || eventData.options[1] || eventData.options[0];

  addAsset(frame, "./image_UI/背景模糊遮罩4-1.png", 5, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/背景框4-1.png", 410, 247, 1099, 638, 21);
  addImageButton(frame, "./image_UI/取消4-1.png", 1433, 281, 30, 30, 23, cancelOpportunitySelection);
  addImageButton(frame, "./image_UI/确定4-1.png", 893, 782, 161, 57, 23, confirmOpportunitySelection);

  const layout = eventPopupContentLayout();
  addScreenText(frame, eventData.title || "人生机遇场", 485, 310, 978, 34, 22, "large center");
  addScrollableScreenText(
    frame,
    eventData.narrative || "",
    layout.x,
    layout.storyTop,
    layout.width,
    layout.storyHeight,
    22,
    "event-body event-popup-story"
  );

  const list = document.createElement("div");
  list.className = "screen-text opportunity-outcomes";
  setRect(list, layout.x, layout.optionsTop, layout.width, layout.optionsHeight, 22);
  list.innerHTML = `
    <div class="opportunity-result">
      <b>成功线</b><br>${esc(success?.description || "机遇成真。")}<br>
      <span>${esc(effectPreview(success?.effects, getLocalPlayer()))}</span>
    </div>
    <div class="opportunity-result">
      <b>失败线</b><br>${esc(failure?.description || "机遇落空。")}<br>
      <span>${esc(effectPreview(failure?.effects, getLocalPlayer()))}</span>
    </div>
  `;
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

async function openOpportunityFromGame() {
  const player = getLocalPlayer();
  if (!canEnterOpportunity(player) || syncSession.overlay) return;

  try {
    const historySummary = buildHistorySummary(state.events, player.id, state);
    const raw = await runWithLoading("AI正在生成小概率人生机遇...", () =>
      generateOpportunityEvent(
        {
          player,
          gameState: state,
          historySummary,
        },
        apiEnabled
      )
    );
    const eventData = normalizeEvent(raw, "opportunity", null, player);
    syncSession.overlay = {
      type: "opportunity",
      eventData,
    };
    renderGameScreen();
  } catch (error) {
    console.error("[openOpportunityFromGame] failed", error);
    showNoticeOverlay(`机遇场生成失败：${error instanceof Error ? error.message : "未知错误"}`);
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

function pickOpportunityOutcome(eventData, success) {
  if (!eventData?.options?.length) return null;
  const wanted = success ? "success" : "failure";
  return eventData.options.find((option) => option.id === wanted) || eventData.options[success ? 0 : 1] || eventData.options[0];
}

function confirmOpportunitySelection() {
  const overlay = syncSession.overlay;
  if (!overlay || overlay.type !== "opportunity") return;
  const player = getLocalPlayer();
  const didSucceed = Math.random() < 0.5;
  const option = pickOpportunityOutcome(overlay.eventData, didSucceed);
  if (!option) return;

  player.opportunityUsed = true;
  applyImmediateChoiceEffects(player, option.effects);
  writeEventRecord(player, overlay.eventData, option);

  let rewardItem = null;
  if (didSucceed) {
    rewardItem = grantRandomItem(player, "人生机遇场");
  }

  syncSession.overlay = rewardItem
    ? { type: "itemReward", item: rewardItem }
    : {
        type: "notice",
        message: didSucceed
          ? "机遇成功，但背包已满，无法获得新的道具。"
          : "机遇没有兑现，轻微损耗已结算。",
      };
  consumeLocalAction(OPPORTUNITY_ACTION_COST, { forceReady: true });
}

function cancelOpportunitySelection() {
  const overlay = syncSession.overlay;
  const player = getLocalPlayer();
  if (overlay?.type === "opportunity") {
    const summary = `${player.name}取消进入人生机遇场，消耗了行动投入，但保留本局唯一的机遇尝试机会。`;
    addFeed({ player, tag: "取消", summary });
    logChoice(player, "opportunity", "取消", summary);
  }
  syncSession.overlay = null;
  consumeLocalAction(OPPORTUNITY_ACTION_COST, { forceReady: true });
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
  writeEventRecord(player, overlay.eventData, option);
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

function consumeLocalAction(count = 1, { forceReady = false } = {}) {
  const player = getLocalPlayer();
  spendActionPoint(player, count);
  syncSession.actionSpentThisRound += count;

  if (forceReady || count >= OPPORTUNITY_ACTION_COST || ensureActionPoints(player) <= 0) {
    state.stage = "ready";
  } else if (state.stage === "primary") {
    state.stage = "culture";
  } else {
    state.stage = "ready";
  }

  renderGameScreen();
}

function submitNextRoundFromGame() {
  if (isEndingUnlocked()) {
    void unlockEndingFromGame();
    return;
  }
  if (state.stage !== "ready" || syncSession.roundPhase !== "acting") {
    showNoticeOverlay("请先完成本轮两个行动点的选择。");
    return;
  }
  void submitLocalTurnAndResolveRound();
}

function endingHistoryText(playerId = null, limit = 16) {
  const rows = state.events
    .filter((entry) => {
      if (!playerId) return true;
      if (entry.playerId === playerId) return true;
      return Array.isArray(entry.relatedPlayerIds) && entry.relatedPlayerIds.includes(playerId);
    })
    .slice(0, limit)
    .reverse();

  if (rows.length === 0) return "暂无可用经历记录。";
  return rows
    .map((entry) => {
      const title = entry.title && entry.title !== entry.summary ? `《${entry.title}》` : "";
      return `回合${entry.round} ${entry.playerName || "玩家"}${entry.tag || ""}${title}: ${entry.summary || entry.choiceLabel || "完成一次选择"}`;
    })
    .join("\n");
}

function statDeltaText(player, initialPlayer) {
  const initialStats = initialPlayer?.stats || {};
  const parts = [
    ["身心健康", initialStats.health, player.stats.health],
    ["社会声誉", initialStats.reputation, player.stats.reputation],
    ["财富", initialStats.wealth, player.stats.wealth],
    ["存活进度", initialPlayer?.survivalProgress, player.survivalProgress],
  ];
  return parts
    .map(([label, from, to]) => {
      const start = Number(from ?? to ?? 0);
      const end = Number(to ?? 0);
      const delta = Math.round(end - start);
      return `${label}: ${Math.round(start)} -> ${Math.round(end)} (${delta >= 0 ? "+" : ""}${delta})`;
    })
    .join("\n");
}

function socialDeltaText() {
  const initial = state.initialSnapshot || {};
  const startGap = Number(initial.socialGap ?? Math.abs(Number(initial.maleRights || 50) - Number(initial.femaleRights || 45)));
  const endGap = Math.abs(Number(state.maleRights || 0) - Number(state.femaleRights || 0));
  return [
    `男性社会权益值: ${Math.round(Number(initial.maleRights ?? 50))} -> ${Math.round(Number(state.maleRights || 0))}`,
    `女性社会权益值: ${Math.round(Number(initial.femaleRights ?? 45))} -> ${Math.round(Number(state.femaleRights || 0))}`,
    `男女社会权利差值: ${Math.round(startGap)} -> ${Math.round(endGap)}`,
    `存活玩家数量: ${state.players.filter((p) => p.alive && Number(p.survivalProgress || 0) > 0).length}/${state.players.length}`,
  ].join("\n");
}

function courtSummaryText() {
  const records = Array.isArray(state.courtRecords) ? state.courtRecords : [];
  if (records.length === 0) return "本局没有完成法庭执行宣判。";
  return records
    .map((record) => {
      const votes = record.votes || {};
      return `回合${record.round} ${record.billName || record.title || "法庭议题"} | 支持${votes.support || 0}/反对${votes.oppose || 0}/弃权${votes.abstain || 0} | 多数意见:${voteLabel(record.winner)} | ${record.summary || "无执行概要"}`;
    })
    .join("\n");
}

function playerEndingBriefs() {
  return state.players
    .map((player, idx) => {
      const initial = getInitialPlayerSnapshot(player.id);
      const status = player.alive && Number(player.survivalProgress || 0) > 0 ? "个人成功" : "个人失败";
      return `${idx + 1}号 ${player.name} | ${player.gender === "female" ? "女" : "男"} | ${player.job} | ${status} | ${statDeltaText(player, initial).replaceAll("\n", "；")}`;
    })
    .join("\n");
}

async function buildEndingData() {
  const initialSnapshot = state.initialSnapshot || buildInitialEndingSnapshot();
  const socialSucceeded = isSocialSuccessEnding();
  const personalRows = await Promise.all(
    state.players.map(async (player, idx) => {
      const initialPlayer = getInitialPlayerSnapshot(player.id);
      const succeeded = player.alive && Number(player.survivalProgress || 0) > 0;
      const result = await generatePersonalEnding(
        {
          player,
          initialPlayer,
          gameState: state,
          historyText: endingHistoryText(player.id, 12),
          statDeltaText: statDeltaText(player, initialPlayer),
          succeeded,
        },
        apiEnabled
      );
      return `【${idx + 1}号梦者 ${player.name}】\n${result.endingText}`;
    })
  );

  const socialResult = await generateSocialEnding(
    {
      gameState: state,
      initialSnapshot,
      playerBriefs: playerEndingBriefs(),
      historyText: endingHistoryText(null, 24),
      socialDeltaText: socialDeltaText(),
      courtSummaryText: courtSummaryText(),
      succeeded: socialSucceeded,
    },
    apiEnabled
  );

  return {
    step: "personal",
    personalText: personalRows.join("\n\n"),
    socialText: socialResult.endingText,
    socialSucceeded,
  };
}

async function buildEarlyDeathEndingData() {
  const player = getLocalPlayer();
  const initialPlayer = getInitialPlayerSnapshot(player.id);
  const result = await generatePersonalEnding(
    {
      player,
      initialPlayer,
      gameState: state,
      historyText: endingHistoryText(player.id, 12),
      statDeltaText: statDeltaText(player, initialPlayer),
      succeeded: false,
      earlyDeath: true,
    },
    apiEnabled
  );

  return {
    step: "personal",
    personalText: `【1号梦者 ${player.name}】\n${result.endingText}`,
    socialText: EARLY_DEATH_SOCIAL_ENDING,
    socialSucceeded: false,
    earlyDeath: true,
  };
}

async function unlockDeathEndingFromGame() {
  if (loadingDepth > 0) return;
  syncSession.deathEndingTriggered = true;
  syncSession.overlay = null;

  if (syncSession.ending?.earlyDeath && syncSession.ending?.personalText && syncSession.ending?.socialText) {
    syncSession.ending.step = "personal";
    renderPersonalEndingScreen();
    return;
  }

  try {
    syncSession.ending = await runWithLoading("AI正在撰写提前死亡结局...", buildEarlyDeathEndingData);
    renderPersonalEndingScreen();
  } catch (error) {
    console.error("[unlockDeathEndingFromGame] failed", error);
    syncSession.deathEndingTriggered = false;
    showNoticeOverlay(`死亡结局生成失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
}

async function unlockEndingFromGame() {
  if (loadingDepth > 0) return;
  if (!isEndingUnlocked()) {
    showNoticeOverlay("结局尚未解锁：需要所有玩家行动点耗尽，或所有玩家存活进度归零。");
    return;
  }

  if (syncSession.ending?.personalText && syncSession.ending?.socialText) {
    syncSession.ending.step = "personal";
    renderPersonalEndingScreen();
    return;
  }

  try {
    syncSession.ending = await runWithLoading("AI正在撰写个人结局与社会结局...", buildEndingData);
    renderPersonalEndingScreen();
  } catch (error) {
    console.error("[unlockEndingFromGame] failed", error);
    showNoticeOverlay(`结局生成失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
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
  //addScreenText(frame,overlay.kind === "forced" ? "强制开庭已开启\n所有玩家需参与投票" : "生存状态告急\n可主动开启一次法庭",735,740,450,70,23,"center large auto-height");
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
        options: eventData.options.slice(0, 3),
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
//  addScreenText(frame, session.eventData.title || "法庭议题", 485, 330, 930, 36, 22, "center large");
  const narrativeBox = addScrollableScreenText(frame, session.eventData.narrative || "", 485, 390, 930, 200, 22, "event-body");
  fitScrollableTextBox(narrativeBox, 200, 80);
  const support = courtVoteOption(session, "support");
  const oppose = courtVoteOption(session, "oppose");
  const abstain = courtVoteOption(session, "abstain");
  const guideBox = addScrollableScreenText(
    frame,
    `支持：${support?.description || support?.label || "改革方案"}\n${support?.voterProfile ? `支持者：${support.voterProfile}\n` : ""}反对：${oppose?.description || oppose?.label || "维持现状"}\n${oppose?.voterProfile ? `反对者：${oppose.voterProfile}\n` : ""}弃权：${abstain?.description || "政策悬置，不形成明确公共意志。"}${abstain?.voterProfile ? `\n弃权者：${abstain.voterProfile}` : ""}`,
    560,
    600,
    800,
    200,
    22,
    "event-body"
  );
  fitScrollableTextBox(guideBox, 200, 80);
  addImageButton(frame, "./image_UI/支持4-3.png", 573, 796, 138.5, 57, 23, () => castDesignedCourtVote("support"));
  addImageButton(frame, "./image_UI/反对4-3.png", 892, 796, 138.5, 57, 23, () => castDesignedCourtVote("oppose"));
  addImageButton(frame, "./image_UI/弃权4-3.png", 1211, 796, 138.5, 57, 23, () => castDesignedCourtVote("abstain"));
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

  void finalizeDesignedCourtVote();
}

function voteLabel(vote) {
  if (vote === "support") return "支持";
  if (vote === "oppose") return "反对";
  if (vote === "none") return "无多数";
  return "弃权";
}

async function finalizeDesignedCourtVote() {
  const session = mandatoryCourtSession;
  if (!session) return;
  const supportCount = session.votes.filter((item) => item.vote === "support").length;
  const opposeCount = session.votes.filter((item) => item.vote === "oppose").length;
  const abstainCount = session.votes.filter((item) => item.vote === "abstain").length;
  let resultText = `票型：支持${supportCount} / 反对${opposeCount} / 弃权${abstainCount}`;
  let impactText = "你受到的数值影响：无";
  let rewardItem = null;

  const voteRank = [
    ["support", supportCount],
    ["oppose", opposeCount],
    ["abstain", abstainCount],
  ].sort((a, b) => b[1] - a[1]);
  const top = voteRank[0];
  const second = voteRank[1];
  let winner = null;
  let winnerVote = null;
  if (top[1] > second[1]) {
    winnerVote = top[0];
    winner = courtVoteOption(session, winnerVote);
    resultText += `\n结果：${voteLabel(winnerVote)}方成为多数意见。`;
  } else {
    resultText += "\n结果：票型分散，本次法庭未形成明确多数。";
  }

  if (winner) {
    state.players.forEach((player) => {
      applyEffects(state, player.id, winner.effects);
    });
    impactText = `你受到的数值影响：${effectPreview(winner.effects, getLocalPlayer())}`;
    if (top[1] >= 3) {
      const rewards = grantCourtHighVoteItems("法庭高票通过");
      rewardItem = rewards.find((entry) => entry.player.id === LOCAL_PLAYER_ID)?.item || null;
      resultText += "\n高票决定奖励：所有玩家随机获得1张道具。";
    }
  } else {
    winnerVote = "none";
  }

  const votesText = `支持${supportCount}票(${Math.round((supportCount / 4) * 100)}%) / 反对${opposeCount}票(${Math.round(
    (opposeCount / 4) * 100
  )}%) / 弃权${abstainCount}票(${Math.round((abstainCount / 4) * 100)}%)`;
  let verdict = {
    title: "结果宣判",
    verdictText: `${session.eventData.narrative || ""}\n\n${resultText}\n\n${impactText}`,
    summary: winner?.summary || "法庭未形成明确制度结果。",
  };
  try {
    verdict = await runWithLoading("AI正在生成法庭结果宣判...", () =>
      generateCourtResult(
        {
          eventData: session.eventData,
          votesText,
          winnerLabel: winnerVote === "none" ? "无多数" : voteLabel(winnerVote),
          winnerSummary: winner?.summary || "",
          resultText,
          impactText,
          gameState: state,
        },
        apiEnabled
      )
    );
  } catch (error) {
    console.error("[finalizeDesignedCourtVote] verdict failed", error);
  }

  state.courtRecords = Array.isArray(state.courtRecords) ? state.courtRecords : [];
  state.courtRecords.push({
    round: state.round,
    title: session.eventData.title || "法庭议题",
    billName: session.eventData.billName || session.eventData.title || "未知法案",
    votes: { support: supportCount, oppose: opposeCount, abstain: abstainCount },
    winner: winnerVote,
    summary: verdict.summary,
    verdictText: verdict.verdictText,
  });
  addFeed({
    player: getLocalPlayer(),
    tag: "⚖️",
    summary: verdict.summary || winner?.summary || "法庭完成结果宣判。",
  });

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
    message: verdict.verdictText || `${session.eventData.narrative || ""}\n\n${resultText}\n\n${impactText}`,
    rewardItem,
  };
  renderGameScreen();
}

function renderCourtResultOverlay(frame, overlay) {
  addAsset(frame, "./image_UI/背景模糊遮罩4-4.png", 5, 0, 1915, 1158, 20);
  addAsset(frame, "./image_UI/通知背景框4-4.png", 562, 327, 797, 505, 21);
  addAsset(frame, "./image_UI/结果宣判4-4.png", 880, 367, 170, 47, 22);
  addScrollableScreenText(frame, overlay.message || "法庭结果已结算。", 618, 442, 708, 245, 22, "event-body");
  addImageButton(frame, "./image_UI/确定4-4.png", 880, 749, 161, 57, 23, () => {
    syncSession.overlay = overlay.rewardItem ? { type: "itemReward", item: overlay.rewardItem } : null;
    renderGameScreen();
  });
}

function setLoading(active, message = "正在生成剧情...") {
  if (active) {
    loadingDepth += 1;
    console.log(`[ui-loading] + depth=${loadingDepth} message=${message}`);
    updateLoadingScale();
    document.body.classList.add("is-loading");
    if (el.loadingText) el.loadingText.textContent = "故事正在生成中...";
    if (el.loadingVideo) {
      el.loadingVideo.currentTime = 0;
      void el.loadingVideo.play().catch((error) => {
        console.warn("[loading-video] autoplay blocked or failed", error);
      });
    }
    return;
  }

  loadingDepth = Math.max(0, loadingDepth - 1);
  console.log(`[ui-loading] - depth=${loadingDepth}`);
  if (loadingDepth === 0) {
    document.body.classList.remove("is-loading");
    if (el.loadingVideo) {
      el.loadingVideo.pause();
    }
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
              .map((item) => `<span class="tag">${esc(item.name || itemNameByType(item.type))}</span>`)
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

  const alive = current.alive && !isEndingUnlocked();
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
      if (scene === "opportunity" && !canEnterOpportunity(current)) allowed = false;
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

function applyImmediateChoiceEffects(player, effects) {
  applyEffects(state, player.id, {
    self: effects?.self || {},
    meta: effects?.meta || {},
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
    meta: { survivalProgress: 4, tag: tagForScene("meditate") },
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
  el.modalBody.className = "modal-body";
  el.modalBody.innerHTML = "";
  bodyBuilder(el.modalBody);
  el.eventModal.classList.remove("hidden");
}

function wealthDeltaLimit(scene, subScene) {
  if (scene === "opportunity") return 45;
  if (scene === "court") return 6;
  if (scene === "culture" && subScene === "square") return 2;
  if (scene === "culture") return 1.2;
  return 1.8;
}

function sanitizeOptionEffects(option, scene, subScene, player = null) {
  const safe = option;
  safe.effects = safe.effects || {};
  safe.effects.self = safe.effects.self || {};
  safe.effects.meta = safe.effects.meta || {};

  const isNoDiscuss = safe.id === "opt_no_discuss";

  if (isNoDiscuss) {
    safe.effects.self.health = -3;
    safe.effects.self.reputation = 0;
    safe.effects.self.wealth = 0;
    safe.effects.meta.survivalProgress = -2;
  }

  if (scene === "culture" && subScene === "library" && !isNoDiscuss) {
    const h = Number(safe.effects.self.health || 0);
    const r = Number(safe.effects.self.reputation || 0);
    const w = Number(safe.effects.self.wealth || 0);

    safe.effects.self.health = h > 0 ? h : 3;
    safe.effects.self.reputation = r >= 0 ? r : 1;
    safe.effects.self.wealth = w <= 0 ? w : -1;

    const survival = Number(safe.effects.meta.survivalProgress || 0);
    safe.effects.meta.survivalProgress = survival > 0 ? survival : 2;
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

    const survival = Number(safe.effects.meta.survivalProgress || 0);
    safe.effects.meta.survivalProgress = survival > 0 ? survival : 2;
  }

  if (scene === "opportunity") {
    if (safe.id === "success") {
      safe.effects.self.health = Math.max(10, Number(safe.effects.self.health || 0));
      safe.effects.self.reputation = Math.max(8, Number(safe.effects.self.reputation || 0));
      safe.effects.self.wealth = Math.max(8, Number(safe.effects.self.wealth || 0));
    }

    if (safe.id === "failure") {
      safe.effects.self.health = Math.min(-1, Number(safe.effects.self.health || -3));
      safe.effects.self.reputation = Math.min(0, Number(safe.effects.self.reputation || -1));
      safe.effects.self.wealth = Math.min(0, Number(safe.effects.self.wealth || -1));
    }
  }

  const wealthCap = wealthDeltaLimit(scene, subScene);
  const healthGainCap = scene === "opportunity" ? 35 : 20;
  const reputationCap = scene === "opportunity" ? 40 : 30;
  safe.effects.self.wealth = withOneDecimal(clampNum(safe.effects.self.wealth, -wealthCap, wealthCap));
  safe.effects.self.health = Math.round(clampNum(safe.effects.self.health, -35, healthGainCap));
  safe.effects.self.reputation = Math.round(clampNum(safe.effects.self.reputation, -30, reputationCap));

  delete safe.effects.global;

  safe.effects.meta = {
    survivalProgress: Math.round(clampNum(safe.effects.meta.survivalProgress, -20, 20)),
    tag: tagForScene(scene, subScene),
  };

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
          meta: { survivalProgress: 0, tag: "🧩" },
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
        meta: { survivalProgress: -2, tag: "🗣️" },
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
    await openOpportunityFromGame();
    return;
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
    body.classList.add("event-choice-modal-body");

    const para = document.createElement("div");
    para.className = "modal-story";
    para.textContent = eventData.narrative;
    body.appendChild(para);

    const options = document.createElement("div");
    options.className = "modal-options";
    eventData.options.forEach((opt) => {
      const node = el.optionTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".option-title").textContent = opt.label;
      node.querySelector(".option-desc").textContent = opt.description || "";
      node.querySelector(".option-impact").textContent = effectPreview(opt.effects, player);
      node.onclick = () => handleOptionChoose(eventData, opt);
      options.appendChild(node);
    });
    body.appendChild(options);
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
          options: eventData.options.slice(0, 3),
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
      state.players.forEach((p2) => {
        applyEffects(state, p2.id, winner.effects);
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
        available: !initiator.marriedTo && others.some((p) => canRequestMarriage(initiator, p) && !p.marriedTo),
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
            ? others.filter((p) => canRequestMarriage(initiator, p) && !p.marriedTo)
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
  return "申请经济援助";
}

function getPendingInboundPvpRequest() {
  return syncSession.pvpRequests.find(
    (request) => request.targetId === LOCAL_PLAYER_ID && request.status === "pending"
  );
}

function confirmPvpPanelAction(mode, initiator, target) {
  if (!initiator || !target) return;
  const action = mode === "support" ? "support" : mode === "divorce" ? "divorce" : "marriage";
  const result = createPvpRequest(action, initiator, target);
  syncSession.pvpPanelMode = null;
  if (!result.ok) {
    showNoticeOverlay(result.message);
    return;
  }
  renderGameScreen();
}

function canUseSupportCard(player) {
  if (!hasItem(player, "support")) return { ok: false, message: "你当前没有社会支援卡。" };
  if (wasItemUsedThisRound(player, "support")) {
    return { ok: false, message: "本全局轮次已经使用过社会支援卡。" };
  }
  if (Number(player.supportUseCount || 0) >= SUPPORT_CARD_MAX_USES) {
    return { ok: false, message: "社会支援卡单局最多使用3次。" };
  }
  if (!(Number(player.stats.wealth || 0) < 0)) {
    return { ok: false, message: "仅当财富值为负数时可申请经济援助。" };
  }
  if (!(Number(player.stats.health || 0) <= 40 || Number(player.survivalProgress || 0) <= 30)) {
    return { ok: false, message: "需要身心健康值≤40或存活进度≤30，才可发起社会援助申请。" };
  }
  return { ok: true };
}

function validatePvpRequest(action, initiator, target) {
  if (!initiator?.alive || !target?.alive) return { ok: false, message: "双方必须处于存活状态。" };
  if (initiator.id === target.id) return { ok: false, message: "不能对自己发起PVP请求。" };

  if (action === "marriage") {
    if (initiator.gender === target.gender) return { ok: false, message: "结婚申请仅限不同性别角色。" };
    if (initiator.marriedTo || target.marriedTo) return { ok: false, message: "结婚申请仅限双方当前都无伴侣关系。" };
  }

  if (action === "divorce") {
    if (initiator.marriedTo !== target.id) return { ok: false, message: "只能向当前伴侣提出解除关系。" };
  }

  if (action === "support") {
    return canUseSupportCard(initiator);
  }

  return { ok: true };
}

function autoRespondToPvpRequest(request) {
  const target = state.players.find((p) => p.id === request.targetId);
  if (!target || request.targetId === LOCAL_PLAYER_ID) return;

  let acceptChance = 0.55;
  if (request.action === "support") {
    acceptChance = Number(target.stats.wealth || 0) > 0 ? 0.72 : 0.32;
  }
  if (request.action === "marriage") {
    acceptChance = target.marriedTo ? 0 : 0.62;
  }
  if (request.action === "divorce") {
    acceptChance = 0.82;
  }

  respondToPvpRequest(request.id, Math.random() < acceptChance, { silent: true });
}

function createPvpRequest(action, initiator, target) {
  const validation = validatePvpRequest(action, initiator, target);
  if (!validation.ok) return validation;

  syncSession.pvpRequestSeq += 1;
  const id = `pvp_${Date.now()}_${syncSession.pvpRequestSeq}`;
  const request = {
    id,
    round: state.round,
    responseRound: null,
    action,
    initiatorId: initiator.id,
    targetId: target.id,
    status: "pending",
  };

  if (action === "support") {
    applyDirectPlayerDelta(initiator, { reputation: -5, survivalProgress: -1 });
    consumeItem(initiator, "support");
    markItemUsedThisRound(initiator, "support");
    initiator.supportUseCount = Number(initiator.supportUseCount || 0) + 1;
  }

  syncSession.pvpRequests.push(request);
  markPlayersLinkedByPvp(state, initiator.id, target.id);

  const label = pvpActionLabel(action);
  const summary = `${initiator.name}向${target.name}${label}，等待对方回应并在下回合前结算。`;
  addFeed({ player: initiator, tag: "🤝", summary });
  logChoice(initiator, "pvp", label, summary, [initiator.id, target.id]);

  autoRespondToPvpRequest(request);
  return { ok: true, request };
}

function respondToPvpRequest(requestId, accepted, { silent = false } = {}) {
  const request = syncSession.pvpRequests.find((item) => item.id === requestId);
  if (!request || request.status !== "pending") return;
  const initiator = state.players.find((p) => p.id === request.initiatorId);
  const target = state.players.find((p) => p.id === request.targetId);
  request.status = accepted ? "accepted" : "rejected";
  request.responseRound = state.round;

  const actionText =
    request.action === "support" ? "经济援助申请" : request.action === "divorce" ? "离婚申请" : "结婚申请";
  addFeed({
    player: target || getLocalPlayer(),
    tag: accepted ? "✅" : "拒绝",
    summary: `${target?.name || "目标玩家"}${accepted ? "同意" : "拒绝"}了${initiator?.name || "发起方"}的${actionText}。`,
  });

  if (!silent) {
    syncSession.overlay = null;
    renderGameScreen();
  }
}

function applyDirectWealthDelta(player, delta) {
  if (!player || !delta) return;
  if (player.sharedWealthId && state.sharedWealthPools[player.sharedWealthId]) {
    const pool = state.sharedWealthPools[player.sharedWealthId];
    pool.wealth += delta;
    (pool.members || []).forEach((id) => {
      const member = state.players.find((p) => p.id === id);
      if (member) member.stats.wealth = pool.wealth;
    });
    return;
  }
  player.stats.wealth += delta;
}

function refreshDirectLevels(player) {
  if (!player) return;
  if (player.rightsRiskLock) {
    player.stats.rightsLevel = player.rightsRiskLock.rightsLevel;
    player.stats.riskLevel = player.rightsRiskLock.riskLevel;
    return;
  }
  Object.assign(player.stats, deriveLevelsFromReputation(player.stats.reputation));
}

function applyDirectPlayerDelta(player, delta = {}) {
  if (!player) return;
  const healthDelta = Number(delta.health || 0);
  const reputationDelta = Number(delta.reputation || 0);
  const wealthDelta = Number(delta.wealth || 0);
  player.stats.health = clampNum(player.stats.health + healthDelta, 0, 100);
  player.stats.reputation = clampNum(player.stats.reputation + reputationDelta, -100, 100);
  if (wealthDelta) applyDirectWealthDelta(player, wealthDelta);

  const survivalDelta =
    Number.isFinite(Number(delta.survivalProgress))
      ? Number(delta.survivalProgress || 0)
      : healthDelta * 0.4 + reputationDelta * 0.3 + wealthDelta * 0.2;
  player.survivalProgress = clampNum(player.survivalProgress + survivalDelta, 0, 100);
  if (player.stats.health <= 0 || player.survivalProgress <= 0) {
    player.alive = false;
    player.survivalProgress = 0;
  }
  refreshDirectLevels(player);
}

function applyEconomicAidRequest(request) {
  const initiator = state.players.find((p) => p.id === request.initiatorId);
  const target = state.players.find((p) => p.id === request.targetId);
  if (!initiator || !target) return;

  if (request.status === "accepted") {
    const amount = withOneDecimal(Math.max(0, Number(target.stats.wealth || 0) * 0.1));
    applyDirectPlayerDelta(target, { wealth: -amount, reputation: 10 });
    applyDirectPlayerDelta(initiator, { wealth: amount, health: 10, survivalProgress: 5 });
    addFeed({
      player: initiator,
      tag: "🤝",
      summary: `${target.name}提供经济援助，${initiator.name}获得${displayNum(amount)}万财富与10点身心恢复。`,
    });
    return;
  }

  if (request.status === "rejected") {
    applyDirectPlayerDelta(target, { reputation: -5, survivalProgress: -1 });
    addFeed({
      player: target,
      tag: "拒绝",
      summary: `${target.name}拒绝经济援助申请，社会声誉值下降5点。`,
    });
  }
}

function canUseFortuneCard(player, target) {
  if (!hasItem(player, "swap")) return { ok: false, message: "你当前没有转运卡。" };
  if (wasItemUsedThisRound(player, "swap")) return { ok: false, message: "本全局轮次已经使用过转运卡。" };
  if (Number(player.fortuneSwapUseCount || 0) >= FORTUNE_CARD_MAX_USES) {
    return { ok: false, message: "转运卡单局最多使用2次。" };
  }
  if (target.fortuneSwapTargeted) return { ok: false, message: "同一目标玩家单局只能被转运1次。" };
  if (player.rightsRiskLock || target.rightsRiskLock) return { ok: false, message: "当前存在未结束的转运效果。" };
  return { ok: true };
}

function useFortuneCardOnTarget(player, target) {
  const validation = canUseFortuneCard(player, target);
  if (!validation.ok) {
    showNoticeOverlay(validation.message);
    return;
  }

  const swapId = `swap_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const playerOriginal = {
    rightsLevel: player.stats.rightsLevel,
    riskLevel: player.stats.riskLevel,
  };
  const targetOriginal = {
    rightsLevel: target.stats.rightsLevel,
    riskLevel: target.stats.riskLevel,
  };

  player.rightsRiskLock = { ...targetOriginal, swapId };
  target.rightsRiskLock = { ...playerOriginal, swapId };
  refreshDirectLevels(player);
  refreshDirectLevels(target);

  state.activeFortuneSwaps = Array.isArray(state.activeFortuneSwaps) ? state.activeFortuneSwaps : [];
  state.activeFortuneSwaps.push({
    id: swapId,
    sourceId: player.id,
    targetId: target.id,
    startRound: state.round,
    sourceOriginal: playerOriginal,
    targetOriginal,
  });

  consumeItem(player, "swap");
  markItemUsedThisRound(player, "swap");
  player.fortuneSwapUseCount = Number(player.fortuneSwapUseCount || 0) + 1;
  target.fortuneSwapTargeted = true;
  addFeed({
    player,
    tag: "🎲",
    summary: `${player.name}对${target.name}使用转运卡，双方权利指数与风险等级交换2个全局轮次。`,
  });
  renderGameScreen();
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
      tag: tagForRelationshipAction(action),
      summary: `${initiator.name}与${target.name}的结婚申请因关系状态变化未能生效。`,
    });
    return false;
  }
  if (action === "divorce" && initiator.marriedTo !== target.id) {
    addFeed({
      player: initiator,
      tag: tagForRelationshipAction(action),
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
    tag: tagForRelationshipAction(action),
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
      meta: { tag: tagForScene("meditate") },
    };
  }

  if (scene === "culture" && subScene === "library") {
    return {
      self: { health: 3, reputation: 1, wealth: -1 },
      meta: { tag: tagForScene(scene, subScene) },
    };
  }

  if (scene === "culture" && subScene === "square") {
    return {
      self: { health: -4, reputation: 2, wealth: 0 },
      meta: { tag: tagForScene(scene, subScene) },
    };
  }

  const assertive = Math.random() > 0.45;
  const tag = tagForScene(scene, subScene);
  return assertive
    ? {
        self: { health: -4, reputation: 3, wealth: -1 },
        meta: { tag },
      }
    : {
        self: { health: -1, reputation: -1, wealth: 1 },
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

function maybeQueueRemotePvpRequestToLocal(player) {
  const local = getLocalPlayer();
  if (!player?.alive || !local?.alive) return;
  if (getPendingInboundPvpRequest()) return;
  if (Math.random() > 0.18) return;

  if (player.marriedTo === local.id) {
    createPvpRequest("divorce", player, local);
    return;
  }

  if (!player.marriedTo && !local.marriedTo) {
    createPvpRequest("marriage", player, local);
  }
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

  maybeQueueRemotePvpRequestToLocal(player);
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

async function resolvePendingPvpRequests(roundNumber) {
  const requests = syncSession.pvpRequests.filter(
    (entry) => entry.status !== "pending" && Number(entry.responseRound || entry.round) === roundNumber
  );

  for (const request of requests) {
    const initiator = state.players.find((p) => p.id === request.initiatorId);
    const target = state.players.find((p) => p.id === request.targetId);
    if (!initiator || !target) continue;

    if (request.action === "support") {
      applyEconomicAidRequest(request);
      continue;
    }

    if (request.status === "accepted") {
      await resolveRelationshipActionNow(request.action, initiator, target);
      continue;
    }

    addFeed({
      player: initiator,
      tag: "拒绝",
      summary: `${target.name}拒绝了${initiator.name}的${pvpActionLabel(request.action)}。`,
    });
  }

  syncSession.pvpRequests = syncSession.pvpRequests.filter(
    (entry) => entry.status === "pending" || Number(entry.responseRound || entry.round) !== roundNumber
  );
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
  state.players.forEach((p) => normalizeItems(p));
}

function expireFortuneSwaps() {
  state.activeFortuneSwaps = Array.isArray(state.activeFortuneSwaps) ? state.activeFortuneSwaps : [];
  const stillActive = [];

  state.activeFortuneSwaps.forEach((swap) => {
    if (state.round < Number(swap.startRound || 0) + 2) {
      stillActive.push(swap);
      return;
    }

    const source = state.players.find((p) => p.id === swap.sourceId);
    const target = state.players.find((p) => p.id === swap.targetId);
    if (source) {
      source.rightsRiskLock = null;
      Object.assign(source.stats, swap.sourceOriginal || deriveLevelsFromReputation(source.stats.reputation));
    }
    if (target) {
      target.rightsRiskLock = null;
      Object.assign(target.stats, swap.targetOriginal || deriveLevelsFromReputation(target.stats.reputation));
    }
    if (source && target) {
      addFeed({
        player: source,
        tag: "🎲",
        summary: `${source.name}与${target.name}的转运效果到期，权利指数与风险等级恢复。`,
      });
    }
  });

  state.activeFortuneSwaps = stillActive;
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
    await resolvePendingPvpRequests(roundNumber);
    decayIntimacyForRound(state, 2);
    tickRoundItems();
    await settleRoundEvaluation(roundNumber);

    state.round += 1;
    expireFortuneSwaps();
    state.currentPlayerIndex = 0;
    state.stage = "primary";
    syncSession.turnSubmissions = {};
    syncSession.roundPhase = "acting";
    syncSession.actionSpentThisRound = 0;
  });

  if (activatePlayerDeathOverlayIfNeeded()) {
    renderGameScreen();
    return;
  }

  if (queueOpportunityUnlockIfNeeded()) {
    return;
  }

  renderGameScreen();
  if (!isEndingUnlocked() && isCourtRoundPending()) {
    openCourtAlert("forced");
  }
}

async function settleRoundEvaluation(roundNumber) {
  const rows = consumeRoundDecisionLog(state, roundNumber);
  if (rows.length === 0) return;
  appendRoundJournal(rows, roundNumber);

  syncSession.pendingRightsEvaluationRows = Array.isArray(syncSession.pendingRightsEvaluationRows)
    ? syncSession.pendingRightsEvaluationRows
    : [];
  syncSession.pendingRightsEvaluationRows.push(...rows);

  if (roundNumber % RIGHTS_EVALUATION_INTERVAL !== 0) return;

  const evaluationRows = syncSession.pendingRightsEvaluationRows.slice();
  if (evaluationRows.length === 0) return;

  const roundChoicesText = evaluationRows
    .map((x, idx) => `${idx + 1}. 第${x.round}回合 ${x.playerName} [${x.scene}] 选择: ${x.choice}; ${x.summary}`)
    .join("\n");

  let result = null;
  try {
    result = await runWithLoading("AI正在进行近三轮社会权益结算...", () =>
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
  syncSession.pendingRightsEvaluationRows = [];

  const current = state.players[state.currentPlayerIndex];
  addFeed({
    player: current,
    tag: "📊",
    summary: `回合${roundNumber - RIGHTS_EVALUATION_INTERVAL + 1}-${roundNumber}权益评估：${
      result.summary || "完成近三轮社会权益结算"
    }`,
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
    if (UI_DEBUG_ENABLED) {
      window.addEventListener("keydown", handleDebugKeyDown);
      console.info("[ui-debug] enabled. Use ?debugUi=1 or localStorage kanjian_debug_ui=1.");
    }
    window.addEventListener("resize", () => {
      updateScreenScale();
      updateLoadingScale();
    });
    updateLoadingScale();
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
