# 天平叙事局 Demo

一个前端文字桌游初版 Demo（热座模式，4人，20回合），强调：
- 固定信息常驻可视（顶部/左侧/右侧）
- 中央四大板块极简入口
- 点击后弹窗展示AI事件与选项
- 选择后实时更新数值，不跳转页面

## 1. 运行方式

### 方式A：只测前端流程（不走大模型）

```bash
cd /home/elcket/python/project
python3 -m http.server 8080
```

浏览器打开：`http://localhost:8080`

说明：此模式下前端会尝试请求 `/api/llm`，失败后自动回退到本地 Mock 事件。

### 方式B：走 OpenRouter（推荐）

```bash
cd /home/elcket/python/project
cp .env.example .env
# 编辑 .env，填入真实 OPENROUTER_API_KEY
npm install
npm run dev
```

浏览器打开：`http://localhost:8080`

## 2. OpenRouter 接入

默认不配置 key 时使用 Mock 事件，方便调试。

### API Key 应该放在哪里（完整说明）

1. 在项目根目录创建 `.env`（可由 `.env.example` 复制）
2. 在 `.env` 中配置：

```env
OPENROUTER_API_KEY=你的真实key
OPENROUTER_MODEL=stepfun/step-3.5-flash:free
PORT=8080
```

3. 启动 `npm run dev` 后，前端会调用本地后端 `server.mjs`，由后端代理请求 OpenRouter
4. 不要再把 key 写在前端 `window` 变量里，避免泄露

当前模型：`stepfun/step-3.5-flash:free`

请求参数已开启：`reasoning: { enabled: true }`

如果你要按你给的 OpenAI SDK 方式调用，参考 `openrouter-node-example.mjs`（推荐放到后端服务，前端只走你自己的 API）。

## 3. 分场景 Prompt 文件

- `prompts.js`
  - `buildScenePrompt`: 职场/家庭/文化/机遇
  - `buildCourtPrompt`: 法庭议题
  - `buildHistorySummary`: 将历史事件(含open/closed线)注入上下文，保持剧情连贯并避免重复

## 4. 数值修改格式（JSON）

模型返回格式核心：

```json
{
  "options": [
    {
      "effects": {
        "self": {
          "health": -8,
          "reputation": 5,
          "wealth": -2,
          "rightsLevelShift": 0,
          "riskLevelShift": 1
        },
        "global": {
          "socialGap": -2,
          "maleRights": 1,
          "femaleRights": 2,
          "allHealthDelta": -3
        },
        "meta": {
          "survivalProgress": 5,
          "equalityProgress": 8,
          "major": true,
          "tag": "💼"
        }
      }
    }
  ]
}
```

`app.js` 中会直接将这些 JSON 增量应用到状态树。

## 5. 规则已覆盖（初版）

- 4人（2男2女）随机人设与数值
- 每位玩家每轮两段行动：主行动 + 文化行动
- 主行动可选：职场/家庭/人生机遇场(10轮后)/冥想
- 文化行动可选：文化广场/冥想
- 文化广场子模块：图书馆/社交广场/咨询室
- 咨询室限制：健康<50 且每角色每局最多3次
- 每5轮可触发法庭裁决
- 每轮结束：由模型对本轮选择进行7维平等评估，再由程序更新全局权益与差值
- PVP互动（主行动可选）：
  - 结婚：可与异性未婚角色缔结关系，双方进入共享财富池，新增亲密度
  - 离婚：解除关系并将共享财富对半分
  - 援助：玩家间进行资源支持互动
- 亲密度机制：婚后每轮自动衰减，并可被事件选项/PVP行为增减
- 目标判定：
  - 个人失败：健康或存活进度归零
  - 团队成功：存活>=2 且社会权利差值<5

## 6. 你下一步可做的增强

- 对接 function calling / JSON schema 严格校验
- 为婚姻关系增加“共同决策事件”与“育儿分工事件”专项链路
- 对7维评估加入权重系统和可视化雷达图
