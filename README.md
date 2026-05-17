# 看见

一个大模型驱动的性别平等在线游戏可玩版本原型（单浏览器模拟同步联机，4人，20回合），强调：
- 固定信息常驻可视（顶部/左侧/右侧）
- 中央四大板块极简入口
- 点击后弹窗展示AI事件与选项
- 1号玩家手动决策，2-4号暂由随机决策模拟
- 单人行动即时更新个人数值，PVP在回合结算阶段同步处理

## 1. 运行方式

### 方式A：只测前端流程（不走大模型）

```bash
cd /home/elcket/python/project
python3 -m http.server 8080
```

浏览器打开：`http://localhost:8080`

说明：此模式下前端会尝试请求 `/api/llm`，失败后自动回退到本地 Mock 事件。

### 方式B：走 DeepSeek（推荐）

```bash
cd /home/elcket/python/project
cp .env.example .env
# 编辑 .env，填入真实 DEEPSEEK_API_KEY
npm install
npm run dev
```

浏览器打开：`http://localhost:8080`

说明：
- 点击开始后会先生成共同社会圈层与4人基础人设，再并行扩写本局4人角色背景与基础数值
- 基础人设生成完成后进入匹配页，1号玩家扩写完成即可预览，其他玩家继续显示生成中/已就绪
- 事件请求期间会出现全局加载遮罩，防止误触重复点击

字体：
- 默认引用本地思源黑体 Regular
- 请将字体文件放在 `fonts/SourceHanSansSC-Regular.otf` 或 `fonts/SourceHanSansSC-Regular.ttf`

## 2. DeepSeek 接入

默认不配置 key 时使用 Mock 事件，方便调试。

### API Key 应该放在哪里（完整说明）

1. 在项目根目录创建 `.env`（可由 `.env.example` 复制）
2. 在 `.env` 中配置：

```env
DEEPSEEK_API_KEY=你的真实key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
LLM_REQUEST_TIMEOUT_MS=180000
LLM_MAX_TOKENS=4096
PORT=8080
```

如果你要切到其他 DeepSeek 兼容模型，只改 `DEEPSEEK_MODEL` 即可。

3. 启动 `npm run dev` 后，前端会调用本地后端 `server.mjs`，由后端代理请求 DeepSeek
4. 不要再把 key 写在前端 `window` 变量里，避免泄露

排查接口：

```bash
curl http://localhost:8080/api/health
```

返回 `hasApiKey: true` 代表后端已读取到 key。
返回里也会包含当前 `baseURL`、`model` 和 `requestTimeoutMs`，便于确认是否切换成功。

## 2.1 修改代码后是否要重新编译

- 改前端文件（`index.html`/`app.js`/`style.css`）: 不需要编译，刷新页面即可
- 改后端文件（`server.mjs`/`.env`）: 需要重启 `npm run dev`
- 新增或升级依赖: 需要重新执行 `npm install`

当前模型：`deepseek-v4-pro`

请求参数已开启：`thinking: { type: "enabled" }`、`reasoning_effort: "high"`、`response_format: { type: "json_object" }`。

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
          "wealth": -2
        }
      }
    }
  ]
}
```

模型只返回个人基础三项变化；单个选项不直接改男女社会权益值。`state.js` 会根据实时社会名誉推导权利指数/风险等级，并用程序规则重算实际增减和存活进度；男女社会权益值改为每三轮汇总所有玩家经历后由模型统一结算。

## 5. 规则已覆盖（初版）

- 4人（2男2女）随机人设与数值
- 每位玩家每轮两段行动：主行动 + 文化行动
- 当前为单浏览器模拟同步联机：1号玩家由用户操作，2号模拟人类，3-4号模拟AI
- 2-4号暂用随机决策，后续可替换为真实联机提交或大模型决策
- 主行动可选：职场/家庭/人生机遇场(10轮后)/PVP互动/冥想
- 文化行动可选：文化广场/PVP互动/冥想
- 文化广场子模块：图书馆/社交广场/咨询室
- 咨询室限制：健康<50 且每角色每局最多3次
- 每5轮可触发法庭裁决
- 每轮结束：先统一结算PVP；每三轮汇总所有玩家经历，由模型统一评估男女社会权益值变化，并更新权利差值
- PVP互动（主行动与第二段行动均可选）：
  - 结婚：可与异性未婚角色缔结关系，双方进入共享财富池，新增亲密度
  - 离婚：解除关系并将共享财富对半分
  - 援助：玩家间进行资源支持互动
- 亲密度机制：婚后每轮自动衰减，并可被事件选项/PVP行为增减
- 目标判定：
  - 个人失败：存活进度归零；若健康归零，存活进度会立即置0
  - 团队成功：存活>=2 且社会权利差值<5

## 6. 你下一步可做的增强

- 对接 function calling / JSON schema 严格校验
- 为婚姻关系增加“共同决策事件”与“育儿分工事件”专项链路
- 如后续需要，可再引入多维社会指标与可视化雷达图
