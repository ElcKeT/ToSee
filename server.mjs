import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 8080);
const model = process.env.OPENROUTER_MODEL || "stepfun/step-3.5-flash:free";

if (!process.env.OPENROUTER_API_KEY) {
  console.warn("[warn] OPENROUTER_API_KEY 未配置，后端将返回降级错误，前端会回退到 Mock 事件。");
}

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

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
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt 不能为空" });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({ error: "未配置 OPENROUTER_API_KEY" });
  }

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      reasoning: { enabled: true },
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const content = response.choices?.[0]?.message?.content || "{}";
    return res.json({ ok: true, data: extractJson(content) });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "OpenRouter 调用失败",
    });
  }
});

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`Demo server running at http://localhost:${port}`);
});
