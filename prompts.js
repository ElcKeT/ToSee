export function buildCharacterInitPrompt({ targetGender, generatedPlayers = [] } = {}) {
  const historyLines = generatedPlayers.length
    ? generatedPlayers
        .map(
          (p, idx) =>
            `${idx + 1}. ${p.name || "未命名"} | ${p.gender} | ${p.age}岁 | ${p.job} | ${p.classLevel} | stance=${p.stance}`
        )
        .join("\n")
    : "(无，当前是首个角色)";

  const expectedGender = targetGender === "female" ? "female" : "male";

  return `你是选择驱动的性别平等文字游戏“天平叙事局”的角色生成器。当前任务是“分4轮生成角色中的第${
    generatedPlayers.length + 1
  }轮”。本轮只生成1名角色，输出严格JSON。

硬性约束:
1) 本局总人数固定4人，最终必须2男2女
2) 本轮角色gender必须是: ${expectedGender}
3) 年龄必须在20~35之间
4) 初始状态全部为单身，禁止出现已婚/已有家庭(妻子/丈夫/儿子/女儿)
5) 角色社会条件保持普通人尺度，不写极端悬殊或猎奇背景
6) bio不超过80字

已生成角色(用于差异化):
${historyLines}

本轮重点:
- 与历史角色在职业、阶层、家庭关系、价值观和冲突槽位上拉开差异
- 写出可持续触发事件的欲望、压力和矛盾，不要只写标签
- stats只包含 health、reputation、wealth

数值约束:
- health: 10~100
- reputation: -100~100
- wealth(万元): -30~150

输出JSON格式(只输出1个角色):
{
  "player": {
    "name": "",
    "gender": "male|female",
    "age": 0,
    "job": "",
    "cityTier": "",
    "classLevel": "",
    "bio": "80字内",
    "familyRelation": "",
    "keyEvents": ["", ""],
    "values": {
      "familyMarriage": "traditional|autonomous|mixed",
      "fairness": "result|opportunity|freedom",
      "reform": "radical|moderate|skeptical"
    },
    "socialRole": "",
    "powerFeeling": "dominant|passive|balanced|imbalanced",
    "desireAndPressure": "",
    "conflictHooks": [""],
    "stance": "left|center|right",
    "survivalTask": "",
    "stats": {
      "health": 72,
      "reputation": -10,
      "wealth": 24
    }
  }
}`;
}

export function buildScenePrompt({
  scene,
  subScene,
  player,
  gameState,
  historySummary,
}) {
  const relationshipStatus = player.marriedTo ? "married" : "single";
  const topicHints = buildTopicHints({
    scene,
    subScene,
    relationshipStatus,
    gender: player.gender,
  });

  return `你是“天平叙事局”的剧情主持AI。游戏是选择驱动的性别平等文字游戏。请为当前玩家生成一个事件和2-3个选项，输出严格JSON。

# 场景
${scene}${subScene ? `/${subScene}` : ""}
主题: ${topicHints}

# 当前玩家
name: ${player.name}
gender: ${player.gender}
relationshipStatus: ${relationshipStatus}
job: ${player.job}
cityTier: ${player.cityTier || "unknown"}
classLevel: ${player.classLevel || "unknown"}
bio: ${player.bio}
familyRelation: ${player.familyRelation || ""}
keyEvents: ${(player.keyEvents || []).join(" | ")}
values: familyMarriage=${player.values?.familyMarriage || "mixed"}, fairness=${player.values?.fairness || "opportunity"}, reform=${player.values?.reform || "moderate"}
desireAndPressure: ${player.desireAndPressure || ""}
conflictHooks: ${(player.conflictHooks || []).join(" | ")}
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}

# 游戏状态
round: ${gameState.round}

# 历史摘要
${historySummary}

# 生成要求
1) 若历史中有open事件线，优先延续；若已closed，避免复刻同构冲突。
2) 写普通人日常中的现实性别矛盾，具体到场景、关系和制度压力，避免奇观化。
3) 选项必须形成真实取舍：至少一个偏自保、一个偏争取公平；不要出现所有核心数值同涨或同跌。
4) self只填基础 health/reputation/wealth 变化，wealth单位为万元；普通事件 wealth 建议在 -1.5~+1.5 内。
5) 每个选项都写 summary：人物+处境+选择+意义的1句话，用于经历手账。
6) 每个选项都写 thread：该选项发生后的故事线状态和下一步悬念；若冲突已解决可closed。

# 输出JSON格式
{
  "eventId": "evt_xxx",
  "thread": {
    "threadId": "thr_xxx",
    "status": "open|closed",
    "summary": "本事件线的核心悬念"
  },
  "title": "",
  "narrative": "",
  "options": [
    {
      "id": "opt_a",
      "label": "",
      "description": "",
      "summary": "林晓梅在职场选拔中据理力争，争取未婚未育女性公平竞争的权利。",
      "thread": {
        "status": "open|closed",
        "summary": "申诉已提交，院领导是否启动公平复核仍未确定。"
      },
      "effects": {
        "self": {
          "health": -10,
          "reputation": 5,
          "wealth": -2
        },
        "global": {
          "socialGap": -2,
          "maleRights": 1,
          "femaleRights": 2,
          "allHealthDelta": -3
        },
        "meta": {
          "equalityProgress": 8,
          "major": true,
          "tag": "💼"
        }
      }
    }
  ]
}`;
}

export function buildCultureSquarePrompt({ player, gameState, historySummary }) {
  const topicHints = buildTopicHints({
    scene: "culture",
    subScene: "square",
    relationshipStatus: player.marriedTo ? "married" : "single",
    gender: player.gender,
  });

  return `你是“天平叙事局”文化广场主持AI。请生成一个架空公共争议事件和2-3个讨论立场选项，输出严格JSON。

# 场景
culture/square
主题: ${topicHints}
定位: 公共议题讨论区，事件主角不是当前玩家

# 当前玩家(用于决定讨论视角，不写成事件当事人)
name: ${player.name}
gender: ${player.gender}
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}

# 游戏状态
round: ${gameState.round}

# 可见历史
${historySummary}

# 生成要求
1) 架空化改写真实社会争议，不直接点名现实个人。
2) 选项是参与讨论的不同立场，必须有分歧、代价和公共影响。
3) 不要输出“不参与讨论”选项，程序会固定追加。
4) self只填基础 health/reputation/wealth；wealth建议在 -1.5~+1.5 内。
5) 选项不要全部同向增减；立场越激烈，短期压力通常越高。
6) 每个选项写 summary，用一句话概括玩家如何参与公共讨论及其意义。
7) 每个选项写 thread，说明该公共议题在选择后的发酵状态。

# 输出JSON格式
{
  "eventId": "evt_xxx",
  "thread": {
    "threadId": "thr_xxx",
    "status": "open|closed",
    "summary": "公共争议的核心悬念"
  },
  "title": "",
  "narrative": "",
  "options": [
    {
      "id": "opt_a",
      "label": "",
      "description": "",
      "summary": "李航在公共争议中支持明确问责，让职场性别歧视被更多人看见。",
      "thread": {
        "status": "open|closed",
        "summary": "舆论开始转向制度责任，但反弹声音仍在扩大。"
      },
      "effects": {
        "self": {
          "health": -5,
          "reputation": 3,
          "wealth": 0
        },
        "global": {
          "socialGap": -1,
          "maleRights": 1,
          "femaleRights": 1,
          "allHealthDelta": -2
        },
        "meta": {
          "equalityProgress": 4,
          "major": true,
          "tag": "🗣️"
        }
      }
    }
  ]
}`;
}

export function buildCultureLibraryPrompt({ player, gameState, historySummary }) {
  const topicHints = buildTopicHints({
    scene: "culture",
    subScene: "library",
    relationshipStatus: player.marriedTo ? "married" : "single",
    gender: player.gender,
  });

  return `你是“天平叙事局”图书馆主持AI。请生成一个知识学习/实践事件和2-3个选项，输出严格JSON。

# 场景
culture/library
主题: ${topicHints}
定位: 认知提升区，低冲突、重方法

# 当前玩家
name: ${player.name}
gender: ${player.gender}
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}
relationshipStatus: ${player.marriedTo ? "married" : "single"}

# 游戏状态
round: ${gameState.round}

# 可见历史
${historySummary}

# 生成要求
1) 写成具体学习/练习场景，不写激烈冲突或立场对骂。
2) 选项是不同学习路径或实践方式，差异体现在成本、收益和适用场景。
3) 整体偏正向，但仍要有代价；self.health +2~+5，self.reputation 0~+2，self.wealth -1.5~0。
4) 每个选项写 summary，概括玩家获得了什么方法或认知。
5) 每个选项写 thread；图书馆通常可closed，除非明显引出后续实践。

# 输出JSON格式
{
  "eventId": "evt_xxx",
  "thread": {
    "threadId": "thr_xxx",
    "status": "open|closed",
    "summary": "学习主题或后续实践悬念"
  },
  "title": "",
  "narrative": "",
  "options": [
    {
      "id": "opt_a",
      "label": "",
      "description": "",
      "summary": "林晓梅通过权益速查卡整理申诉材料，为后续职场协商补上了法律依据。",
      "thread": {
        "status": "closed",
        "summary": "本次学习已转化为可执行的沟通清单。"
      },
      "effects": {
        "self": {
          "health": 3,
          "reputation": 1,
          "wealth": -1
        },
        "global": {
          "socialGap": -1,
          "maleRights": 0,
          "femaleRights": 1,
          "allHealthDelta": 0
        },
        "meta": {
          "equalityProgress": 3,
          "major": false,
          "tag": "📚"
        }
      }
    }
  ]
}`;
}

export function buildCultureCounselingPrompt({ player, gameState, historySummary }) {
  const topicHints = buildTopicHints({
    scene: "culture",
    subScene: "counseling",
    relationshipStatus: player.marriedTo ? "married" : "single",
    gender: player.gender,
  });

  return `你是“天平叙事局”咨询室主持AI。请生成一个付出代价换取身心修复的低冲突事件和2-3个干预选项，输出严格JSON。

# 场景
culture/counseling
主题: ${topicHints}
定位: 心理支持与现实协商区

# 当前玩家
name: ${player.name}
gender: ${player.gender}
relationshipStatus: ${player.marriedTo ? "married" : "single"}
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}

# 游戏状态
round: ${gameState.round}

# 可见历史
${historySummary}

# 生成要求
1) 所有选项 self.health 必须为正数，建议 +4~+12。
2) 每个选项必须有代价：self.wealth<0 或 self.reputation<0，至少一个为负；wealth建议 -0.5~-2。
3) 选项差异体现在恢复幅度、代价结构和行动建议，不写冲突对骂。
4) 每个选项写 summary，概括玩家如何修复状态并付出何种代价。
5) 每个选项写 thread；修复行动通常closed，若引出关系沟通可open。

# 输出JSON格式
{
  "eventId": "evt_xxx",
  "thread": {
    "threadId": "thr_xxx",
    "status": "open|closed",
    "summary": "修复主题或后续沟通悬念"
  },
  "title": "",
  "narrative": "",
  "options": [
    {
      "id": "opt_a",
      "label": "",
      "description": "",
      "summary": "林晓梅用一次高强度咨询稳住情绪，也为继续面对职场申诉付出了经济成本。",
      "thread": {
        "status": "closed",
        "summary": "本次情绪危机已缓解，下一步回到现实协商。"
      },
      "effects": {
        "self": {
          "health": 6,
          "reputation": -1,
          "wealth": -1
        },
        "global": {
          "socialGap": 0,
          "maleRights": 0,
          "femaleRights": 0,
          "allHealthDelta": 0
        },
        "meta": {
          "equalityProgress": 1,
          "major": false,
          "tag": "🛋️"
        }
      }
    }
  ]
}`;
}

function buildTopicHints({ scene, subScene, relationshipStatus, gender }) {
  const pool = {
    workplace: {
      single: {
        female: ["生育歧视", "性别刻板印象", "职场公平", "性骚扰", "同工同酬"],
        male: ["养家压力", "陪产假落实", "同工同酬", "隐性歧视", "晋升公平"],
      },
      married: {
        female: ["育儿晋升冲突", "岗位边缘化", "家庭职场平衡", "同工同酬", "隐性歧视"],
        male: ["照料责任与绩效", "陪产假执行", "家庭职场平衡", "加班文化", "岗位公平"],
      },
    },
    family: {
      single: {
        female: ["恋爱自由", "催婚", "原生家庭控制", "经济独立", "亲密关系边界"],
        male: ["催婚", "婚房压力", "原生家庭期待", "情感表达压力", "责任分配预期"],
      },
      married: {
        female: ["家务分配", "责任分配", "财务分配", "生育选择", "育儿分工"],
        male: ["家务分配", "责任分配", "财务分配", "育儿参与", "代际边界"],
      },
    },
    culture: {
      library: ["性别平等知识", "法律常识", "沟通策略", "心理韧性", "职业与家庭协商"],
      square: ["彩礼问题", "性别歧视", "上交工资", "婚内强迫", "舆论双标", "网络性别暴力"],
      counseling: ["压力识别", "情绪调节", "边界建立", "现实协商", "恢复代价取舍"],
    },
  };

  if (scene === "culture") {
    const key = subScene || "square";
    const list = pool.culture[key] || pool.culture.square;
    return pickTopics(list).join("、");
  }

  const g = gender === "female" ? "female" : "male";
  const rs = relationshipStatus === "married" ? "married" : "single";
  const list = pool[scene]?.[rs]?.[g] || ["职场公平", "家庭分工", "公共争议"];
  return pickTopics(list).join("、");
}

function pickTopics(list, count = 2) {
  const source = Array.isArray(list) ? list.filter(Boolean) : [];
  if (source.length <= count) return source;
  const picked = new Set();
  while (picked.size < count) {
    picked.add(source[Math.floor(Math.random() * source.length)]);
  }
  return Array.from(picked);
}

export function buildCourtPrompt({ gameState, historySummary }) {
  return `你是“天平叙事局”法庭主持AI。请生成一个公共规则争议和2个投票选项，输出严格JSON。

round: ${gameState.round}
历史摘要:
${historySummary}

生成要求:
1) 议题要和性别平等的制度规则有关，例如就业、家庭责任、公共表达、健康安全。
2) 两个投票选项必须代表不同制度方向，不能只是措辞差异。
3) self只填基础 health/reputation/wealth；全局变化体现规则通过后的社会影响。
4) 每个选项写 summary，概括法庭投票造成的制度后果。

输出JSON:
{
  "eventId":"court_xxx",
  "title":"",
  "narrative":"",
  "options":[
    {
      "id":"vote_a",
      "label":"通过改革",
      "description":"",
      "summary":"法庭通过改革方案，让育儿责任不再默认压到女性一方。",
      "effects":{
        "self":{"health":-2,"reputation":3,"wealth":0},
        "global":{"socialGap":-3,"maleRights":1,"femaleRights":3,"allHealthDelta":-1},
        "meta":{"equalityProgress":9,"major":true,"tag":"⚖️"}
      }
    },
    {
      "id":"vote_b",
      "label":"维持现状",
      "description":"",
      "summary":"法庭维持现状，短期减少争执，却让家庭责任的不均衡继续存在。",
      "effects":{
        "self":{"health":0,"reputation":-2,"wealth":1},
        "global":{"socialGap":2,"maleRights":1,"femaleRights":0,"allHealthDelta":0},
        "meta":{"equalityProgress":-6,"major":true,"tag":"⚖️"}
      }
    }
  ]
}`;
}

export function buildRoundEvaluationPrompt({ gameState, roundChoicesText }) {
  return `你是“天平叙事局”的回合结算AI。请根据本轮全部玩家选择，评估社会权利7维变化，输出严格JSON。

当前回合: ${gameState.round}
当前社会权利差值: ${gameState.socialGap}

本轮行为记录:
${roundChoicesText}

输出要求:
1) dimensions 对7个维度分别给出 -6~+6 的整数增量
2) maleDelta 和 femaleDelta 为本轮性别权益总变化（-8~+8）
3) summary 用1-2句话总结本轮平等进展

输出JSON:
{
  "dimensions": {
    "legal": -1,
    "economyEmployment": 2,
    "educationDevelopment": 1,
    "familyMarriage": -2,
    "healthSafety": 0,
    "socialVoice": 1,
    "riskBurdenSymmetry": -1
  },
  "maleDelta": 1,
  "femaleDelta": 3,
  "summary": ""
}`;
}

export function buildRelationshipPrompt({
  action,
  initiator,
  target,
  gameState,
  historySummary,
}) {
  return `你是“天平叙事局”关系系统AI，负责生成玩家关系互动叙事和基础数值变化。输出严格JSON。

action: ${action}
round: ${gameState.round}

initiator:
name: ${initiator.name}
gender: ${initiator.gender}
wealth: ${initiator.stats.wealth}
health: ${initiator.stats.health}
reputation: ${initiator.stats.reputation}

target:
name: ${target.name}
gender: ${target.gender}
wealth: ${target.stats.wealth}
health: ${target.stats.health}
reputation: ${target.stats.reputation}

历史摘要:
${historySummary}

规则强调:
1) 结婚收益与双方资源强相关，若男方财富低，不应让女方健康提升过大
2) 结婚后双方财富进入共享池，离婚后对半分
3) 结婚后新增 intimacy(0-100)
4) 每次关系事件可对 intimacy 产生升降
5) initiator/target 只生成基础 health/reputation/wealth 变化
6) 写 summary，用一句话概括双方互动的故事结果

输出JSON:
{
  "title": "",
  "narrative": "",
  "summary": "林晓梅向李航申请支持，双方把职场申诉变成一次具体的互助行动。",
  "effects": {
    "initiator": {"health": -2, "reputation": 1, "wealth": -1},
    "target": {"health": 1, "reputation": 0, "wealth": 1},
    "global": {"socialGap": -1, "maleRights": 1, "femaleRights": 1},
    "intimacyDelta": {"initiator": 6, "target": 4},
    "marriage": {"createSharedWealth": true, "initIntimacy": 62}
  },
  "tag": "💍"
}`;
}

export function buildHistorySummary(events, playerId, gameState = null) {
  const recent = events.slice(0, 20);
  const linked = new Set([playerId]);

  const fromState = gameState?.acquaintances?.[playerId] || [];
  fromState.forEach((id) => linked.add(id));

  recent.forEach((e) => {
    const ids = Array.isArray(e.relatedPlayerIds) ? e.relatedPlayerIds : [];
    if (ids.includes(playerId)) {
      ids.forEach((id) => linked.add(id));
    }
  });

  const visible = recent.filter((e) => {
    if (!e) return false;
    if (linked.has(e.playerId)) return true;
    const ids = Array.isArray(e.relatedPlayerIds) ? e.relatedPlayerIds : [];
    return ids.some((id) => linked.has(id));
  });

  const unresolved = visible.filter((e) => e.thread && e.thread.status === "open");
  const mine = visible.filter((e) => e.playerId === playerId);

  const lines = [];
  lines.push(`可见关系圈: ${Array.from(linked).join(",")}`);
  lines.push(`未结束事件线数量: ${unresolved.length}`);
  unresolved.slice(0, 4).forEach((e, i) => {
    lines.push(
      `${i + 1}. [open] ${e.thread.threadId}: ${e.thread.summary} (round ${e.round})`
    );
  });

  lines.push("当前玩家近3次选择结果:");
  mine.slice(0, 3).forEach((e, i) => {
    const status = e.thread?.status ? ` [${e.thread.status}]` : "";
    lines.push(`${i + 1}.${status} ${e.summary || `${e.title} -> ${e.choiceLabel || "未知选择"}`}`);
  });

  if (lines.length < 3) {
    lines.push("暂无足够历史，创建首轮冲突但需可持续展开");
  }

  return lines.join("\n");
}
