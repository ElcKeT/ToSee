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

  return `你是社会性别议题文字桌游“天平叙事局”的角色生成器。当前任务是“分4轮生成角色中的第${
    generatedPlayers.length + 1
  }轮”。本轮只生成1名角色，输出严格JSON，不要解释文本。

固定硬性约束(每轮都必须遵守):
1) 本局总人数固定4人，最终必须2男2女
2) 本轮角色gender必须是: ${expectedGender}
3) 年龄必须在20~35之间
4) 初始状态全部为单身，禁止出现已婚/已有家庭(妻子/丈夫/儿子/女儿)
5) 角色社会条件不可极端悬殊，保持“普通人”尺度
6) bio不超过80字
7) 必须与已生成角色形成明显差异，避免同质化

多轮对话历史(用于去重与差异化):
[assistant历史输出角色]
${historyLines}

[assistant本轮生成要求]
- 不得与历史角色在“职业+阶层+家庭+核心价值观+立场”上高度重合
- 名字不能与历史重复
- 冲突槽位、关键经历、欲望困境要换角度

本轮角色必须包含:
- 基本信息: gender、age、job、cityTier、classLevel
- 家庭与代际: familyRelation(主要是上一代关系)
- 关键经历: keyEvents(2-3条)
- 价值观: values(家庭婚姻/公平责任自由/制度改革态度)
- 身份与权力: socialRole、powerFeeling
- 欲望与困境: desireAndPressure
- 冲突槽位: conflictHooks(至少1条)
- 游戏字段: stance(左/中/右), rightsLevel(low/mid/high), riskLevel(low/mid/high)
- 个人存活任务: survivalTask

权利指数与风险等级定义(必须遵守):
1) rightsLevel: low=0.6倍, mid=1.0倍, high=1.5倍
2) riskLevel: low=0.6倍, mid=1.0倍, high=1.5倍
3) 结合职业、阶层、家庭处境、社会支持网络给出合理等级，不要机械平均

数值约束:
- health: 10~100
- reputation: -100~100
- wealth(万元): -30~150
- survivalProgress: 35~80

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
      "wealth": 24,
      "rightsLevel": "mid",
      "riskLevel": "high"
    },
    "survivalProgress": 62
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

  return `你是“天平叙事局”主持AI。请根据玩家当前状态生成一个事件和2-3个选项，必须输出严格JSON。

# 当前场景
scene: ${scene}
subScene: ${subScene || "none"}

# 当前玩家
name: ${player.name}
gender: ${player.gender}
relationshipStatus: ${relationshipStatus}
age: ${player.age}
job: ${player.job}
cityTier: ${player.cityTier || "unknown"}
classLevel: ${player.classLevel || "unknown"}
bio: ${player.bio}
familyRelation: ${player.familyRelation || ""}
keyEvents: ${(player.keyEvents || []).join(" | ")}
values: familyMarriage=${player.values?.familyMarriage || "mixed"}, fairness=${player.values?.fairness || "opportunity"}, reform=${player.values?.reform || "moderate"}
socialRole: ${player.socialRole || ""}
powerFeeling: ${player.powerFeeling || "balanced"}
desireAndPressure: ${player.desireAndPressure || ""}
conflictHooks: ${(player.conflictHooks || []).join(" | ")}
stance: ${player.stance || "center"}
survivalTask: ${player.survivalTask || ""}
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}
rightsLevel: ${player.stats.rightsLevel}
riskLevel: ${player.stats.riskLevel}

# 指数倍率规则(必须遵守)
rightsLevel倍率: low=0.6, mid=1.0, high=1.5
riskLevel倍率: low=0.6, mid=1.0, high=1.5
对前三个核心数值 health/reputation/wealth 的变化，需体现上述指数倍率影响。

# 游戏状态
round: ${gameState.round}
maxRound: ${gameState.maxRound}
currentGap: ${gameState.socialGap}
teamGoal: 社会权利差值<5
personalGoal: 生命或健康任一归零则失败

# 历史摘要(必须用于衔接剧情)
${historySummary}

# 预选问题类型(必须从中选1-2个作为本次核心冲突)
${topicHints}

# 生成要求
1) 事件必须与历史有关联：
- 若存在未结束主线，优先给出后续事件
- 若某线已结束，不可复用同构冲突
2) 事件要体现中国语境的性别议题现实矛盾
3) 选项数量2-3个，且立场有差异
4) 每个选项给出“数值变化JSON”，同时给“事件线更新”
5) 广场(scene=culture且subScene=square)的选项必须影响全体玩家health
6) 咨询室(scene=culture且subScene=counseling)仅在health<50可进入，恢复health要扣财富或名誉，且单角色最多3次
7) wealth单位是“万元”，必须符合现实尺度：
- 普通事件(职场/家庭/图书馆/社交广场/咨询室)单次wealth变动建议在 -1.5~+1.5 之间
- 人生机遇/法庭/PVP等重大事件可放宽到 -8~+8
- 严禁出现“因为一件小事损失1万元以上且无重大背景说明”的不合理结果
8) 选项效果必须兼顾短期生存与长期平等，不得全部同方向增减
9) 叙事风格聚焦中国语境下“普通人日常矛盾”，避免极端化、奇观化设定
10) 若历史中没有与他人建立PVP关系，不要引入其他玩家的私密经历线；可出现公共新闻/公共议题但不要写成熟人线
11) 当relationshipStatus=married时，禁止使用“催婚/相亲/婚房压力/是否结婚”等单身阶段议题；家庭场景应优先从“家务分配/责任分配/财务分配/育儿参与/代际边界”中组织冲突
12) 当scene=culture且subScene=counseling时：每个选项必须是“付出代价换健康恢复”，即self.health必须>0，且self.wealth<0或self.reputation<0至少满足一个；禁止出现self.health<=0的选项

# 输出JSON格式
{
  "eventId": "evt_xxx",
  "thread": {
    "threadId": "thr_xxx",
    "status": "open|closed",
    "summary": "事件线变化一句话"
  },
  "title": "",
  "narrative": "",
  "options": [
    {
      "id": "opt_a",
      "label": "",
      "description": "",
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
          "survivalProgress": 6,
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

  return `你是“天平叙事局”文化广场主持AI。请生成“架空世界中的公共争议事件”，并给出2-3个讨论立场选项。输出严格JSON。

# 场景定位
scene: culture
subScene: square
定位: 公共议题讨论区（事件主角不是当前玩家）

# 当前玩家(仅用于结算，不用于故事主角)
name: ${player.name}
gender: ${player.gender}
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}
rightsLevel: ${player.stats.rightsLevel}
riskLevel: ${player.stats.riskLevel}

# 游戏状态
round: ${gameState.round}
currentGap: ${gameState.socialGap}

# 可见历史(仅用于连续性，不要把当前玩家写成事件当事人)
${historySummary}

# 预选问题类型(必须从中选1-2个)
${topicHints}

# 生成要求
1) 事件必须是“社会真实争议”的架空化改写，可映射现实，但不得直接点名现实个人
2) 事件中的当事人应为虚构人物/群体，不是当前玩家
3) 选项是“参与讨论的立场选择”，要有明显分歧与后果
4) 所有选项仍需给出对当前玩家的数值影响(self)与全局影响(global)
5) 广场事件必须对全体玩家健康产生联动(global.allHealthDelta 非0)
6) wealth单位是万元，广场单次波动建议在 -1.5~+1.5 内
7) 不要输出“不参与讨论”选项，该选项由前端固定追加

# 输出JSON格式
{
  "eventId": "evt_xxx",
  "thread": {
    "threadId": "thr_xxx",
    "status": "open|closed",
    "summary": "事件线变化一句话"
  },
  "title": "",
  "narrative": "",
  "options": [
    {
      "id": "opt_a",
      "label": "",
      "description": "",
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
          "survivalProgress": 2,
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

  return `你是“天平叙事局”图书馆主持AI。请生成“架空世界中的知识科普与观念铺垫事件”，并给出2-3个学习/实践选项。输出严格JSON。

# 场景定位
scene: culture
subScene: library
定位: 认知提升区（非激烈冲突，非撕裂对立）

# 当前玩家(用于个性化知识，不作为冲突当事人)
name: ${player.name}
gender: ${player.gender}
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}
rightsLevel: ${player.stats.rightsLevel}
riskLevel: ${player.stats.riskLevel}
relationshipStatus: ${player.marriedTo ? "married" : "single"}

# 游戏状态
round: ${gameState.round}
currentGap: ${gameState.socialGap}

# 可见历史(仅用于连续性，不要写成个人苦难回溯)
${historySummary}

# 知识主题提示(必须从中选1-2个)
${topicHints}

# 生成要求
1) 事件必须是架空场景，不直接绑定当前玩家个人经历，不写激烈冲突
2) 内容基调: 知识科普、观念铺垫、沟通技能、法律常识、心理韧性
3) 适配所有人设: 兼顾不同性别与婚恋状态的认知需求
4) 选项是“学习路径/实践方式”差异，不是立场对骂
5) 整体收益应偏正向：
- self.health 建议 +2~+5
- self.reputation 建议 0~+2
- self.wealth 建议 -1.5~0
- meta.survivalProgress 建议 +1~+4
- meta.equalityProgress 建议 +1~+4
6) global.allHealthDelta 固定为0（图书馆不做全员健康联动）
7) 不输出“不参与”选项

# 输出JSON格式
{
  "eventId": "evt_xxx",
  "thread": {
    "threadId": "thr_xxx",
    "status": "open|closed",
    "summary": "事件线变化一句话"
  },
  "title": "",
  "narrative": "",
  "options": [
    {
      "id": "opt_a",
      "label": "",
      "description": "",
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
          "survivalProgress": 2,
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

  return `你是“天平叙事局”咨询室主持AI。请生成“付出代价换取身心修复”的低冲突事件，并给出2-3个干预选项。输出严格JSON。

# 场景定位
scene: culture
subScene: counseling
定位: 心理支持与现实协商区（不做激烈冲突叙事）

# 当前玩家
name: ${player.name}
gender: ${player.gender}
relationshipStatus: ${player.marriedTo ? "married" : "single"}
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}
rightsLevel: ${player.stats.rightsLevel}
riskLevel: ${player.stats.riskLevel}

# 游戏状态
round: ${gameState.round}
currentGap: ${gameState.socialGap}

# 可见历史
${historySummary}

# 干预主题提示(必须从中选1-2个)
${topicHints}

# 强制生成要求
1) 咨询室是修复板块，所有选项都必须让self.health为正数(建议+4~+12)
2) 每个选项都必须有代价：self.wealth<0 或 self.reputation<0，至少一个为负
3) wealth单位是万元，咨询室单次财富代价建议 -0.5~-2
4) 不要让global.allHealthDelta影响全体，固定为0
5) 选项差异体现在“恢复幅度-代价结构”不同，而不是冲突立场
6) meta.survivalProgress 应该为正(建议+1~+6)
7) 不输出“不参与”选项

# 输出JSON格式
{
  "eventId": "evt_xxx",
  "thread": {
    "threadId": "thr_xxx",
    "status": "open|closed",
    "summary": "事件线变化一句话"
  },
  "title": "",
  "narrative": "",
  "options": [
    {
      "id": "opt_a",
      "label": "",
      "description": "",
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
          "survivalProgress": 3,
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
    return `scene=culture/${key}; topics=${list.join("、")}`;
  }

  const g = gender === "female" ? "female" : "male";
  const rs = relationshipStatus === "married" ? "married" : "single";
  const list = pool[scene]?.[rs]?.[g] || ["职场公平", "家庭分工", "公共争议"];
  return `scene=${scene}; relationship=${rs}; gender=${g}; topics=${list.join("、")}`;
}

export function buildCourtPrompt({ gameState, historySummary }) {
  return `你是“天平叙事局”法庭主持AI。请生成当轮法庭议题与2个投票选项，输出严格JSON。

round: ${gameState.round}
currentGap: ${gameState.socialGap}
历史摘要:
${historySummary}

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
      "effects":{
        "self":{"health":-2,"reputation":3,"wealth":0},
        "global":{"socialGap":-3,"maleRights":1,"femaleRights":3,"allHealthDelta":-1},
        "meta":{"survivalProgress":2,"equalityProgress":9,"major":true,"tag":"⚖️"}
      }
    },
    {
      "id":"vote_b",
      "label":"维持现状",
      "description":"",
      "effects":{
        "self":{"health":0,"reputation":-2,"wealth":1},
        "global":{"socialGap":2,"maleRights":1,"femaleRights":0,"allHealthDelta":0},
        "meta":{"survivalProgress":-2,"equalityProgress":-6,"major":true,"tag":"⚖️"}
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
  return `你是“天平叙事局”关系系统AI，负责计算PVP互动的数值变化。输出严格JSON。

action: ${action}
round: ${gameState.round}

initiator:
name: ${initiator.name}
gender: ${initiator.gender}
wealth: ${initiator.stats.wealth}
health: ${initiator.stats.health}
reputation: ${initiator.stats.reputation}
rightsLevel: ${initiator.stats.rightsLevel}
riskLevel: ${initiator.stats.riskLevel}

target:
name: ${target.name}
gender: ${target.gender}
wealth: ${target.stats.wealth}
health: ${target.stats.health}
reputation: ${target.stats.reputation}
rightsLevel: ${target.stats.rightsLevel}
riskLevel: ${target.stats.riskLevel}

历史摘要:
${historySummary}

规则强调:
1) 结婚收益与双方资源强相关，若男方财富低，不应让女方健康提升过大
2) 结婚后双方财富进入共享池，离婚后对半分
3) 结婚后新增 intimacy(0-100)
4) 每次关系事件可对 intimacy 产生升降

输出JSON:
{
  "title": "",
  "narrative": "",
  "effects": {
    "initiator": {"health": -2, "reputation": 1, "wealth": -1, "survivalProgress": 2},
    "target": {"health": 1, "reputation": 0, "wealth": 1, "survivalProgress": 1},
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

  lines.push("当前玩家近3次关键选择:");
  mine.slice(0, 3).forEach((e, i) => {
    lines.push(`${i + 1}. ${e.title} -> ${e.choiceLabel}`);
  });

  if (lines.length < 3) {
    lines.push("暂无足够历史，创建首轮冲突但需可持续展开");
  }

  return lines.join("\n");
}
