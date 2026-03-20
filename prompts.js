export function buildCharacterInitPrompt() {
  return `你是桌游主持AI，请为一局4人角色扮演桌游生成初始角色（2男2女），输出严格JSON，不要附加解释。
输出格式:
{
  "players": [
    {
      "name": "",
      "gender": "male|female",
      "age": 0,
      "job": "",
      "bio": "80字内",
      "stats": {
        "health": 10-100,
        "reputation": -100~100,
        "wealth": 数值(万元，可负),
        "rightsLevel": "low|mid|high",
        "riskLevel": "low|mid|high"
      }
    }
  ]
}`;
}

export function buildScenePrompt({
  scene,
  subScene,
  player,
  gameState,
  historySummary,
}) {
  return `你是“天平叙事局”主持AI。请根据玩家当前状态生成一个事件和2-3个选项，必须输出严格JSON。

# 当前场景
scene: ${scene}
subScene: ${subScene || "none"}

# 当前玩家
name: ${player.name}
gender: ${player.gender}
age: ${player.age}
job: ${player.job}
bio: ${player.bio}
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}
rightsLevel: ${player.stats.rightsLevel}
riskLevel: ${player.stats.riskLevel}

# 游戏状态
round: ${gameState.round}
maxRound: ${gameState.maxRound}
currentGap: ${gameState.socialGap}
teamGoal: 社会权利差值<5
personalGoal: 生命或健康任一归零则失败

# 历史摘要(必须用于衔接剧情)
${historySummary}

# 生成要求
1) 事件必须与历史有关联：
- 若存在未结束主线，优先给出后续事件
- 若某线已结束，不可复用同构冲突
2) 事件要体现中国语境的性别议题现实矛盾
3) 选项数量2-3个，且立场有差异
4) 每个选项给出“数值变化JSON”，同时给“事件线更新”
5) 广场(scene=culture且subScene=square)的选项必须影响全体玩家health
6) 咨询室(scene=culture且subScene=counseling)仅在health<50可进入，恢复health要扣财富或名誉，且单角色最多3次

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
          "wealth": -2,
          "rightsLevelShift": -1,
          "riskLevelShift": 1
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
        "self":{"health":-2,"reputation":3,"wealth":0,"rightsLevelShift":0,"riskLevelShift":0},
        "global":{"socialGap":-3,"maleRights":1,"femaleRights":3,"allHealthDelta":-1},
        "meta":{"survivalProgress":2,"equalityProgress":9,"major":true,"tag":"⚖️"}
      }
    },
    {
      "id":"vote_b",
      "label":"维持现状",
      "description":"",
      "effects":{
        "self":{"health":0,"reputation":-2,"wealth":1,"rightsLevelShift":0,"riskLevelShift":1},
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

export function buildHistorySummary(events, playerId) {
  const recent = events.slice(0, 10);
  const unresolved = recent.filter((e) => e.thread && e.thread.status === "open");
  const mine = recent.filter((e) => e.playerId === playerId);

  const lines = [];
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
