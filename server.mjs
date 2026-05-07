import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 8080);
const baseURL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const model = process.env.OPENROUTER_MODEL || "stepfun/step-3.5-flash:free";
const requestTimeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 90000);

if (!process.env.OPENROUTER_API_KEY) {
  console.warn("[warn] OPENROUTER_API_KEY 未配置，后端将返回降级错误，前端会回退到 Mock 事件。");
}

const client = new OpenAI({
  baseURL,
  apiKey: process.env.OPENROUTER_API_KEY,
});

let reqSeq = 0;

function nextReqId() {
  reqSeq += 1;
  return `llm_${Date.now()}_${reqSeq}`;
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    baseURL,
    model,
    requestTimeoutMs,
    hasApiKey: Boolean(process.env.OPENROUTER_API_KEY),
  });
});

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

app.post("/api/llm", async (req, res) => {
  const reqId = nextReqId();
  const startedAt = Date.now();
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== "string") {
    console.warn(`[llm][${reqId}] invalid prompt`);
    return res.status(400).json({ error: "prompt 不能为空" });
  }

  console.log(
    `[llm][${reqId}] start model=${model} promptChars=${prompt.length} timeoutMs=${requestTimeoutMs}`
  );

  if (!process.env.OPENROUTER_API_KEY) {
    console.warn(`[llm][${reqId}] OPENROUTER_API_KEY missing`);
    return res.status(503).json({ error: "未配置 OPENROUTER_API_KEY" });
  }

  try {
    const response = await Promise.race([
      client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        //reasoning: { enabled: true },
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`请求超时(${requestTimeoutMs}ms)`)), requestTimeoutMs);
      }),
    ]);

    const content = response.choices?.[0]?.message?.content || "{}";
    const usage = response.usage || {};
    console.log(
      `[llm][${reqId}] success ms=${Date.now() - startedAt} usage.prompt=${usage.prompt_tokens ?? "-"} usage.completion=${usage.completion_tokens ?? "-"} usage.total=${usage.total_tokens ?? "-"}`
    );
    return res.json({ ok: true, data: extractJson(content) });
  } catch (error) {
    console.error(
      `[llm][${reqId}] failed ms=${Date.now() - startedAt} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "OpenRouter 调用失败",
      reqId,
    });
  }
});

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`Demo server running at http://localhost:${port}`);
});
