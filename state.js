import { utils } from "./llm.js";

const NAMES = {
  male: ["周远", "刘承", "韩一舟", "魏启"] ,
  female: ["林岚", "沈禾", "唐知微", "许苒"],
};

const JOBS = ["算法工程师", "护士", "高中教师", "外卖骑手", "律师助理", "产品经理"];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickLevel() {
  const r = Math.random();
  if (r < 0.33) return "low";
  if (r < 0.74) return "mid";
  return "high";
}

function makeBio(name, gender, job) {
  const templates = [
    `${name}来自普通家庭，现任${job}，重视稳定与责任，在性别议题上逐步形成自己的立场。`,
    `${name}在大城市打拼多年，从事${job}，对公平与机会分配极其敏感，常在现实中两难。`,
    `${name}长期照顾家庭与工作双重压力，职业是${job}，希望在不撕裂关系的前提下争取平等。`,
  ];
  const txt = pickOne(templates);
  return `${gender === "male" ? "男性" : "女性"}角色。${txt}`.slice(0, 80);
}

export function createInitialState() {
  return createInitialStateFromPlayers(null);
}

export function createInitialStateFromPlayers(inputPlayers) {
  const players = Array.isArray(inputPlayers) && inputPlayers.length === 4
    ? inputPlayers.map((p, idx) => buildPlayerFromSeed(p, idx))
    : buildRandomPlayers();

  return {
    round: 1,
    maxRound: 20,
    currentPlayerIndex: 0,
    stage: "primary",
    primaryActionTaken: false,
    cultureActionTaken: false,
    courtDoneRounds: [],
    socialGap: randomInt(8, 18),
    maleRights: 50,
    femaleRights: 45,
    equalityDimensions: {
      legal: 50,
      economyEmployment: 50,
      educationDevelopment: 50,
      familyMarriage: 50,
      healthSafety: 50,
      socialVoice: 50,
      riskBurdenSymmetry: 50,
    },
    sharedWealthPools: {},
    nextPoolId: 1,
    players,
    acquaintances: {},
    events: [],
    roundDecisionLog: [],
    winner: null,
  };
}

function buildRandomPlayers() {
  const rows = [];
  ["male", "male", "female", "female"].forEach((gender, idx) => {
    const namePool = NAMES[gender];
    const name = namePool[idx % namePool.length] + (idx > 1 ? "" : "");
    const job = pickOne(JOBS);
    rows.push(
      buildPlayerFromSeed(
        {
          name,
          gender,
          age: randomInt(22, 39),
          job,
          bio: makeBio(name, gender, job),
          familyRelation: "与原生家庭在婚恋与责任观上偶有冲突。",
          keyEvents: ["经历过一次职业机会错失", "在亲密关系中处理过分工不均"],
          values: {
            familyMarriage: "mixed",
            fairness: "opportunity",
            reform: "moderate",
          },
          socialRole: "职场人/家庭成员",
          powerFeeling: "balanced",
          desireAndPressure: "想要稳定又希望突破现实约束。",
          conflictHooks: ["关键事件：是否接受不公平但高收益机会"],
          stance: "center",
          survivalTask: "在现实约束下维护身心稳定与发展机会",
          stats: {
            health: randomInt(45, 95),
            reputation: randomInt(-45, 55),
            wealth: randomInt(-20, 80),
            rightsLevel: pickLevel(),
            riskLevel: pickLevel(),
          },
          survivalProgress: randomInt(45, 75),
        },
        idx
      )
    );
  });
  return rows;
}

function buildPlayerFromSeed(seed, idx) {
  const gender = seed?.gender === "female" ? "female" : "male";
  const name = String(seed?.name || `${gender === "male" ? "男" : "女"}角色${idx + 1}`);
  const job = String(seed?.job || "职场人");

  return {
    id: `p${idx + 1}`,
    name,
    gender,
    genderIdentity: String(seed?.genderIdentity || (gender === "male" ? "顺性别男性" : "顺性别女性")),
    age: utils.clamp(Number(seed?.age || randomInt(22, 39)), 20, 45),
    job,
    cityTier: String(seed?.cityTier || "二线"),
    classLevel: String(seed?.classLevel || "工薪"),
    bio: String(seed?.bio || makeBio(name, gender, job)).slice(0, 80),
    familyRelation: String(seed?.familyRelation || "家庭关系中等紧张，存在代际分歧。"),
    keyEvents: Array.isArray(seed?.keyEvents) ? seed.keyEvents.slice(0, 3) : [],
    values: seed?.values || {
      familyMarriage: "mixed",
      fairness: "opportunity",
      reform: "moderate",
    },
    socialRole: String(seed?.socialRole || "职场人/家庭成员"),
    powerFeeling: String(seed?.powerFeeling || "balanced"),
    desireAndPressure: String(seed?.desireAndPressure || "在现实压力与自我选择中反复拉扯。"),
    conflictHooks: Array.isArray(seed?.conflictHooks) ? seed.conflictHooks.slice(0, 3) : [],
    stance: String(seed?.stance || "center"),
    survivalTask: String(seed?.survivalTask || "维持生存并争取更公平的制度空间"),
    stats: {
      health: utils.clamp(Number(seed?.stats?.health || randomInt(45, 95)), 10, 100),
      reputation: utils.clamp(Number(seed?.stats?.reputation || randomInt(-45, 55)), -100, 100),
      wealth: Number(seed?.stats?.wealth ?? randomInt(-20, 80)),
      rightsLevel: ["low", "mid", "high"].includes(seed?.stats?.rightsLevel)
        ? seed.stats.rightsLevel
        : pickLevel(),
      riskLevel: ["low", "mid", "high"].includes(seed?.stats?.riskLevel)
        ? seed.stats.riskLevel
        : pickLevel(),
    },
    survivalProgress: utils.clamp(Number(seed?.survivalProgress || randomInt(45, 75)), 0, 100),
    counselingUsed: 0,
    items: [],
    marriedTo: null,
    intimacy: 0,
    sharedWealthId: null,
    alive: true,
    lastDelta: {},
  };
}

export function applyEffects(state, playerId, effects) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !effects) return;

  const self = effects.self || {};
  const global = effects.global || {};

  syncPlayerWealthFromPool(state, player);

  const before = {
    health: player.stats.health,
    reputation: player.stats.reputation,
    wealth: player.stats.wealth,
    survivalProgress: player.survivalProgress,
  };

  player.stats.health = utils.clamp(player.stats.health + (self.health || 0), 0, 100);
  player.stats.reputation = utils.clamp(player.stats.reputation + (self.reputation || 0), -100, 100);
  if (self.wealth) {
    applyWealthDelta(state, player, self.wealth);
  }

  player.survivalProgress = utils.clamp(
    player.survivalProgress + ((effects.meta && effects.meta.survivalProgress) || 0),
    0,
    100
  );

  if (global.allHealthDelta) {
    state.players.forEach((p) => {
      p.stats.health = utils.clamp(p.stats.health + global.allHealthDelta, 0, 100);
    });
  }

  state.socialGap = Math.max(0, state.socialGap + (global.socialGap || 0));
  state.maleRights = utils.clamp(state.maleRights + (global.maleRights || 0), 0, 100);
  state.femaleRights = utils.clamp(state.femaleRights + (global.femaleRights || 0), 0, 100);

  player.lastDelta = {
    health: player.stats.health - before.health,
    reputation: player.stats.reputation - before.reputation,
    wealth: player.stats.wealth - before.wealth,
    survivalProgress: player.survivalProgress - before.survivalProgress,
  };

  if (player.stats.health <= 0 || player.survivalProgress <= 0) {
    player.alive = false;
  }
}

export function applyLocalDelta(state, player, delta) {
  if (!delta) return;
  syncPlayerWealthFromPool(state, player);
  player.stats.health = utils.clamp(player.stats.health + (delta.health || 0), 0, 100);
  player.stats.reputation = utils.clamp(player.stats.reputation + (delta.reputation || 0), -100, 100);
  if (delta.wealth) {
    applyWealthDelta(state, player, delta.wealth);
  }
  player.survivalProgress = utils.clamp(player.survivalProgress + (delta.survivalProgress || 0), 0, 100);
  if (player.stats.health <= 0 || player.survivalProgress <= 0) {
    player.alive = false;
  }
}

export function createMarriage(state, idA, idB, initIntimacy = 60) {
  const a = state.players.find((p) => p.id === idA);
  const b = state.players.find((p) => p.id === idB);
  if (!a || !b) return;

  const poolId = `pool_${state.nextPoolId++}`;
  state.sharedWealthPools[poolId] = {
    id: poolId,
    wealth: a.stats.wealth + b.stats.wealth,
    members: [a.id, b.id],
  };

  a.marriedTo = b.id;
  b.marriedTo = a.id;
  a.sharedWealthId = poolId;
  b.sharedWealthId = poolId;
  a.intimacy = utils.clamp(initIntimacy, 0, 100);
  b.intimacy = utils.clamp(initIntimacy, 0, 100);
  syncPlayerWealthFromPool(state, a);
  syncPlayerWealthFromPool(state, b);
}

export function dissolveMarriage(state, idA, idB) {
  const a = state.players.find((p) => p.id === idA);
  const b = state.players.find((p) => p.id === idB);
  if (!a || !b) return;

  const poolId = a.sharedWealthId && a.sharedWealthId === b.sharedWealthId ? a.sharedWealthId : null;
  if (poolId && state.sharedWealthPools[poolId]) {
    const total = state.sharedWealthPools[poolId].wealth;
    const half = Math.floor(total / 2);
    a.stats.wealth = half;
    b.stats.wealth = total - half;
    delete state.sharedWealthPools[poolId];
  }

  a.marriedTo = null;
  b.marriedTo = null;
  a.sharedWealthId = null;
  b.sharedWealthId = null;
  a.intimacy = 0;
  b.intimacy = 0;
}

export function updateIntimacyPair(state, idA, idB, deltaA = 0, deltaB = 0) {
  const a = state.players.find((p) => p.id === idA);
  const b = state.players.find((p) => p.id === idB);
  if (!a || !b) return;
  a.intimacy = utils.clamp(a.intimacy + deltaA, 0, 100);
  b.intimacy = utils.clamp(b.intimacy + deltaB, 0, 100);
}

export function decayIntimacyForRound(state, decay = 2) {
  const handled = new Set();
  state.players.forEach((p) => {
    if (!p.marriedTo) return;
    const pairKey = [p.id, p.marriedTo].sort().join("_");
    if (handled.has(pairKey)) return;
    handled.add(pairKey);

    const spouse = state.players.find((x) => x.id === p.marriedTo);
    if (!spouse) return;
    p.intimacy = utils.clamp(p.intimacy - decay, 0, 100);
    spouse.intimacy = utils.clamp(spouse.intimacy - decay, 0, 100);
  });
}

export function applyRoundEvaluation(state, evaluation) {
  const dims = evaluation?.dimensions || {};
  Object.keys(state.equalityDimensions).forEach((k) => {
    state.equalityDimensions[k] = utils.clamp(state.equalityDimensions[k] + (dims[k] || 0), 0, 100);
  });

  state.maleRights = utils.clamp(state.maleRights + (evaluation?.maleDelta || 0), 0, 100);
  state.femaleRights = utils.clamp(state.femaleRights + (evaluation?.femaleDelta || 0), 0, 100);
  state.socialGap = Math.abs(state.maleRights - state.femaleRights);
}

export function logRoundDecision(state, entry) {
  state.roundDecisionLog.push(entry);
}

export function markPlayersLinkedByPvp(state, idA, idB) {
  if (!idA || !idB || idA === idB) return;
  if (!state.acquaintances || typeof state.acquaintances !== "object") {
    state.acquaintances = {};
  }

  state.acquaintances[idA] = Array.isArray(state.acquaintances[idA]) ? state.acquaintances[idA] : [];
  state.acquaintances[idB] = Array.isArray(state.acquaintances[idB]) ? state.acquaintances[idB] : [];

  if (!state.acquaintances[idA].includes(idB)) {
    state.acquaintances[idA].push(idB);
  }
  if (!state.acquaintances[idB].includes(idA)) {
    state.acquaintances[idB].push(idA);
  }
}

export function consumeRoundDecisionLog(state, round) {
  const rows = state.roundDecisionLog.filter((x) => x.round === round);
  state.roundDecisionLog = state.roundDecisionLog.filter((x) => x.round !== round);
  return rows;
}

function syncPlayerWealthFromPool(state, player) {
  if (!player.sharedWealthId) return;
  const pool = state.sharedWealthPools[player.sharedWealthId];
  if (!pool) return;
  player.stats.wealth = pool.wealth;
}

function applyWealthDelta(state, player, delta) {
  if (player.sharedWealthId && state.sharedWealthPools[player.sharedWealthId]) {
    const pool = state.sharedWealthPools[player.sharedWealthId];
    pool.wealth += delta;
    const memberIds = pool.members || [];
    memberIds.forEach((id) => {
      const member = state.players.find((p) => p.id === id);
      if (member) member.stats.wealth = pool.wealth;
    });
    return;
  }
  player.stats.wealth += delta;
}

export function advanceTurn(state) {
  if (state.stage === "primary") {
    state.stage = "culture";
    return;
  }

  state.stage = "primary";
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;

  if (state.currentPlayerIndex === 0) {
    state.round += 1;
  }
}

export function checkWinOrLose(state) {
  const aliveCount = state.players.filter((p) => p.alive).length;
  const reachedFinal = state.round > state.maxRound;
  const success = reachedFinal && aliveCount >= 2 && state.socialGap < 5;
  const failedByRound = reachedFinal && !success;
  const allDead = aliveCount === 0;

  if (success) {
    state.winner = "success";
    return "success";
  }

  if (failedByRound || allDead) {
    state.winner = "failed";
    return "failed";
  }

  return null;
}

export function canOpenCounseling(player) {
  return player.stats.health < 50 && player.counselingUsed < 3;
}
