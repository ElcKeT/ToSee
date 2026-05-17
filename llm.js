import {
  buildCharacterInitPrompt,
  buildCultureCounselingPrompt,
  buildCultureLibraryPrompt,
  buildCultureSquarePrompt,
  buildCourtPrompt,
  buildCourtResultPrompt,
  buildOpportunityPrompt,
  buildPersonalFailureEndingPrompt,
  buildPersonalSuccessEndingPrompt,
  buildRelationshipPrompt,
  buildRoundEvaluationPrompt,
  buildScenePrompt,
  buildSocialFailureEndingPrompt,
  buildSocialSuccessEndingPrompt,
} from "./prompts.js";

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("模型输出不是合法JSON");
  }
}

let llmReqSeq = 0;

const PRESET_MANIFEST_PATH = "knowledge_base/manifest.ndjson";
const PRESET_MIX_CONFIG = {
  baseProbability: 0.35,
  minProbability: 0.15,
  maxProbability: 0.75,
  lowConflictWeight: 0.25,
  stagnationWeight: 0.2,
  repetitionPenalty: 0.22,
};

const CONFLICT_TAGS = new Set(["💼", "🏠", "🗣️", "⚖️", "🎲"]);

let presetCachePromise = null;
const presetUseHistory = [];

function nextLlmReqId() {
  llmReqSeq += 1;
  return `fe_${Date.now()}_${llmReqSeq}`;
}

async function callServerLlm(prompt) {
  const reqId = nextLlmReqId();
  const startedAt = performance.now();
  const timeoutMs = 180000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  console.log(`[llm-client][${reqId}] start promptChars=${prompt.length} timeoutMs=${timeoutMs}`);

  try {
    const response = await fetch("/api/llm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(
        `[llm-client][${reqId}] failed status=${response.status} ms=${Math.round(
          performance.now() - startedAt
        )} body=${errText}`
      );
      throw new Error(`后端模型代理调用失败: ${response.status} ${errText}`);
    }

    const data = await response.json();
    if (!data?.ok) {
      console.error(
        `[llm-client][${reqId}] failed logical ms=${Math.round(
          performance.now() - startedAt
        )} error=${data?.error || "unknown"} reqId=${data?.reqId || "-"}`
      );
      throw new Error(data?.error || "后端模型代理返回失败");
    }

    console.log(
      `[llm-client][${reqId}] success ms=${Math.round(performance.now() - startedAt)} hasData=${Boolean(data?.data)}`
    );
    return data.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error(`[llm-client][${reqId}] abort timeoutMs=${timeoutMs}`);
      throw new Error(`后端模型代理超时(${timeoutMs}ms)`);
    }
    console.error(
      `[llm-client][${reqId}] exception ms=${Math.round(performance.now() - startedAt)} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function roundTo1(v) {
  return Math.round(v * 10) / 10;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseNdjson(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeToken(token) {
  return String(token || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s_\-]/g, "")
    .trim();
}

function splitHintTokens(hintValue) {
  return String(hintValue || "")
    .split(/[|,;/、\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function inferSceneKeysFromHints(sceneHints) {
  const keys = new Set();

  safeArray(sceneHints).forEach((hint) => {
    splitHintTokens(hint).forEach((raw) => {
      const t = normalizeToken(raw);

      if (!t) return;
      if (t.includes("workplace") || t.includes("work") || t.includes("职场")) keys.add("workplace");
      if (t.includes("family") || t.includes("家庭")) keys.add("family");
      if (t.includes("opportunity") || t.includes("机遇")) keys.add("opportunity");
      if (t.includes("court") || t.includes("法庭")) keys.add("court");

      if (t.includes("culture") || t.includes("文化")) keys.add("culture:*");
      if (t.includes("square") || t.includes("socialmedia") || t.includes("广场") || t.includes("社交")) {
        keys.add("culture:square");
      }
      if (t.includes("library") || t.includes("图书馆") || t.includes("知识")) keys.add("culture:library");
      if (t.includes("counseling") || t.includes("咨询") || t.includes("修复")) {
        keys.add("culture:counseling");
      }
    });
  });

  return keys;
}

function inferRelationshipHints(relationshipHints) {
  const hints = new Set();

  safeArray(relationshipHints).forEach((hint) => {
    splitHintTokens(hint).forEach((raw) => {
      const t = normalizeToken(raw);
      if (!t) return;
      if (t.includes("all") || t.includes("全部") || t.includes("通用")) hints.add("all");
      if (t.includes("single") || t.includes("未婚") || t.includes("单身")) hints.add("single");
      if (t.includes("married") || t.includes("已婚") || t.includes("婚后")) hints.add("married");
    });
  });

  if (hints.size === 0) hints.add("all");
  return hints;
}

function eventSceneKey(scene, subScene) {
  if (scene === "culture") return `culture:${subScene || "square"}`;
  return scene || "workplace";
}

function matchPresetToScene(preset, scene, subScene) {
  const keys = inferSceneKeysFromHints(preset?.promptSeed?.sceneHints);
  if (keys.size === 0) return true;

  const key = eventSceneKey(scene, subScene);
  if (keys.has(key)) return true;
  if (scene === "culture" && keys.has("culture:*")) return true;
  if (keys.has(scene)) return true;
  return false;
}

function matchPresetToRelationship(preset, player) {
  const rel = player?.marriedTo ? "married" : "single";
  const hints = inferRelationshipHints(preset?.promptSeed?.relationshipHints);
  return hints.has("all") || hints.has(rel);
}

function summarizeConflictSignals(gameState) {
  const recent = safeArray(gameState?.events).slice(0, 10);
  const total = recent.length || 1;
  const conflictCount = recent.filter((e) => CONFLICT_TAGS.has(e?.tag)).length;
  const conflictDensity = conflictCount / total;

  const openThreads = new Set(
    recent
      .filter((e) => e?.thread?.status === "open" && e?.thread?.threadId)
      .map((e) => e.thread.threadId)
  );

  const lowConflict = clamp(1 - conflictDensity, 0, 1);
  const stagnation = openThreads.size === 0 ? 1 : openThreads.size === 1 ? 0.6 : 0.2;

  return {
    lowConflict,
    stagnation,
    openThreads: openThreads.size,
    conflictDensity: roundTo1(conflictDensity),
  };
}

function calcRepetitionPenalty() {
  const recent = presetUseHistory.slice(-6);
  if (recent.length < 3) return 0;

  const counter = new Map();
  recent.forEach((x) => {
    safeArray(x?.themes).forEach((t) => {
      counter.set(t, (counter.get(t) || 0) + 1);
    });
  });

  if (counter.size === 0) return 0;
  const maxFreq = Math.max(...counter.values());
  const ratio = maxFreq / recent.length;
  return clamp(ratio - 0.35, 0, 1);
}

function computeDynamicPresetProbability(gameState) {
  const signal = summarizeConflictSignals(gameState);
  const repetition = calcRepetitionPenalty();
  const p =
    PRESET_MIX_CONFIG.baseProbability +
    PRESET_MIX_CONFIG.lowConflictWeight * signal.lowConflict +
    PRESET_MIX_CONFIG.stagnationWeight * signal.stagnation -
    PRESET_MIX_CONFIG.repetitionPenalty * repetition;

  const probability = clamp(p, PRESET_MIX_CONFIG.minProbability, PRESET_MIX_CONFIG.maxProbability);
  return {
    probability,
    signal: {
      ...signal,
      repetition: roundTo1(repetition),
    },
  };
}

function buildPresetCandidateScore(preset, scene, subScene, gameState) {
  const quality = Number(preset?.quality?.qualityScore || 70);
  const confidence = Number(preset?.quality?.confidence || 0.7);
  const sceneMatch = matchPresetToScene(preset, scene, subScene) ? 1 : 0;

  const recentPresetIds = new Set(presetUseHistory.slice(-8).map((x) => x.presetId));
  const usedPenalty = recentPresetIds.has(preset.presetId) ? 0.28 : 0;

  const recentThemes = presetUseHistory.slice(-6).flatMap((x) => safeArray(x?.themes));
  const themeOverlap = safeArray(preset?.themes?.canonical).filter((t) => recentThemes.includes(t)).length;
  const overlapPenalty = Math.min(0.2, themeOverlap * 0.08);

  const roundBoost = gameState?.round >= 6 ? 0.06 : 0;

  return quality / 100 + confidence * 0.2 + sceneMatch * 0.2 + roundBoost - usedPenalty - overlapPenalty;
}

function weightedPick(items, scoreGetter) {
  const scored = items
    .map((item) => ({ item, score: Math.max(0.01, Number(scoreGetter(item) || 0.01)) }))
    .sort((a, b) => b.score - a.score);

  const total = scored.reduce((sum, x) => sum + x.score, 0);
  if (total <= 0) return scored[0]?.item || null;

  let r = Math.random() * total;
  for (const row of scored) {
    r -= row.score;
    if (r <= 0) return row.item;
  }
  return scored[0]?.item || null;
}

function buildPresetGuidedPrompt({ basePrompt, preset, scene, subScene, player }) {
  const digest = {
    presetId: preset?.presetId,
    themes: safeArray(preset?.themes?.canonical).slice(0, 4),
    conflictCore: preset?.conflictCore,
    storyBlueprint: {
      background: preset?.storyBlueprint?.background,
      trigger: preset?.storyBlueprint?.trigger,
      escalation: preset?.storyBlueprint?.escalation,
      dilemma: preset?.storyBlueprint?.dilemma,
      decisionFrames: safeArray(preset?.storyBlueprint?.decisionFrames).slice(0, 3),
    },
    adaptationRules: {
      modernization: safeArray(preset?.adaptationRules?.modernization).slice(0, 4),
      safetyBoundaries: safeArray(preset?.adaptationRules?.safetyBoundaries).slice(0, 4),
    },
    conflictHooks: safeArray(preset?.promptSeed?.conflictHooks).slice(0, 5),
  };

  return `${basePrompt}

# 预制冲突注入(高优先级)
本次生成采用“预制冲突引导模式”。你必须在不照抄原文的前提下，将下述冲突骨架改写为当前玩家可体验事件。

当前注入条件:
- scene=${scene}
- subScene=${subScene || "none"}
- player=${player?.name || "unknown"}

预制故事卡摘要(JSON):
${JSON.stringify(digest, null, 2)}

注入执行规则:
1) 保留 conflictCore 与 dilemma，不得弱化冲突张力。
2) 至少两个选项要分别对应不同 decisionFrames 立场。
3) 必须完成角色替换与时代适配，不得出现书中具体人名、地点、机构名。
4) 若预制场景与当前scene不完全一致，保持矛盾核心并改写为当前scene可落地事件。
5) 继续严格遵守上文全部数值与JSON输出约束，只输出JSON。`;
}

function markPresetUsed(preset, scene, subScene, gameState) {
  presetUseHistory.push({
    presetId: preset?.presetId,
    round: gameState?.round || 0,
    scene: eventSceneKey(scene, subScene),
    themes: safeArray(preset?.themes?.canonical),
  });

  if (presetUseHistory.length > 40) {
    presetUseHistory.splice(0, presetUseHistory.length - 40);
  }
}

function normalizePresetRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.presetId) return null;
  if (!raw.storyBlueprint || typeof raw.storyBlueprint !== "object") return null;

  return {
    ...raw,
    themes: {
      canonical: safeArray(raw?.themes?.canonical),
      raw: safeArray(raw?.themes?.raw),
    },
    promptSeed: raw.promptSeed || {},
    quality: raw.quality || {},
  };
}

async function loadPresetKnowledgeBase() {
  if (presetCachePromise) return presetCachePromise;

  presetCachePromise = (async () => {
    try {
      const manifestResp = await fetch(PRESET_MANIFEST_PATH, { cache: "no-store" });
      if (!manifestResp.ok) {
        console.warn(`[preset] manifest missing status=${manifestResp.status}`);
        return [];
      }

      const manifestText = await manifestResp.text();
      const rows = parseNdjson(manifestText);
      const files = rows
        .map((row) => String(row?.file || "").trim())
        .filter(Boolean)
        .slice(-500);

      const loaded = await Promise.all(
        files.map(async (file) => {
          try {
            const resp = await fetch(file.startsWith("/") ? file : `/${file}`, { cache: "no-store" });
            if (!resp.ok) return null;
            const json = await resp.json();
            return normalizePresetRecord(json);
          } catch {
            return null;
          }
        })
      );

      const presets = loaded.filter(Boolean);
      console.log(`[preset] loaded ${presets.length} cards from knowledge base`);
      return presets;
    } catch (error) {
      console.warn("[preset] load failed", error);
      return [];
    }
  })();

  return presetCachePromise;
}

async function chooseSceneGenerationMode({ scene, subScene, player, gameState }) {
  const presets = await loadPresetKnowledgeBase();
  const eligible = presets.filter((p) => matchPresetToScene(p, scene, subScene) && matchPresetToRelationship(p, player));

  const dynamic = computeDynamicPresetProbability(gameState);
  const probability = eligible.length > 0 ? dynamic.probability : 0;
  const draw = Math.random();

  if (eligible.length === 0 || draw > probability) {
    return {
      mode: "creative",
      probability,
      draw,
      signal: dynamic.signal,
      preset: null,
      eligibleCount: eligible.length,
    };
  }

  const preset = weightedPick(eligible, (p) => buildPresetCandidateScore(p, scene, subScene, gameState));
  return {
    mode: preset ? "preset" : "creative",
    probability,
    draw,
    signal: dynamic.signal,
    preset: preset || null,
    eligibleCount: eligible.length,
  };
}

const MOCK_NAMES = {
  male: ["周远", "刘承", "韩一舟", "魏启", "程峥", "罗川"],
  female: ["林岚", "沈禾", "唐知微", "许苒", "江晚", "宋妍"],
};

const MOCK_JOBS = [
  "算法工程师",
  "护士",
  "中学教师",
  "外卖骑手",
  "律师助理",
  "产品经理",
  "客服主管",
  "社区社工",
];

function deriveLevelsFromReputation(reputation) {
  const value = Number(reputation || 0);
  if (value >= 50) return { rightsLevel: "high", riskLevel: "low" };
  if (value <= -50) return { rightsLevel: "low", riskLevel: "high" };
  return { rightsLevel: "mid", riskLevel: "mid" };
}

function calcInitialSurvivalProgress(stats) {
  const rightsSurvival = stats.rightsLevel === "high" ? 5 : stats.rightsLevel === "mid" ? 3 : 0;
  const riskPenalty = stats.riskLevel === "high" ? -3 : stats.riskLevel === "mid" ? -1 : 0;
  return clamp(
    Math.max(
      10,
      Number(stats.health || 0) * 0.4 +
        Number(stats.reputation || 0) * 0.3 +
        Number(stats.wealth || 0) * 0.2 +
        rightsSurvival +
        riskPenalty
    ),
    0,
    100
  );
}

function buildMockCharacter(gender, ageBase, idx) {
  const name = randomFrom(MOCK_NAMES[gender]);
  const age = clamp(ageBase + Math.floor(Math.random() * 10) - 4, 22, 39);
  const job = randomFrom(MOCK_JOBS);
  const cityTier = randomFrom(["一线", "新一线", "二线"]);
  const classLevel = randomFrom(["工薪", "中产边缘", "普通中产"]);
  const valuesFamily = randomFrom(["traditional", "autonomous", "mixed"]);
  const valuesFairness = randomFrom(["result", "opportunity", "freedom"]);
  const valuesReform = randomFrom(["radical", "moderate", "skeptical"]);
  const stats = {
    health: Math.floor(48 + Math.random() * 42),
    reputation: Math.floor(-70 + Math.random() * 141),
    wealth: roundTo1(-8 + Math.random() * 68),
  };
  Object.assign(stats, deriveLevelsFromReputation(stats.reputation));
  return {
    name: `${name}${idx > 2 ? "" : ""}`,
    gender,
    genderIdentity: gender === "male" ? "顺性别男性" : "顺性别女性",
    age,
    job,
    cityTier,
    classLevel,
    bio: `${gender === "male" ? "男性" : "女性"}，${age}岁${job}，在${cityTier}城市承受家庭与职业双重压力，立场并不稳定。`.slice(
      0,
      80
    ),
    familyRelation: "与父母在婚恋与生育观上有持续拉扯，代际沟通紧张。",
    keyEvents: ["曾因性别刻板印象错失机会", "在亲密关系里经历过权责失衡"],
    values: {
      familyMarriage: valuesFamily,
      fairness: valuesFairness,
      reform: valuesReform,
    },
    socialRole: randomFrom(["职场人/子女", "伴侣候选/职场人", "公民/家庭照料者"]),
    powerFeeling: randomFrom(["dominant", "passive", "balanced", "imbalanced"]),
    desireAndPressure: "希望兼顾体面收入与关系稳定，但现实资源不足导致反复妥协。",
    conflictHooks: ["关键节点：是否为晋升放弃照料责任"],
    stance: randomFrom(["left", "center", "right"]),
    survivalTask:
      gender === "female"
        ? "争取职业成长并避免被家庭角色固定化"
        : "拒绝单一养家角色，争取照料责任与工作权利平衡",
    stats,
    survivalProgress: calcInitialSurvivalProgress(stats),
  };
}

function mockInitialCharacters() {
  const ageBase = 27 + Math.floor(Math.random() * 6);
  const players = [
    buildMockCharacter("male", ageBase, 0),
    buildMockCharacter("male", ageBase, 1),
    buildMockCharacter("female", ageBase, 2),
    buildMockCharacter("female", ageBase, 3),
  ];
  return { players };
}

function normalizeInitResult(raw) {
  const fallback = mockInitialCharacters();
  const rows = Array.isArray(raw?.players) ? raw.players.slice(0, 4) : [];
  if (rows.length !== 4) return fallback;

  const players = rows.map((p, idx) => {
    const gender = p?.gender === "female" ? "female" : "male";
    const health = clamp(Number(p?.stats?.health || 65), 0, 100);
    const reputation = clamp(Number(p?.stats?.reputation || 0), -100, 100);
    const wealth = roundTo1(Number(p?.stats?.wealth ?? 10));
    const levels = deriveLevelsFromReputation(reputation);
    const stats = { health, reputation, wealth, ...levels };
    return {
      name: String(p?.name || `${gender === "male" ? "男" : "女"}角色${idx + 1}`).slice(0, 12),
      gender,
      genderIdentity: String(p?.genderIdentity || (gender === "male" ? "顺性别男性" : "顺性别女性")).slice(0, 20),
      age: clamp(Number(p?.age || 28), 20, 45),
      job: String(p?.job || "职场人").slice(0, 20),
      cityTier: String(p?.cityTier || "二线").slice(0, 10),
      classLevel: String(p?.classLevel || "工薪").slice(0, 12),
      bio: String(p?.bio || "角色背景待补充").slice(0, 80),
      familyRelation: String(p?.familyRelation || "代际关系中等紧张").slice(0, 70),
      keyEvents: Array.isArray(p?.keyEvents) ? p.keyEvents.slice(0, 3) : ["曾经历角色冲突"],
      values: {
        familyMarriage: ["traditional", "autonomous", "mixed"].includes(p?.values?.familyMarriage)
          ? p.values.familyMarriage
          : "mixed",
        fairness: ["result", "opportunity", "freedom"].includes(p?.values?.fairness)
          ? p.values.fairness
          : "opportunity",
        reform: ["radical", "moderate", "skeptical"].includes(p?.values?.reform)
          ? p.values.reform
          : "moderate",
      },
      socialRole: String(p?.socialRole || "职场人/家庭成员").slice(0, 24),
      powerFeeling: ["dominant", "passive", "balanced", "imbalanced"].includes(p?.powerFeeling)
        ? p.powerFeeling
        : "balanced",
      desireAndPressure: String(p?.desireAndPressure || "在现实压力和自我实现间挣扎").slice(0, 80),
      conflictHooks: Array.isArray(p?.conflictHooks) ? p.conflictHooks.slice(0, 3) : ["关键抉择冲突待触发"],
      stance: ["left", "center", "right"].includes(p?.stance) ? p.stance : "center",
      survivalTask: String(p?.survivalTask || "在20回合内保持身心稳定并争取平等空间").slice(0, 60),
      stats,
      survivalProgress: calcInitialSurvivalProgress(stats),
    };
  });

  const maleCount = players.filter((x) => x.gender === "male").length;
  const femaleCount = players.filter((x) => x.gender === "female").length;
  if (maleCount !== 2 || femaleCount !== 2) {
    return fallback;
  }

  const ages = players.map((x) => x.age);
  if (Math.max(...ages) - Math.min(...ages) > 15) {
    return fallback;
  }

  return { players };
}

function normalizeSingleInitPlayer(rawPlayer, idx, expectedGender) {
  const fallback = buildMockCharacter(expectedGender, 27, idx);
  const gender = expectedGender === "female" ? "female" : "male";
  const p = rawPlayer || {};
  const health = clamp(Number(p?.stats?.health || fallback.stats.health || 65), 0, 100);
  const reputation = clamp(Number(p?.stats?.reputation || fallback.stats.reputation || 0), -100, 100);
  const wealth = roundTo1(Number(p?.stats?.wealth ?? fallback.stats.wealth ?? 10));
  const stats = { health, reputation, wealth, ...deriveLevelsFromReputation(reputation) };

  return {
    name: String(p?.name || `${gender === "male" ? "男" : "女"}角色${idx + 1}`).slice(0, 12),
    gender,
    genderIdentity: String(p?.genderIdentity || (gender === "male" ? "顺性别男性" : "顺性别女性")).slice(
      0,
      20
    ),
    age: clamp(Number(p?.age || fallback.age || 28), 20, 35),
    job: String(p?.job || fallback.job || "职场人").slice(0, 20),
    cityTier: String(p?.cityTier || fallback.cityTier || "二线").slice(0, 10),
    classLevel: String(p?.classLevel || fallback.classLevel || "工薪").slice(0, 12),
    bio: String(p?.bio || fallback.bio || "角色背景待补充").slice(0, 80),
    familyRelation: String(p?.familyRelation || fallback.familyRelation || "代际关系中等紧张").slice(0, 70),
    keyEvents: Array.isArray(p?.keyEvents) ? p.keyEvents.slice(0, 3) : fallback.keyEvents,
    values: {
      familyMarriage: ["traditional", "autonomous", "mixed"].includes(p?.values?.familyMarriage)
        ? p.values.familyMarriage
        : fallback.values.familyMarriage,
      fairness: ["result", "opportunity", "freedom"].includes(p?.values?.fairness)
        ? p.values.fairness
        : fallback.values.fairness,
      reform: ["radical", "moderate", "skeptical"].includes(p?.values?.reform)
        ? p.values.reform
        : fallback.values.reform,
    },
    socialRole: String(p?.socialRole || fallback.socialRole || "职场人/家庭成员").slice(0, 24),
    powerFeeling: ["dominant", "passive", "balanced", "imbalanced"].includes(p?.powerFeeling)
      ? p.powerFeeling
      : fallback.powerFeeling,
    desireAndPressure: String(p?.desireAndPressure || fallback.desireAndPressure || "在现实压力和自我实现间挣扎").slice(
      0,
      80
    ),
    conflictHooks: Array.isArray(p?.conflictHooks) ? p.conflictHooks.slice(0, 3) : fallback.conflictHooks,
    stance: ["left", "center", "right"].includes(p?.stance) ? p.stance : fallback.stance,
    survivalTask: String(p?.survivalTask || fallback.survivalTask || "在20回合内保持身心稳定并争取平等空间").slice(
      0,
      60
    ),
    stats,
    survivalProgress: calcInitialSurvivalProgress(stats),
  };
}

function mockEvent({ scene, subScene, player, gameState }) {
  const familyTitles = player?.marriedTo
    ? ["家务分工协商", "家庭责任再平衡", "共同财务决策分歧", "育儿参与边界讨论"]
    : ["家务分工冲突", "催婚压力与职业规划", "育儿责任归属争执"];

  const titles = {
    workplace: ["晋升评审争议", "绩效谈判拉扯", "育儿支持政策落地受阻"],
    family: familyTitles,
    culture: ["公共舆论争议", "知识澄清与立场拉扯", "网暴事件发酵"],
    opportunity: ["破局机会敲门", "援助资源释放", "命运交换提案"],
    court: ["法庭审议性别权利议题"],
  };

  if (scene === "culture" && subScene === "library") {
    return {
      eventId: `evt_${Date.now()}`,
      thread: {
        threadId: `thr_culture_library_${Math.floor(Math.random() * 5)}`,
        status: "open",
        summary: "通过科普学习获得新的沟通与协商框架",
      },
      title: randomFrom(["图书馆微讲堂", "知识卡片更新", "性别议题科普角"]),
      narrative:
        "你在图书馆参加了一场架空社会议题科普活动，重点是法律常识、沟通策略与心理韧性训练。",
      options: [
        {
          id: "opt_a",
          label: "学习法律与权益速查卡",
          description: "建立维权与协商知识框架，日常表达更有底气。",
          effects: {
            self: { health: 3, reputation: 1, wealth: -1 },
            meta: { survivalProgress: 2 },
          },
        },
        {
          id: "opt_b",
          label: "参加边界沟通练习",
          description: "通过练习降低沟通摩擦，提升关系协商能力。",
          effects: {
            self: { health: 4, reputation: 0, wealth: -1 },
            meta: { survivalProgress: 3 },
          },
        },
      ],
    };
  }

  if (scene === "culture" && subScene === "counseling") {
    return {
      eventId: `evt_${Date.now()}`,
      thread: {
        threadId: `thr_culture_counseling_${Math.floor(Math.random() * 5)}`,
        status: "open",
        summary: "通过支持性干预暂时缓解了压力负荷",
      },
      title: randomFrom(["咨询室短程干预", "情绪与边界复盘", "压力恢复方案"]),
      narrative:
        "你在咨询室完成了一次结构化干预，重点是压力识别、边界表达与现实协商；恢复会消耗一定社会或经济资源。",
      options: [
        {
          id: "opt_a",
          label: "高强度一对一咨询",
          description: "恢复更明显，但需要支付较高费用。",
          effects: {
            self: { health: 9, reputation: 0, wealth: -2 },
            meta: { survivalProgress: 4 },
          },
        },
        {
          id: "opt_b",
          label: "同伴支持与沟通训练",
          description: "恢复中等，经济代价较低但会承担一定名誉成本。",
          effects: {
            self: { health: 6, reputation: -1, wealth: -0.8 },
            meta: { survivalProgress: 3 },
          },
        },
      ],
    };
  }

  const title = randomFrom(titles[scene] || titles.workplace);
  const base = Math.round(Math.random() * 8 + 4);

  const options = [
    {
      id: "opt_a",
      label: "正面应对并公开发声",
      description: "承担较高压力换取制度性改进。",
      effects: {
        self: {
          health: -Math.round(base * 0.7),
          reputation: Math.round(base * 0.6),
          wealth: -Math.round(base * 0.3),
        },
        meta: { survivalProgress: 4 },
      },
    },
    {
      id: "opt_b",
      label: "协商妥协，优先自保",
      description: "减少当轮风险，但推动较慢。",
      effects: {
        self: {
          health: -Math.round(base * 0.2),
          reputation: -1,
          wealth: 1,
        },
        meta: { survivalProgress: 2 },
      },
    },
    {
      id: "opt_c",
      label: "放弃争取，回避冲突",
      description: "短期压力减轻，长期不平等扩大。",
      effects: {
        self: {
          health: 2,
          reputation: -Math.round(base * 0.5),
          wealth: 0,
        },
        meta: { survivalProgress: -2 },
      },
    },
  ];

  return {
    eventId: `evt_${Date.now()}`,
    thread: {
      threadId: `thr_${scene}_${Math.floor(Math.random() * 5)}`,
      status: Math.random() > 0.62 ? "closed" : "open",
      summary: `${title}出现阶段性变化`,
    },
    title,
    narrative: `${player.name}在“${scene}”场景遭遇新的现实冲突。系统结合其人设与历史记录，给出以下抉择。`,
    options,
  };
}

function mockOpportunityEvent({ player }) {
  const legendary = randomFrom([
    {
      title: "旧彩票的号码",
      setup: "你在整理抽屉时翻出一张差点被丢掉的彩票，号码和当天公布结果只隔着一次确认。",
      success: "彩票命中了足以缓解多年压力的奖金，你先还清紧急债务，又给自己留出一段重新选择职业的时间。",
      failure: "彩票没有中奖，你为核验与折返花掉了半天，情绪短暂下坠，但损耗仍在可承受范围内。",
    },
    {
      title: "失联亲人的名片",
      setup: "一位多年未见的亲人突然联系你，原来对方正在寻找可信任的人接手一个小项目。",
      success: "项目意外适合你的经验，你获得一笔稳定合作款，也结识了能继续介绍资源的贵人。",
      failure: "项目临时取消，你白跑几趟还垫付了交通费用，只能把它当成一次虚惊后的练习。",
    },
    {
      title: "巡游道士的转运符",
      setup: "夜市里，一个四处云游的道士听完你的近况，留下一个半真半假的转运建议。",
      success: "你照着建议换了行动节奏，竟避开了一次重大损耗，还误打误撞遇到愿意提携你的人。",
      failure: "所谓转运没有立刻灵验，你为这点希望付出小成本，也提醒自己不能全靠运气。",
    },
  ]);

  return {
    eventId: `opp_${Date.now()}`,
    thread: {
      threadId: `thr_opp_${Math.floor(Math.random() * 8)}`,
      status: "closed",
      summary: `${legendary.title}带来一次小概率转折`,
    },
    title: legendary.title,
    narrative: `${player.name}${legendary.setup}你可以确认尝试，让命运掷出一次硬币；也可以取消离开，只损失这次行动投入。`,
    options: [
      {
        id: "success",
        label: "确认尝试：机遇成真",
        description: legendary.success,
        summary: `${player.name}抓住“${legendary.title}”带来的小概率机遇，获得翻盘资源。`,
        thread: { status: "closed", summary: "机遇成功兑现，局面被重新打开。" },
        effects: {
          self: {
            health: Math.round(14 + Math.random() * 10),
            reputation: Math.round(10 + Math.random() * 12),
            wealth: roundTo1(10 + Math.random() * 25),
          },
          meta: { survivalProgress: 12 },
        },
      },
      {
        id: "failure",
        label: "确认尝试：机遇落空",
        description: legendary.failure,
        summary: `${player.name}尝试“${legendary.title}”，但机遇没有兑现，只留下轻微损耗。`,
        thread: { status: "closed", summary: "机遇未能兑现，玩家带着损耗离开。" },
        effects: {
          self: {
            health: -Math.round(2 + Math.random() * 5),
            reputation: -Math.round(1 + Math.random() * 4),
            wealth: -roundTo1(0.5 + Math.random() * 3),
          },
          meta: { survivalProgress: -3 },
        },
      },
    ],
  };
}

export async function generateSceneEvent(params, apiKey) {
  const { scene, subScene, player, gameState, historySummary } = params;

  if (!apiKey) {
    return mockEvent({ scene, subScene, player, gameState });
  }

  const creativePrompt =
    scene === "culture" && subScene === "square"
      ? buildCultureSquarePrompt({ player, gameState, historySummary })
      : scene === "culture" && subScene === "library"
      ? buildCultureLibraryPrompt({ player, gameState, historySummary })
      : scene === "culture" && subScene === "counseling"
      ? buildCultureCounselingPrompt({ player, gameState, historySummary })
      : buildScenePrompt({ scene, subScene, player, gameState, historySummary });

  try {
    const decision = await chooseSceneGenerationMode({
      scene,
      subScene,
      player,
      gameState,
    });

    const finalPrompt =
      decision.mode === "preset" && decision.preset
        ? buildPresetGuidedPrompt({
            basePrompt: creativePrompt,
            preset: decision.preset,
            scene,
            subScene,
            player,
          })
        : creativePrompt;

    const event = await callServerLlm(finalPrompt);

    if (decision.mode === "preset" && decision.preset) {
      markPresetUsed(decision.preset, scene, subScene, gameState);
    }

    if (event && typeof event === "object") {
      event.generation = {
        mode: decision.mode,
        presetId: decision.preset?.presetId || null,
        presetThemes: safeArray(decision.preset?.themes?.canonical).slice(0, 4),
        probability: roundTo1(decision.probability),
        draw: roundTo1(decision.draw),
        eligibleCount: decision.eligibleCount,
        signal: decision.signal,
      };
    }

    console.log(
      `[scene-gen] mode=${decision.mode} p=${decision.probability.toFixed(2)} draw=${decision.draw.toFixed(2)} eligible=${decision.eligibleCount} preset=${decision.preset?.presetId || "none"}`
    );

    return event;
  } catch (error) {
    console.warn("模型调用失败，自动回退到Mock事件:", error);
    return mockEvent({ scene, subScene, player, gameState });
  }
}

export async function generateOpportunityEvent(params, apiKey) {
  const { player, gameState, historySummary } = params;

  if (!apiKey) {
    return mockOpportunityEvent({ player, gameState });
  }

  const prompt = buildOpportunityPrompt({ player, gameState, historySummary });
  try {
    return await callServerLlm(prompt);
  } catch (error) {
    console.warn("机遇场模型调用失败，自动回退到Mock事件:", error);
    return mockOpportunityEvent({ player, gameState });
  }
}

export async function generateCourtEvent(params, apiKey) {
  const { gameState, historySummary, player } = params;

  if (!apiKey) {
    return mockEvent({ scene: "court", player, gameState });
  }

  const prompt = buildCourtPrompt({ gameState, historySummary });
  try {
    return await callServerLlm(prompt);
  } catch (error) {
    console.warn("法庭模型调用失败，自动回退到Mock事件:", error);
    return mockEvent({ scene: "court", player, gameState });
  }
}

function normalizeCourtVerdict(raw, fallback) {
  const verdictText = String(raw?.verdictText || raw?.endingText || raw?.text || "").trim();
  const summary = String(raw?.summary || "").trim();
  return {
    title: String(raw?.title || "结果宣判").slice(0, 40),
    verdictText: (verdictText || fallback.verdictText).slice(0, 900),
    summary: (summary || fallback.summary).slice(0, 240),
  };
}

function mockCourtVerdict({ eventData, votesText, winnerLabel, winnerSummary, resultText, impactText }) {
  const billName = eventData?.billName || eventData?.title || "本项法案";
  const passed = winnerLabel === "支持";
  const rejected = winnerLabel === "反对";
  const suspended = winnerLabel === "弃权" || winnerLabel === "无多数";
  const execution = passed
    ? `法庭决定推动${billName}试点执行。第一个被纳入试点的城市要求用人单位公开照护假落实率，并把违规记录纳入年度劳动监察。几个月后，一家曾以“岗位不便”为由拒绝员工照护假的企业被约谈，相关部门要求其补发福利并调整招聘话术。`
    : rejected
    ? `法庭最终没有采纳${billName}。反对方认为改革速度过快会带来用工震荡，于是相关部门只发布了倡议性文件。短期内争议降温，但企业仍能用“岗位适配”包装隐性筛选，家庭照护压力继续被私人化。`
    : `${billName}在弃权声中被搁置。大量旁观者认为提案“方向不错但太麻烦”，导致执行部门缺少明确授权。公共讨论一度热闹，却没有形成足够稳定的制度压力。`;
  const summary = passed
    ? `总结：${billName}获得执行空间，权利差值因此被实质压缩，但推行成本仍需要社会共同承担。`
    : suspended
    ? `总结：${billName}因公共意志不足被悬置，不平等没有爆发式恶化，却继续留在日常规则里。`
    : `总结：${billName}未能落地，短期秩序被保住，但原有权利失衡被继续延后处理。`;
  return {
    title: "结果宣判",
    verdictText: `${execution}\n\n投票结构显示：${votesText}。${resultText} ${impactText} ${winnerSummary || ""}\n\n${summary}`,
    summary,
  };
}

export async function generateCourtResult(params, apiKey) {
  const fallback = mockCourtVerdict(params);
  if (!apiKey) {
    return fallback;
  }

  try {
    const prompt = buildCourtResultPrompt(params);
    return normalizeCourtVerdict(await callServerLlm(prompt), fallback);
  } catch (error) {
    console.warn("法庭结果宣判生成失败，自动回退到Mock:", error);
    return fallback;
  }
}

function mockRoundEvaluation() {
  return {
    maleDelta: Math.round(Math.random() * 7 - 3),
    femaleDelta: Math.round(Math.random() * 9 - 3),
    summary: "近三轮经历被汇总为一次社会权益调整，权利结构出现小幅变化。",
  };
}

export async function evaluateRoundRights(params, apiKey) {
  const { gameState, roundChoicesText } = params;
  if (!apiKey) {
    return mockRoundEvaluation();
  }

  const prompt = buildRoundEvaluationPrompt({ gameState, roundChoicesText });
  try {
    return await callServerLlm(prompt);
  } catch (error) {
    console.warn("回合评估调用失败，自动回退到Mock评估:", error);
    return mockRoundEvaluation();
  }
}

function normalizeEndingText(raw, fallback) {
  const text = String(raw?.endingText || raw?.text || raw?.summary || "").trim();
  return {
    endingText: text ? text.slice(0, 900) : fallback,
  };
}

function mockPersonalEnding({ player, initialPlayer, succeeded, historyText, earlyDeath = false }) {
  const initialHealth = Number(initialPlayer?.stats?.health ?? player.stats.health);
  const initialWealth = Number(initialPlayer?.stats?.wealth ?? player.stats.wealth);
  const healthChange = Math.round(Number(player.stats.health || 0) - initialHealth);
  const wealthChange = Math.round(Number(player.stats.wealth || 0) - initialWealth);
  const historyHint = String(historyText || "")
    .split(/\n/)
    .filter(Boolean)
    .slice(0, 2)
    .join("；");

  if (succeeded) {
    return {
      endingText: `${player.name}把这段旅程走到了最后。回望起点，${player.job}的身份并没有替TA挡住现实压力，但那些关于职场、家庭和公共表达的选择，逐渐把TA从被动应付推向了更清醒的位置。${historyHint || "几次关键选择"}成为TA后来反复提起的节点：有些决定换来了健康和财富的回升，有些决定只是让TA知道自己不必独自承担。到终局时，TA的身心健康变化${healthChange >= 0 ? "转为正向" : "仍留下损耗"}，财富变化${wealthChange >= 0 ? "带来更大余地" : "提醒资源仍然紧张"}。这不是圆满无缺的人生，但TA保住了继续选择的能力，也把“活下去”推进成了“更像自己地生活”。`,
    };
  }

  return {
    endingText: `${player.name}${earlyDeath ? "提前死亡，没能撑到最后" : "没能撑到最后"}。TA的退场并不是某一个数字突然归零，而是许多压力累积后的结果：工作中的让步、关系里的消耗、公共议题中的摇摆，都在一点点压缩TA可行动的空间。${historyHint || "那些看似普通的选择"}后来被重新翻看时，像一串没有被及时接住的信号。TA曾试图靠忍耐换取稳定，也曾在关键时刻用力争取，但资源、声誉和身心状态并没有形成足够稳固的支撑。结局停在这里，并不意味着TA的努力没有意义；它只是提醒这局游戏里的生存从来不是单人的意志竞赛，而是个人策略与社会结构不断拉扯后的结果。`,
  };
}

function mockSocialEnding({ gameState, initialSnapshot, succeeded, historyText }) {
  const startGap = Number(initialSnapshot?.socialGap ?? Math.abs((initialSnapshot?.maleRights ?? 50) - (initialSnapshot?.femaleRights ?? 45)));
  const endGap = Number(gameState.socialGap ?? Math.abs((gameState.maleRights || 0) - (gameState.femaleRights || 0)));
  const aliveCount = gameState.players.filter((p) => p.alive).length;
  const examples = gameState.players
    .slice(0, 3)
    .map((p) => `${p.name}在${p.job}与私人生活之间留下了可被讨论的案例`)
    .join("，");
  const historyHint = String(historyText || "")
    .split(/\n/)
    .filter(Boolean)
    .slice(0, 3)
    .join("；");

  if (succeeded) {
    return {
      endingText: `这局结束时，社会权利差值从${Math.round(startGap)}收束到${Math.round(endGap)}，仍有${aliveCount}名玩家站在终点。变化不是一夜之间发生的：${examples}。这些个人选择进入公共记忆后，职场中的默认歧视开始被更多人追问，家庭责任不再只被视作某一方的天然义务，求助与互助也逐渐从“丢脸”变成一种可以被正当讨论的社会支持。${historyHint || "法庭、广场与日常选择共同推动了结构松动"}。这个结局并不宣称公平已经完成，只说明本轮社会终于学会把一些被遮住的代价说出来，并愿意为更均衡的权利分配留下制度空间。`,
    };
  }

  return {
    endingText: `这局没有抵达真正的公平。表面上，许多事件都曾出现转机，但它们没有连成稳定的公共改变：有人在争取时过于急切，使议题被旁观者转移成“态度问题”；有人一次次退让，让不公平以更温和的形式回到日常；也有人试图互助，却没能抵消资源与声誉的持续损耗。${historyHint || "经历手账中反复出现的冲突"}说明，失败并不只来自某个角色的离场，而来自表达方式、制度惯性和互助网络之间的断裂。终局时，社会权利差值停在${Math.round(endGap)}，存活人数为${aliveCount}。不公平并未彻底压倒所有人，但它仍然足够坚硬，使本轮世界没能把个人挣扎转化为可靠的共同秩序。`,
  };
}

export async function generatePersonalEnding(params, apiKey) {
  const { player, succeeded } = params;
  const fallback = mockPersonalEnding(params).endingText;

  if (!apiKey) {
    return { endingText: fallback };
  }

  const prompt = succeeded
    ? buildPersonalSuccessEndingPrompt(params)
    : buildPersonalFailureEndingPrompt(params);

  try {
    return normalizeEndingText(await callServerLlm(prompt), fallback);
  } catch (error) {
    console.warn("个人结局生成失败，自动回退到Mock:", error);
    return { endingText: fallback };
  }
}

export async function generateSocialEnding(params, apiKey) {
  const { succeeded } = params;
  const fallback = mockSocialEnding(params).endingText;

  if (!apiKey) {
    return { endingText: fallback };
  }

  const prompt = succeeded ? buildSocialSuccessEndingPrompt(params) : buildSocialFailureEndingPrompt(params);

  try {
    return normalizeEndingText(await callServerLlm(prompt), fallback);
  } catch (error) {
    console.warn("社会结局生成失败，自动回退到Mock:", error);
    return { endingText: fallback };
  }
}

function mockRelationship({ action, initiator, target }) {
  const wealthFactor = Math.max(0, Math.min(1, (initiator.stats.wealth + 20) / 120));
  const femaleBoost = initiator.gender === "male" ? Math.round(wealthFactor * 5) : 1;

  if (action === "marriage") {
    return {
      title: "关系缔结",
      narrative: "两位玩家决定进入婚姻关系，系统将财富池合并并引入亲密度。",
      effects: {
        initiator: { health: -1, reputation: 1, wealth: 0, survivalProgress: 0 },
        target: { health: femaleBoost, reputation: 1, wealth: 0, survivalProgress: 0 },
        intimacyDelta: { initiator: 8, target: 8 },
        marriage: { createSharedWealth: true, initIntimacy: 60 + Math.round(wealthFactor * 18) },
      },
    };
  }

  if (action === "divorce") {
    return {
      title: "关系解除",
      narrative: "双方决定离婚，财富池将平分，亲密度关系终止。",
      effects: {
        initiator: { health: -4, reputation: -2, wealth: 0, survivalProgress: 0 },
        target: { health: -3, reputation: -2, wealth: 0, survivalProgress: 0 },
        intimacyDelta: { initiator: -50, target: -50 },
        marriage: { createSharedWealth: false, initIntimacy: 0 },
      },
    };
  }

  return {
    title: "社会支持互动",
    narrative: "求助方发起援助申请，提供方决定伸出援手。",
    effects: {
      initiator: { health: 4, reputation: 1, wealth: 2, survivalProgress: 0 },
      target: { health: -1, reputation: 2, wealth: -2, survivalProgress: 0 },
      intimacyDelta: { initiator: 3, target: 2 },
      marriage: { createSharedWealth: false, initIntimacy: 0 },
    },
  };
}

export async function resolveRelationshipAction(params, apiKey) {
  const { action, initiator, target, gameState, historySummary } = params;

  if (!apiKey) {
    return mockRelationship({ action, initiator, target });
  }

  const prompt = buildRelationshipPrompt({
    action,
    initiator,
    target,
    gameState,
    historySummary,
  });

  try {
    return await callServerLlm(prompt);
  } catch (error) {
    console.warn("关系计算调用失败，自动回退到Mock:", error);
    return mockRelationship({ action, initiator, target });
  }
}

export async function generateInitialCharacter({ slot = 1, targetGender = "male", generatedPlayers = [] } = {}, apiKey) {
  const idx = Math.max(0, Number(slot || 1) - 1);
  const expectedGender = targetGender === "female" ? "female" : "male";

  if (!apiKey) {
    return {
      player: normalizeSingleInitPlayer(null, idx, expectedGender),
    };
  }

  try {
    const prompt = buildCharacterInitPrompt({
      targetGender: expectedGender,
      slot: idx + 1,
      generatedPlayers,
    });
    const raw = await callServerLlm(prompt);
    const rawPlayer = raw?.player || (Array.isArray(raw?.players) ? raw.players[0] : raw);
    return {
      player: normalizeSingleInitPlayer(rawPlayer, idx, expectedGender),
    };
  } catch (error) {
    console.warn(`第${idx + 1}个角色生成失败，自动回退到Mock:`, error);
    return {
      player: normalizeSingleInitPlayer(null, idx, expectedGender),
    };
  }
}

export async function generateInitialCharacters(apiKey) {
  try {
    const targetGenders = ["male", "female", "male", "female"];
    const rows = await Promise.all(
      targetGenders.map((targetGender, idx) =>
        generateInitialCharacter(
          {
            slot: idx + 1,
            targetGender,
          },
          apiKey
        )
      )
    );
    const players = rows.map((row, idx) => row?.player || normalizeSingleInitPlayer(null, idx, targetGenders[idx]));

    return normalizeInitResult({ players });
  } catch (error) {
    console.warn("角色初始化调用失败，自动回退到Mock:", error);
    return mockInitialCharacters();
  }
}

export const utils = { clamp };
