import {
  evaluateRoundRights,
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
  createInitialState,
  decayIntimacyForRound,
  dissolveMarriage,
  logRoundDecision,
  updateIntimacyPair,
} from "./state.js";

const state = createInitialState();

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
};

const apiEnabled = true;

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

  const mustCourt = state.round % 5 === 0 && !state.courtDoneRounds.includes(state.round);
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
  const mustCourt = state.round % 5 === 0 && !state.courtDoneRounds.includes(state.round);

  const alive = current.alive;
  el.boardButtons.forEach((btn) => {
    const scene = btn.dataset.scene;
    let allowed = alive;

    if (mustCourt) {
      allowed = scene === "meditate";
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

    btn.disabled = !allowed;
  });

  el.courtBtn.disabled = !(state.round % 5 === 0 && !state.courtDoneRounds.includes(state.round));
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
    playerName: player.name,
    tag,
    summary,
    title: summary,
  });
}

function applyMeditate(player) {
  applyEffects(state, player.id, {
    self: { health: 6, reputation: 0, wealth: 0, rightsLevelShift: 0, riskLevelShift: -1 },
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
  el.eventModal.classList.add("hidden");
}

function openModal(title, bodyBuilder) {
  el.modalTitle.textContent = title;
  el.modalBody.innerHTML = "";
  bodyBuilder(el.modalBody);
  el.eventModal.classList.remove("hidden");
}

function normalizeEvent(raw) {
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
          self: { health: -1, reputation: 0, wealth: 0, rightsLevelShift: 0, riskLevelShift: 0 },
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

  return safe;
}

function handleOptionChoose(eventData, option) {
  const player = state.players[state.currentPlayerIndex];

  applyEffects(state, player.id, option.effects);

  const summary = `${eventData.title} -> ${option.label}`;
  state.events.unshift({
    round: state.round,
    playerId: player.id,
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

  const historySummary = buildHistorySummary(state.events, player.id);
  const raw = await generateSceneEvent(
    {
      scene,
      subScene: null,
      player,
      gameState: state,
      historySummary,
    },
    apiEnabled
  );

  const eventData = normalizeEvent(raw);
  showEventModal(eventData);
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
        const historySummary = buildHistorySummary(state.events, player.id);
        const raw = await generateSceneEvent(
          {
            scene: "culture",
            subScene: r.key,
            player,
            gameState: state,
            historySummary,
          },
          apiEnabled
        );

        const eventData = normalizeEvent(raw);

        if (r.key === "counseling") {
          player.counselingUsed += 1;
        }

        showEventModal(eventData);
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
  const player = state.players[state.currentPlayerIndex];
  const historySummary = buildHistorySummary(state.events, player.id);

  const raw = await generateCourtEvent(
    {
      player,
      gameState: state,
      historySummary,
    },
    apiEnabled
  );

  const eventData = normalizeEvent(raw);

  openModal(`⚖️ ${eventData.title}`, (body) => {
    const p = document.createElement("p");
    p.textContent = eventData.narrative;
    body.appendChild(p);

    const note = document.createElement("p");
    note.textContent = "全员参与讨论，当前玩家先投票，结果计入共同平等进度。";
    body.appendChild(note);

    eventData.options.slice(0, 2).forEach((opt) => {
      const node = el.optionTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".option-title").textContent = opt.label;
      node.querySelector(".option-desc").textContent = opt.description || "";
      node.querySelector(".option-impact").textContent = effectPreview(opt.effects);
      node.onclick = () => {
        state.players.forEach((p2) => applyEffects(state, p2.id, opt.effects));
        state.courtDoneRounds.push(state.round);
        logRoundDecision(state, {
          round: state.round,
          playerId: player.id,
          playerName: player.name,
          scene: "court",
          choice: opt.label,
          summary: `${player.name}法庭投票: ${opt.label}`,
        });
        addFeed({
          player,
          tag: "⚖️",
          summary: `${player.name}发起法庭裁决: ${opt.label}`,
        });
        closeModal();
        renderAll();
      };
      body.appendChild(node);
    });
  });
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
  const historySummary = buildHistorySummary(state.events, initiator.id);
  const result = await resolveRelationshipAction(
    {
      action,
      initiator,
      target,
      gameState: state,
      historySummary,
    },
    apiEnabled
  );

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

  const summary = `${initiator.name}与${target.name}：${result.title || action}`;
  logRoundDecision(state, {
    round: state.round,
    playerId: initiator.id,
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

  closeModal();
  await endActionAndMaybeAdvance();
}

async function settleRoundEvaluation(roundNumber) {
  const rows = consumeRoundDecisionLog(state, roundNumber);
  if (rows.length === 0) return;

  const roundChoicesText = rows
    .map((x, idx) => `${idx + 1}. ${x.playerName} [${x.scene}] 选择: ${x.choice}; ${x.summary}`)
    .join("\n");

  const result = await evaluateRoundRights(
    {
      gameState: state,
      roundChoicesText,
    },
    apiEnabled
  );

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

function bootstrap() {
  bindEvents();
  renderAll();

  const hintPlayer = state.players[state.currentPlayerIndex];
  addFeed({
    player: hintPlayer,
    tag: "🚀",
    summary: "Demo已启动。未设置OPENROUTER_API_KEY时将使用本地Mock事件。",
  });
  renderFeed();
}

bootstrap();
