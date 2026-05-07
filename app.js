import {
  evaluateRoundRights,
  generateInitialCharacters,
  generateCourtEvent,
  generateSceneEvent,
  resolveRelationshipAction,
} from "./llm.js";
import { buildHistorySummary } from "./prompts.js";
import {
  advanceTurn,
  applyEffects,
  applyLocalDelta,
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

function levelMultiplier(level) {
  if (level === "low") return 0.6;
  if (level === "high") return 1.5;
  return 1;
}

function applyPlayerStatMultipliersToOption(option, player) {
  if (!player || !option?.effects?.self) return option;

  const rightsFactor = levelMultiplier(player.stats?.rightsLevel);
  const riskFactor = levelMultiplier(player.stats?.riskLevel);
  const combined = rightsFactor * riskFactor;
  const self = option.effects.self;

  self.health = withOneDecimal(Number(self.health || 0) * combined);
  self.reputation = withOneDecimal(Number(self.reputation || 0) * combined);
  self.wealth = withOneDecimal(Number(self.wealth || 0) * combined);
  return option;
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

function effectPreview(effects) {
  const self = effects?.self || {};
  const global = effects?.global || {};
  const chunks = [];

  const pushNum = (label, val) => {
    if (!val) return;
    chunks.push(`${label}${val > 0 ? "+" : ""}${val}`);
  };

  pushNum("健康", self.health || 0);
  pushNum("名誉", self.reputation || 0);
  pushNum("财富", self.wealth || 0);
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
            <div class="stat">身心健康 <b class="${delta.health > 0 ? "delta-plus" : delta.health < 0 ? "delta-minus" : ""}">${p.stats.health}</b></div>
            <div class="stat">社会名誉 <b class="${delta.reputation > 0 ? "delta-plus" : delta.reputation < 0 ? "delta-minus" : ""}">${p.stats.reputation}</b></div>
            <div class="stat">财富(万) <b class="${delta.wealth > 0 ? "delta-plus" : delta.wealth < 0 ? "delta-minus" : ""}">${p.stats.wealth}</b></div>
            <div class="stat">存活进度 <b class="${delta.survivalProgress > 0 ? "delta-plus" : delta.survivalProgress < 0 ? "delta-minus" : ""}">${p.survivalProgress}</b></div>
            <div class="stat">权利指数 <b>${p.stats.rightsLevel}</b></div>
            <div class="stat">风险等级 <b>${p.stats.riskLevel}</b></div>
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
  const current = state.players[state.currentPlayerIndex];
  el.roundNum.textContent = String(Math.min(state.round, state.maxRound));
  el.currentPlayerName.textContent = `${current.name}${current.alive ? "" : "(出局)"}`;
  el.turnStage.textContent = state.stage === "primary" ? "主行动" : "文化行动";
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
  const current = state.players[state.currentPlayerIndex];
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
      if (!["culture", "meditate"].includes(scene)) {
        allowed = false;
      }
    }

    btn.disabled = !allowed || loadingDepth > 0;
  });

  el.courtBtn.disabled = loadingDepth > 0 || !mustCourt;
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

function applyMeditate(player) {
  applyEffects(state, player.id, {
    self: { health: 6, reputation: 0, wealth: 0 },
    global: { socialGap: 0, maleRights: 0, femaleRights: 0, allHealthDelta: 0 },
    meta: { survivalProgress: 4, equalityProgress: 0, major: false, tag: "🧘" },
  });

  addFeed({ player, tag: "🧘", summary: `${player.name}选择冥想，短暂恢复状态。` });
  logRoundDecision(state, {
    round: state.round,
    playerId: player.id,
    playerName: player.name,
    scene: "meditate",
    choice: "冥想",
    summary: `${player.name}选择冥想。`,
  });
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

  if (!isNoDiscuss) {
    applyPlayerStatMultipliersToOption(safe, player);
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
  safe.effects.global.allHealthDelta = Math.round(clampNum(safe.effects.global.allHealthDelta, -10, 10));

  safe.effects.meta.survivalProgress = Math.round(clampNum(safe.effects.meta.survivalProgress, -20, 20));
  safe.effects.meta.equalityProgress = Math.round(clampNum(safe.effects.meta.equalityProgress, -20, 20));
  safe.effects.meta.tag = String(safe.effects.meta.tag || "📌");

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

  if (scene === "culture" && subScene === "square") {
    safe.options = safe.options.filter((opt) => opt?.id !== "opt_no_discuss");
    safe.options.push({
      id: "opt_no_discuss",
      label: "不参与讨论",
      description: "保持沉默并离场，固定承受-3点身心健康值。",
      effects: {
        self: { health: -3, reputation: 0, wealth: 0 },
        global: { socialGap: 0, maleRights: 0, femaleRights: 0, allHealthDelta: 0 },
        meta: { survivalProgress: -2, equalityProgress: 0, major: false, tag: "🗣️" },
      },
    });
  }

  safe.options = safe.options.map((opt) => sanitizeOptionEffects(opt, scene, subScene, player));
  return safe;
}

function handleOptionChoose(eventData, option) {
  const player = state.players[state.currentPlayerIndex];

  applyEffects(state, player.id, option.effects);

  const summary = `${eventData.title} -> ${option.label}`;
  state.events.unshift({
    round: state.round,
    playerId: player.id,
    relatedPlayerIds: [player.id],
    playerName: player.name,
    tag: option.effects?.meta?.tag || "📌",
    summary,
    title: eventData.title,
    choiceLabel: option.label,
    thread: eventData.thread,
  });

  logRoundDecision(state, {
    round: state.round,
    playerId: player.id,
    playerName: player.name,
    scene: option.effects?.meta?.tag || "scene",
    choice: option.label,
    summary,
  });

  if (option.effects?.meta?.major) {
    addFeed({
      player,
      tag: option.effects.meta.tag || "📌",
      summary,
    });
  }

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

  if (isCourtRoundPending()) {
    await runCourt();
    return;
  }

  const player = state.players[state.currentPlayerIndex];
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
  openModal(eventData.title, (body) => {
    const para = document.createElement("p");
    para.textContent = eventData.narrative;
    body.appendChild(para);

    eventData.options.forEach((opt) => {
      const node = el.optionTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".option-title").textContent = opt.label;
      node.querySelector(".option-desc").textContent = opt.description || "";
      node.querySelector(".option-impact").textContent = effectPreview(opt.effects);
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
      node.querySelector(".option-impact").textContent = effectPreview(opt.effects);
      node.onclick = () => castCourtVote(opt, voter);
      body.appendChild(node);
    });
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
    summary: `${voter.name}法庭投票: ${option.label}`,
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
      state.players.forEach((p2) => applyEffects(state, p2.id, winner.effects));
      addFeed({
        player: state.players[0],
        tag: "⚖️",
        summary: `法庭多数决通过：${winner.label}（${top[1]}票）。`,
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
    info.textContent = "可发起：结婚 / 离婚 / 援助。互动结算将联动双方状态、亲密度与团队平等进度。";
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
          await resolveRelationshipAndApply(row.action, initiator, spouse);
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
      btn.innerHTML = `<div class="option-title">${c.name}</div><div class="option-desc">${c.gender === "male" ? "男" : "女"} | 财富${c.stats.wealth} | 健康${c.stats.health}</div>`;
      btn.onclick = async () => {
        await resolveRelationshipAndApply(action, initiator, c);
      };
      body.appendChild(btn);
    });
  });
}

async function resolveRelationshipAndApply(action, initiator, target) {
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
    return;
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

  const summary = `${initiator.name}与${target.name}：${result.title || action}`;
  logRoundDecision(state, {
    round: state.round,
    playerId: initiator.id,
    relatedPlayerIds: [initiator.id, target.id],
    playerName: initiator.name,
    scene: "pvp",
    choice: action,
    summary,
  });

  addFeed({
    player: initiator,
    tag: result.tag || "🤝",
    summary,
  });

  if (state.events[0]) {
    state.events[0].relatedPlayerIds = [initiator.id, target.id];
  }

  closeModal();
  await endActionAndMaybeAdvance();
}

async function settleRoundEvaluation(roundNumber) {
  const rows = consumeRoundDecisionLog(state, roundNumber);
  if (rows.length === 0) return;

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
    renderAll();
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
  const prevRound = state.round;
  advanceTurn(state);

  state.players.forEach((p) => {
    p.items = p.items
      .map((it) => ({ ...it, turnsLeft: it.turnsLeft - 1 }))
      .filter((it) => it.turnsLeft > 0);
  });

  if (state.round > prevRound) {
    decayIntimacyForRound(state, 2);
    await settleRoundEvaluation(prevRound);
    if (isCourtRoundPending()) {
      renderAll();
      await runCourt();
      return;
    }
  }

  const result = checkWinOrLose(state);
  renderAll();

  if (result === "success") {
    openModal("结局：社会共进", (body) => {
      body.innerHTML = `<p>超过半数玩家存活，且社会权利差值小于5。你们在冲突中推动了更均衡的秩序。</p>`;
    });
  }

  if (result === "failed") {
    openModal("结局：失衡坍塌", (body) => {
      body.innerHTML = `<p>在限定回合内未达成目标，或角色存活失败。请复盘关键抉择并重开新局。</p>`;
    });
  }
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
        message: "检测到后端代理，但未读取到 OPENROUTER_API_KEY，将使用Mock事件。",
      };
    }

    return {
      mode: "online",
      message: `已连接OpenRouter模型：${info.model}`,
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
    const runtimeStatus = await detectRuntimeStatus();

    const initResult = await runWithLoading("AI正在生成本局角色与初始数值...", () =>
      generateInitialCharacters(runtimeStatus.mode === "online")
    );

    state = createInitialStateFromPlayers(initResult.players || null);
    renderAll();

    const hintPlayer = state.players[state.currentPlayerIndex];
    addFeed({
      player: hintPlayer,
      tag: runtimeStatus.mode === "online" ? "✅" : "🚀",
      summary: `Demo已启动。${runtimeStatus.message} 本局角色已由${runtimeStatus.mode === "online" ? "大模型" : "降级Mock"}生成。`,
    });
    renderFeed();
  } catch (error) {
    console.error("[bootstrap] failed", error);
    state = createInitialStateFromPlayers(null);
    renderAll();
    const hintPlayer = state.players[state.currentPlayerIndex];
    addFeed({
      player: hintPlayer,
      tag: "⚠️",
      summary: `初始化失败，已自动回退本地角色：${error instanceof Error ? error.message : "未知错误"}`,
    });
    renderFeed();
  }
}

void bootstrap();
