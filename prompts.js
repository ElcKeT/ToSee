export function buildCharacterCohortPrompt() {
  return `《看见》是一款大模型驱动的性别平等选择游戏，玩家将在普通人的生活、职场、家庭和公共议题中做出选择。
当前任务是先为本局4人生成“同一生活世界”的基础设定。输出严格JSON。

生成逻辑:
1) 先确定四人共同所属的社会圈层，再在圈层内部制造个体差异，只生成基础设定。
2) 四人必须属于相近社会阶层，保持接近的教育水平、收入水平、城市等级、消费能力、社会认知和生活方式。
3) 不允许出现明显阶层跨度过大的组合，例如金融精英与农村贫困劳动者同组、海外高知家庭与底层留守家庭同组。
4) 可选社会圈层包括：县城青年圈、二三线城市普通工薪圈、小城小康家庭圈、一线城市互联网白领圈、城市新中产圈、流动务工群体、下沉市场青年群体。
5) 四人固定**2男2女**，年龄18-36岁，初始状态全部单身，禁止出现已婚/已有子女。
6) 四人姓名不能重复，职业不能完全重复；必须有性格、性别处境、婚恋观、未来态度和内在矛盾差异。
7) 角色要符合中国当代社会现实，避免悬浮、爽文感、偶像剧化和标签化。
8) roles数组必须正好4个对象，slot为1、2、3、4。


输出JSON格式，大部分以自然语言描述即可:
{
  "cohort": {
    "cityTier": "可能的城市层级",
    "classLevel": "选择一个社会圈层",
    "educationLevel": "合理的受教育阶段",
    "incomeLevel": "收入范围",
    "lifestyle": "共同的生活方式",
    "commonPressures": "相同的压力",
  },
  "roles": [
    {
      "slot": 1,
      "name": "",
      "gender": "male|female",
      "age": 0,
      "job": "",
      "familyBackground": "家庭背景与原生家庭压力，1-2句",
      "growthSketch": "成长经历，1-2句",
      "currentLife": "当前生活状态，1-2句",
      "personality": "性格特点，1句",
      "valuesTension": "真实内在矛盾，1句",
      "romanceView": "婚恋观，1句",
      "futureAttitude": "对未来态度，1句",
      "socialFactors": "城乡差异/教育资源/阶层流动/婚育压力/消费主义/互联网文化/代际冲突中最相关的因素，自然语言描述"
    }
  ]
}`;
}

export function buildCharacterDetailPrompt({ cohort, seed, slot = 1, allSeeds = [] } = {}) {
  const expectedGender = seed?.gender === "female" ? "female" : "male";
  const seedText = JSON.stringify(seed || {}, null, 2);
  const cohortText = JSON.stringify(cohort || {}, null, 2);
  const rosterText = JSON.stringify(allSeeds || [], null, 2);

  return `《看见》是一款大模型驱动的性别平等选择游戏。
当前任务是根据第一阶段给出的基础设定，扩写第${slot}号角色为游戏可用的结构化角色。输出严格JSON。

# 全局圈层设定
${cohortText}

# 本角色基础设定
${seedText}

# 四人基础名单(用于保持差异，避免重名与同质化)
${rosterText}

硬性约束:
1) 只生成第${slot}号角色。
2) name、gender、age、job必须继承“本角色基础设定”，不得改名、改性别、改年龄或改职业。
3) gender必须是${expectedGender}。
4) 初始状态单身，禁止写已婚、配偶、子女。
5) 角色必须保持在全局圈层内，不要突然变成明显更高或更低阶层。


字段要求:
- bio: 70-90字，整合家庭、成长、当前生活、内在矛盾，不要空泛标签。
- familyRelation: 1句，描述原生家庭或代际压力。
- keyEvents: 2-3条过去经历，每条短句，可成为后续事件钩子。
- values.familyMarriage: traditional|autonomous|mixed
- values.fairness: result|opportunity|freedom
- values.reform: radical|moderate|skeptical
- desireAndPressure: 1句，写欲望与现实压力的拉扯。
- conflictHooks: 2-3条可持续触发事件的冲突钩子。
- survivalTask: 10-18字，概括主要生存目标/核心矛盾。
- stats只包含health、reputation、wealth；数值要符合角色处境。

数值约束:
- health: 10~100
- reputation: -100~100
- wealth(万元): -30~150

输出JSON格式:
{
  "player": {
    "name": "${seed?.name || ""}",
    "gender": "${expectedGender}",
    "age": ${Number(seed?.age || 28)},
    "job": "${seed?.job || ""}",
    "cityTier": "${cohort?.cityTier || ""}",
    "classLevel": "${cohort?.classLevel || ""}",
    "bio": "",
    "familyRelation": "",
    "keyEvents": ["", ""],
    "values": {
      "familyMarriage": "traditional|autonomous|mixed",
      "fairness": "result|opportunity|freedom",
      "reform": "radical|moderate|skeptical"
    },
    "desireAndPressure": "",
    "conflictHooks": ["", ""],
    "survivalTask": "",
    "stats": {
      "health": int,
      "reputation": int,
      "wealth": int
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

  return `《看见》是一款大模型驱动的性别平等选择游戏，玩家通过普通人的生活选择观察个人生存、关系压力和社会平等的变化。
当前任务是为当前玩家生成一个场景事件和2-3个选项，输出严格JSON。

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
1) 根据上方“历史摘要”中的[open]/[closed]事件线判断延续关系：若有[open]事件线，优先延续；若已[closed]，避免复刻同构冲突。
2) 写普通人日常中的现实性别矛盾，具体到场景、关系和制度压力，避免奇观化。
3) 选项必须形成真实取舍：至少一个偏自保、一个偏争取公平；不要出现所有核心数值同涨或同跌。
4) self只填基础 health/reputation/wealth 变化，wealth单位为万元；普通事件 wealth 建议在 -1.5~+1.5 内。
5) 每个选项都写 summary：人物+处境+选择+意义的1句话，用于经历手账。
6) 每个选项都写 thread：该选项发生后的故事线状态和下一步悬念；若冲突已解决可closed。
7) 普通场景事件只影响当前玩家自己的基础指标；effects只填写self。

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
        }
      }
    }
  ]
}`;
}

export function buildOpportunityPrompt({ player, gameState, historySummary }) {
  return `《看见》是一款大模型驱动的性别平等选择游戏，人生机遇场是第6轮解锁的高风险翻盘渠道。
当前任务是为当前玩家生成一个生活中的小概率机遇事件，并给出成功/失败两条故事线。输出严格JSON。

# 当前玩家
name: ${player.name}
gender: ${player.gender}
job: ${player.job}
cityTier: ${player.cityTier || "unknown"}
classLevel: ${player.classLevel || "unknown"}
bio: ${player.bio}
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}
survivalProgress: ${player.survivalProgress}

# 游戏状态
round: ${gameState.round}
当前社会权利差值: ${gameState.socialGap}

# 历史摘要
${historySummary}

# 生成要求
1) 事件必须是普通生活中极小概率但可叙事成立的机遇，例如中奖、意外获得资源、找到关键亲人/贵人、得到罕见转机、遇到玄学式转运人物等。
2) 只生成2个结果选项：第一个必须是success，第二个必须是failure；玩家不会选择结果，系统会50%随机判定。
3) 成功效果：个人数值大幅提升，health建议+12~+28，reputation建议+8~+28，wealth建议+8~+45。
4) 失败效果：个人数值小幅损耗但不致死，health建议-2~-8，reputation建议-1~-6，wealth建议-0.5~-5。
5) 成功故事可以带一点传奇色彩，但不得写成暴力、违法、伤害他人或极端猎奇。
6) 每个结果都写summary和thread，summary用于经历手账。
7) effects只填写self。

# 输出JSON格式
{
  "eventId": "opp_xxx",
  "thread": {
    "threadId": "thr_opp_xxx",
    "status": "closed",
    "summary": "这次偶然机遇留下的结果"
  },
  "title": "",
  "narrative": "描述机遇出现的场景，让玩家理解为什么可以选择确认尝试或取消离开。",
  "options": [
    {
      "id": "success",
      "label": "确认尝试：机遇成真",
      "description": "成功后的故事线",
      "summary": "${player.name}抓住小概率机遇，获得了足以改变现状的资源。",
      "thread": {"status": "closed", "summary": "机遇成功兑现，局面被重新打开。"},
      "effects": {
        "self": {"health": 18, "reputation": 16, "wealth": 20}
      }
    },
    {
      "id": "failure",
      "label": "确认尝试：机遇落空",
      "description": "失败后的故事线",
      "summary": "${player.name}尝试了小概率机遇，但只付出了轻微成本。",
      "thread": {"status": "closed", "summary": "机遇未能兑现，玩家带着损耗离开。"},
      "effects": {
        "self": {"health": -4, "reputation": -2, "wealth": -2}
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

  return `《看见》是一款大模型驱动的性别平等选择游戏，文化广场用于呈现公共议题、舆论分歧和表达代价。
当前任务是生成一个架空公共争议事件和2-3个讨论立场选项，输出严格JSON。

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
3) 只生成主动参与讨论的立场选项；程序会额外追加固定的离场选项。
4) self只填基础 health/reputation/wealth；wealth建议在 -1.5~+1.5 内。
5) 选项不要全部同向增减；立场越激烈，短期压力通常越高。
6) 每个选项写 summary，用一句话概括玩家如何参与公共讨论及其意义。
7) 每个选项写 thread，说明该公共议题在选择后的发酵状态。
8) 讨论选项只影响当前玩家自己的基础指标；effects只填写self。

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

  return `《看见》是一款大模型驱动的性别平等选择游戏，图书馆用于呈现知识学习、方法练习和现实协商能力。
当前任务是生成一个知识学习/实践事件和2-3个选项，输出严格JSON。

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
6) 学习选项只影响当前玩家自己的基础指标；effects只填写self。

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

  return `《看见》是一款大模型驱动的性别平等选择游戏，咨询室用于呈现压力识别、情绪修复和现实边界协商。
当前任务是生成一个付出代价换取身心修复的低冲突事件和2-3个干预选项，输出严格JSON。

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
6) 咨询室只影响当前玩家自己的基础指标；effects只填写self。

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
  return `《看见》是一款大模型驱动的性别平等选择游戏，法庭用于讨论制度规则、公共责任和权利分配。
当前任务是生成一个公众性别不平等背景故事，并据此提出一项待表决法案。输出严格JSON。

round: ${gameState.round}
当前男性社会权益值: ${gameState.maleRights}
当前女性社会权益值: ${gameState.femaleRights}
当前男女社会权利差值: ${gameState.socialGap}
历史摘要:
${historySummary}

生成要求:
1) narrative必须像法庭开庭陈述：先写“肃静！本期法庭审判正式开庭。”，随后交代一个公众性别不平等背景故事。
2) 必须提出“建议推行《xxx法》”，并说明该法主要保护谁、解决什么制度性问题。
3) 必须在 narrative 中描述支持者、反对者、弃权者三类人的画像、想法和考量。
4) 生成3个投票结果：support、oppose、abstain。
5) 每个投票结果都要写出明确制度后果差异。支持改革通常更可能改善被保护群体处境；反对可能短期稳定但保留问题；弃权通常造成政策悬置、社会疲惫或轻微负面。
6) self只填投票者个人基础 health/reputation/wealth 变化。
7) 单次法庭投票的effects只填写self。
8) 每个选项写 voterProfile，描述选择该立场的人通常如何想。

输出JSON:
{
  "eventId":"court_xxx",
  "title":"《xxx法》审议",
  "billName":"《xxx法》",
  "protectedGroup":"该法主要保护的对象",
  "narrative":"肃静！本期法庭审判正式开庭……选择支持：……选择反对：……弃权：……",
  "options":[
    {
      "id":"support",
      "label":"支持",
      "description":"支持推行该法案的理由和可能后果。",
      "voterProfile":"支持者画像、想法和考量。",
      "summary":"法庭通过改革方案，让育儿责任不再默认压到女性一方。",
      "effects":{
        "self":{"health":-2,"reputation":3,"wealth":0}
      }
    },
    {
      "id":"oppose",
      "label":"反对",
      "description":"反对推行该法案的理由和可能后果。",
      "voterProfile":"反对者画像、想法和考量。",
      "summary":"法庭维持现状，短期减少争执，却让家庭责任的不均衡继续存在。",
      "effects":{
        "self":{"health":0,"reputation":-2,"wealth":1}
      }
    },
    {
      "id":"abstain",
      "label":"弃权",
      "description":"弃权造成政策悬置或公共疲惫的后果。",
      "voterProfile":"弃权者画像、想法和考量。",
      "summary":"法庭未能形成明确公共意志，制度改革被继续搁置。",
      "effects":{
        "self":{"health":-1,"reputation":-1,"wealth":0}
      }
    }
  ]
}`;
}

export function buildCourtResultPrompt({
  eventData,
  votesText,
  winnerLabel,
  winnerSummary,
  resultText,
  impactText,
  gameState,
}) {
  return `《看见》是一款大模型驱动的性别平等选择游戏。当前任务是根据法庭议题与投票结果，撰写一段“结果宣判”。输出严格JSON。

# 法案背景
title: ${eventData.title || "法庭议题"}
billName: ${eventData.billName || eventData.title || "未知法案"}
protectedGroup: ${eventData.protectedGroup || "未说明"}
narrative:
${eventData.narrative || ""}

# 投票结果
${votesText}
最终结果: ${winnerLabel}
结果说明: ${resultText}
数值影响: ${impactText}
胜出立场摘要: ${winnerSummary || "无"}

# 当前社会状态
round: ${gameState.round}
maleRights: ${gameState.maleRights}
femaleRights: ${gameState.femaleRights}
socialGap: ${gameState.socialGap}

写作要求:
1) 生成法案的背景/决策过程/可能执行结果，可以编造一个具体执行案例证明结果好或坏。
2) 必须体现投票比例如何影响执行阻力或社会接受度。
3) 如果法案通过，要写出执行后对被保护群体、企业/家庭/公共机构的影响。
4) 如果反对或弃权胜出，要写出制度搁置或维持现状后的具体后果。
5) 最后必须有“总结：”开头的一句总结，供大结局引用。
6) 260-420字，中文叙事文体。只输出JSON，不要Markdown。

输出JSON:
{
  "title": "",
  "verdictText": "",
  "summary": ""
}`;
}

export function buildRoundEvaluationPrompt({ gameState, roundChoicesText }) {
  return `《看见》是一款大模型驱动的性别平等选择游戏，本局每三回合会汇总所有玩家经历，并观察男女社会权益值的结构性变化。
当前任务是根据最近三轮全部玩家经历小结，综合评估男性社会权益值与女性社会权益值的变化，输出严格JSON。

当前回合: ${gameState.round}
当前男性社会权益值: ${gameState.maleRights}
当前女性社会权益值: ${gameState.femaleRights}
当前社会权利差值: ${gameState.socialGap}

最近三轮行为记录:
${roundChoicesText}

输出要求:
1) 输出字段固定为 maleDelta、femaleDelta、summary。
2) maleDelta 和 femaleDelta 是最近三轮对男性/女性社会权益值的综合变化，必须是 -10~10 的整数。
3) 如果经历主要改善女性在职业、家庭、公共表达或安全中的处境，可让femaleDelta高于maleDelta。
4) 如果经历改善男性照料权、情感表达、免于单一养家压力等处境，也可以让maleDelta为正。
5) 若经历引发反弹、污名、制度搁置或风险转嫁，对应权益值可以为负。
6) summary 用1-2句话解释三轮综合判断，说明为什么给出该变化。

输出JSON:
{
  "maleDelta": 1,
  "femaleDelta": 3,
  "summary": ""
}`;
}

function buildPlayerEndingContext(params) {
  const { player, initialPlayer, gameState, historyText, statDeltaText } = params;
  return `# 角色初始状态
name: ${initialPlayer?.name || player.name}
gender: ${initialPlayer?.gender || player.gender}
age: ${initialPlayer?.age || player.age}
job: ${initialPlayer?.job || player.job}
bio: ${initialPlayer?.bio || player.bio}
survivalTask: ${initialPlayer?.survivalTask || player.survivalTask || ""}
initialHealth: ${initialPlayer?.stats?.health ?? "unknown"}
initialReputation: ${initialPlayer?.stats?.reputation ?? "unknown"}
initialWealth: ${initialPlayer?.stats?.wealth ?? "unknown"}
initialSurvivalProgress: ${initialPlayer?.survivalProgress ?? "unknown"}

# 角色结束状态
health: ${player.stats.health}
reputation: ${player.stats.reputation}
wealth: ${player.stats.wealth}
rightsLevel: ${player.stats.rightsLevel}
riskLevel: ${player.stats.riskLevel}
survivalProgress: ${player.survivalProgress}
alive: ${player.alive}
marriedTo: ${player.marriedTo || "none"}

# 初末变化
${statDeltaText}

# 结局触发说明
${params.earlyDeath ? "本次个人结局由玩家提前死亡触发，写作时必须明确这是提前死亡结局，而不是正常终局。" : "本次个人结局由常规终局触发。"}

# 游戏进程
round: ${gameState.round}
maleRights: ${gameState.maleRights}
femaleRights: ${gameState.femaleRights}
socialGap: ${gameState.socialGap}

# 经历手账摘要
${historyText}`;
}

export function buildPersonalSuccessEndingPrompt(params) {
  return `《看见》是一款大模型驱动的性别平等选择游戏。当前任务是撰写单名角色的个人成功结局，输出严格JSON。

${buildPlayerEndingContext(params)}

写作要求:
1) 角色活到了终局，结局应有总结性质，指出其如何带着关键选择、关系变化和数值变化继续生活。
2) 必须引用1-3个经历手账中的具体事件或选择，但不要机械罗列。
3) 不要写成完美爽文；可以保留现实压力，但整体基调是“撑过来了，并获得了更稳的自我位置”。
4) 260-420字，中文叙事文体。
5) 只输出JSON，不要Markdown。

输出JSON:
{
  "endingText": ""
}`;
}

export function buildPersonalFailureEndingPrompt(params) {
  return `《看见》是一款大模型驱动的性别平等选择游戏。当前任务是撰写单名角色的个人失败结局，输出严格JSON。

${buildPlayerEndingContext(params)}

${params.earlyDeath ? "硬性前提:\n该角色在本局中提前死亡，结局必须把这一点写清楚，并围绕提前死亡如何发生来总结。" : ""}

写作要求:
1) 角色提前出局或未能维持生存进度，结局应有总结性质，写出其失败如何从具体选择和结构压力中逐步形成。
2) 必须引用1-3个经历手账中的具体事件或选择；避免直接说“数值归零所以失败”。
3) 语气克制，不羞辱角色，也不把失败全部归咎于个人；要呈现个人策略与社会环境的相互作用。
4) 260-420字，中文叙事文体。
5) 只输出JSON，不要Markdown。

输出JSON:
{
  "endingText": ""
}`;
}

function buildSocialEndingContext({ gameState, initialSnapshot, playerBriefs, historyText, socialDeltaText, courtSummaryText }) {
  return `# 初始社会状态
initialMaleRights: ${initialSnapshot?.maleRights ?? "unknown"}
initialFemaleRights: ${initialSnapshot?.femaleRights ?? "unknown"}
initialSocialGap: ${initialSnapshot?.socialGap ?? "unknown"}

# 结束社会状态
round: ${gameState.round}
maleRights: ${gameState.maleRights}
femaleRights: ${gameState.femaleRights}
socialGap: ${gameState.socialGap}
alivePlayers: ${gameState.players.filter((p) => p.alive).length}/${gameState.players.length}

# 社会变化
${socialDeltaText}

# 法庭执行概要
${courtSummaryText || "本局未形成可引用的法庭执行概要。"}

# 玩家终局简表
${playerBriefs}

# 全局经历手账摘要
${historyText}`;
}

export function buildSocialSuccessEndingPrompt(params) {
  return `《看见》是一款大模型驱动的性别平等选择游戏。当前任务是撰写本局社会成功结局，输出严格JSON。

${buildSocialEndingContext(params)}

硬性前提:
本局满足全局胜利条件：存活玩家数量超过总人数一半，且男女社会权利差值小于5。

写作要求:
1) 写一个有总结性质的好结局，表现社会风气、制度细节或公共讨论如何发生变化。
2) 必须结合多位玩家的具体经历举例，例如某人的坚持让职场歧视减少，某人的协商让家庭责任分配更可见。
3) 不要空泛歌颂；要落在职场、家庭、公共表达、照护责任或社会支持等具体面向。
4) 320-520字，中文叙事文体。
5) 只输出JSON，不要Markdown。

输出JSON:
{
  "endingText": ""
}`;
}

export function buildSocialFailureEndingPrompt(params) {
  return `《看见》是一款大模型驱动的性别平等选择游戏。当前任务是撰写本局社会失败结局，输出严格JSON。

${buildSocialEndingContext(params)}

硬性前提:
本局未满足全局胜利条件：可能是存活玩家不足，或男女社会权利差值未降到5点以内。

写作要求:
1) 要指出失败原因，但不能直白写“因为X号玩家死亡/提前出局所以失败”。
2) 从具体事件与选择中提炼原因：例如表达方式过于偏激导致议题被转移、持续退让让不公平反复发生、互助没有形成稳定网络等。
3) 可以点名角色和事件，但措辞要像社会观察报告中的结语，克制、具体、有余味。
4) 不要道德审判玩家；强调个人策略、舆论反弹、制度惯性和资源不均如何共同造成结果。
5) 320-520字，中文叙事文体。
6) 只输出JSON，不要Markdown。

输出JSON:
{
  "endingText": ""
}`;
}

export function buildRelationshipPrompt({
  action,
  initiator,
  target,
  gameState,
  historySummary,
}) {
  return `《看见》是一款大模型驱动的性别平等选择游戏，关系系统用于处理玩家之间的结婚、离婚与社会支持互动。
当前任务是生成玩家关系互动叙事和基础数值变化。输出严格JSON。

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
7) effects只填写initiator、target、intimacyDelta、marriage

输出JSON:
{
  "title": "",
  "narrative": "",
  "summary": "林晓梅向李航申请支持，双方把职场申诉变成一次具体的互助行动。",
  "effects": {
    "initiator": {"health": -2, "reputation": 1, "wealth": -1},
    "target": {"health": 1, "reputation": 0, "wealth": 1},
    "intimacyDelta": {"initiator": 6, "target": 4},
    "marriage": {"createSharedWealth": true, "initIntimacy": 62}
  }
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
