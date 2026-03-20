import {
  buildCourtPrompt,
  buildRelationshipPrompt,
  buildRoundEvaluationPrompt,
  buildScenePrompt,
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

async function callServerLlm(prompt) {
  const response = await fetch("/api/llm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`后端模型代理调用失败: ${response.status} ${errText}`);
  }

  const data = await response.json();
  if (!data?.ok) {
    throw new Error(data?.error || "后端模型代理返回失败");
  }
  return data.data;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function mockEvent({ scene, subScene, player, gameState }) {
  const sceneTag =
    scene === "workplace"
      ? "💼"
      : scene === "family"
      ? "🏠"
      : scene === "culture"
      ? "🗣️"
      : scene === "opportunity"
      ? "🎲"
      : "⚖️";

  const titles = {
    workplace: ["晋升评审争议", "绩效谈判拉扯", "育儿支持政策落地受阻"],
    family: ["家务分工冲突", "催婚压力与职业规划", "育儿责任归属争执"],
    culture: ["公共舆论争议", "知识澄清与立场拉扯", "网暴事件发酵"],
    opportunity: ["破局机会敲门", "援助资源释放", "命运交换提案"],
    court: ["法庭审议性别权利议题"],
  };

  const title = randomFrom(titles[scene] || titles.workplace);
  const riskBuff = player.stats.riskLevel === "high" ? 1.3 : player.stats.riskLevel === "mid" ? 1.1 : 0.9;
  const rightsBuff =
    player.stats.rightsLevel === "high" ? 1.25 : player.stats.rightsLevel === "mid" ? 1.05 : 0.85;

  const base = Math.round((Math.random() * 8 + 4) * riskBuff * rightsBuff);

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
          rightsLevelShift: 0,
          riskLevelShift: 1,
        },
        global: {
          socialGap: -Math.round(base * 0.5),
          maleRights: 1,
          femaleRights: 2,
          allHealthDelta: scene === "culture" && subScene === "square" ? -2 : 0,
        },
        meta: { survivalProgress: 4, equalityProgress: 8, major: true, tag: sceneTag },
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
          rightsLevelShift: 0,
          riskLevelShift: 0,
        },
        global: {
          socialGap: -1,
          maleRights: 1,
          femaleRights: 1,
          allHealthDelta: scene === "culture" && subScene === "square" ? -1 : 0,
        },
        meta: { survivalProgress: 2, equalityProgress: 2, major: false, tag: sceneTag },
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
          rightsLevelShift: -1,
          riskLevelShift: -1,
        },
        global: {
          socialGap: Math.round(base * 0.35),
          maleRights: 2,
          femaleRights: 0,
          allHealthDelta: scene === "culture" && subScene === "square" ? -3 : 0,
        },
        meta: { survivalProgress: -2, equalityProgress: -7, major: true, tag: sceneTag },
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

export async function generateSceneEvent(params, apiKey) {
  const { scene, subScene, player, gameState, historySummary } = params;

  if (!apiKey) {
    return mockEvent({ scene, subScene, player, gameState });
  }

  const prompt = buildScenePrompt({ scene, subScene, player, gameState, historySummary });
  try {
    return await callServerLlm(prompt);
  } catch (error) {
    console.warn("模型调用失败，自动回退到Mock事件:", error);
    return mockEvent({ scene, subScene, player, gameState });
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

function mockRoundEvaluation() {
  return {
    dimensions: {
      legal: Math.round(Math.random() * 2 - 1),
      economyEmployment: Math.round(Math.random() * 3 - 1),
      educationDevelopment: Math.round(Math.random() * 2 - 1),
      familyMarriage: Math.round(Math.random() * 3 - 1),
      healthSafety: Math.round(Math.random() * 3 - 1),
      socialVoice: Math.round(Math.random() * 3 - 1),
      riskBurdenSymmetry: Math.round(Math.random() * 3 - 1),
    },
    maleDelta: Math.round(Math.random() * 3 - 1),
    femaleDelta: Math.round(Math.random() * 5 - 2),
    summary: "本轮多起事件触发公众讨论，平等进展出现局部改善。",
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

function mockRelationship({ action, initiator, target }) {
  const wealthFactor = Math.max(0, Math.min(1, (initiator.stats.wealth + 20) / 120));
  const femaleBoost = initiator.gender === "male" ? Math.round(wealthFactor * 5) : 1;

  if (action === "marriage") {
    return {
      title: "关系缔结",
      narrative: "两位玩家决定进入婚姻关系，系统将财富池合并并引入亲密度。",
      effects: {
        initiator: { health: -1, reputation: 1, wealth: 0, survivalProgress: 1 },
        target: { health: femaleBoost, reputation: 1, wealth: 0, survivalProgress: 1 },
        global: { socialGap: -1, maleRights: 1, femaleRights: 1 },
        intimacyDelta: { initiator: 8, target: 8 },
        marriage: { createSharedWealth: true, initIntimacy: 60 + Math.round(wealthFactor * 18) },
      },
      tag: "💍",
    };
  }

  if (action === "divorce") {
    return {
      title: "关系解除",
      narrative: "双方决定离婚，财富池将平分，亲密度关系终止。",
      effects: {
        initiator: { health: -4, reputation: -2, wealth: 0, survivalProgress: -2 },
        target: { health: -3, reputation: -2, wealth: 0, survivalProgress: -1 },
        global: { socialGap: 1, maleRights: 0, femaleRights: 0 },
        intimacyDelta: { initiator: -50, target: -50 },
        marriage: { createSharedWealth: false, initIntimacy: 0 },
      },
      tag: "💔",
    };
  }

  return {
    title: "社会支持互动",
    narrative: "求助方发起援助申请，提供方决定伸出援手。",
    effects: {
      initiator: { health: 4, reputation: 1, wealth: 2, survivalProgress: 2 },
      target: { health: -1, reputation: 2, wealth: -2, survivalProgress: 0 },
      global: { socialGap: -1, maleRights: 0, femaleRights: 1 },
      intimacyDelta: { initiator: 3, target: 2 },
      marriage: { createSharedWealth: false, initIntimacy: 0 },
    },
    tag: "🤝",
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

export const utils = { clamp };
