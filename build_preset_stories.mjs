#!/usr/bin/env node
import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import OpenAI from "openai";

const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";
const requestTimeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 90000);
const maxTokens = Number(process.env.LLM_MAX_TOKENS || 4096);

const client = new OpenAI({
  baseURL,
  apiKey: process.env.DEEPSEEK_API_KEY || "missing-deepseek-api-key",
});

const CANONICAL_THEMES = [
  "女性权利",
  "生育自主",
  "家务分配",
  "育儿责任",
  "职场公平",
  "照护劳动",
  "经济控制",
  "婚恋压力",
  "代际边界",
  "身体边界与同意",
  "情绪劳动",
  "舆论双标",
  "法律保障",
  "性别刻板印象",
  "心理健康",
  "家庭暴力",
  "资源机会不平等",
  "性别平等综合",
];

const THEME_ALIASES = {
  女性权益: "女性权利",
  女权: "女性权利",
  妇女权利: "女性权利",
  妇女权益: "女性权利",
  reproductiveRights: "生育自主",
  生育权: "生育自主",
  生育选择: "生育自主",
  生育决定权: "生育自主",
  家务劳动分工: "家务分配",
  家务劳动: "家务分配",
  育儿分工: "育儿责任",
  抚育责任: "育儿责任",
  就业歧视: "职场公平",
  同工同酬: "职场公平",
  职场歧视: "职场公平",
  无偿照护: "照护劳动",
  照料劳动: "照护劳动",
  财务控制: "经济控制",
  家庭经济控制: "经济控制",
  催婚: "婚恋压力",
  相亲压力: "婚恋压力",
  原生家庭边界: "代际边界",
  代际控制: "代际边界",
  身体自主: "身体边界与同意",
  同意边界: "身体边界与同意",
  emotionalLabour: "情绪劳动",
  情感劳动: "情绪劳动",
  网络舆论双标: "舆论双标",
  法律权利: "法律保障",
  法律维权: "法律保障",
  性别偏见: "性别刻板印象",
  刻板印象: "性别刻板印象",
  心理支持: "心理健康",
  心理韧性: "心理健康",
  家暴: "家庭暴力",
  亲密关系暴力: "家庭暴力",
  资源不平等: "资源机会不平等",
  机会不平等: "资源机会不平等",
};

function parseArgs(argv) {
  const args = {
    input: "",
    outputDir: "knowledge_base",
    maxSections: 0,
    fromIndex: 1,
    maxRetries: 3,
    minChars: 350,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input") args.input = argv[i + 1] || "";
    if (token === "--outputDir") args.outputDir = argv[i + 1] || args.outputDir;
    if (token === "--maxSections") args.maxSections = Number(argv[i + 1] || 0);
    if (token === "--fromIndex") args.fromIndex = Number(argv[i + 1] || 1);
    if (token === "--maxRetries") args.maxRetries = Number(argv[i + 1] || 3);
    if (token === "--minChars") args.minChars = Number(argv[i + 1] || 350);
    if (token === "--dryRun") args.dryRun = true;
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!args.input) {
    throw new Error("缺少参数 --input，例如 --input book_md/成为母亲的选择.md");
  }

  if (!Number.isFinite(args.fromIndex) || args.fromIndex < 1) {
    throw new Error("--fromIndex 必须是 >= 1 的整数");
  }

  if (!Number.isFinite(args.maxRetries) || args.maxRetries < 1 || args.maxRetries > 8) {
    throw new Error("--maxRetries 建议在 1~8 之间");
  }

  return args;
}

function printHelp() {
  console.log(`\n用法:\n  node build_preset_stories.mjs --input <md文件路径> [选项]\n\n选项:\n  --outputDir <目录>     输出目录，默认 knowledge_base\n  --fromIndex <n>        从第 n 个 # 标题块开始处理，默认 1\n  --maxSections <n>      最多处理 n 个标题块，默认 0(全部)\n  --maxRetries <n>       单块最大重试次数，默认 3\n  --minChars <n>         标题块最小字符数，默认 350\n  --dryRun               仅打印计划，不写文件\n  --help, -h             查看帮助\n\n示例:\n  node build_preset_stories.mjs --input book_md/成为母亲的选择.md\n  node build_preset_stories.mjs --input book_md/成为母亲的选择.md --maxSections 5 --dryRun\n`);
}

function splitByH1(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match) {
      if (current) sections.push(current);
      current = {
        index: sections.length + 1,
        heading: match[1].trim(),
        startLine: i + 1,
        bodyLines: [],
      };
      continue;
    }

    if (current) {
      current.bodyLines.push(line);
    }
  }

  if (current) sections.push(current);

  return sections.map((s) => {
    const body = s.bodyLines.join("\n").trim();
    return {
      index: s.index,
      heading: s.heading,
      startLine: s.startLine,
      body,
      charCount: body.length,
    };
  });
}

function sha1Short(input, length = 10) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, length);
}

function safeFilePart(text, maxLen = 40) {
  const cleaned = String(text || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/_+/g, "_")
    .replace(/-+/g, "-")
    .trim();

  return cleaned.slice(0, maxLen) || "unknown";
}

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

function cleanupThemeText(theme) {
  return String(theme || "")
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[()（）\[\]【】]/g, "")
    .trim();
}

function keywordTheme(themeText) {
  const t = cleanupThemeText(themeText);
  if (!t) return null;

  if (/(女性|妇女).*(权益|权利)|女权/.test(t)) return "女性权利";
  if (/(生育|怀孕|流产|避孕|是否生).*(自主|选择|决定|权)|生育自主/.test(t)) return "生育自主";
  if (/(家务|家事|家内劳动|做饭|清洁|洗衣|照料家务)/.test(t)) return "家务分配";
  if (/(育儿|带娃|抚养|照顾孩子|托育)/.test(t)) return "育儿责任";
  if (/(职场|就业|招聘|升职|晋升|同工同酬|性骚扰|绩效)/.test(t)) return "职场公平";
  if (/(照护|照料|护理|赡养|无偿劳动)/.test(t)) return "照护劳动";
  if (/(财务|经济控制|上交工资|财政权|金钱控制)/.test(t)) return "经济控制";
  if (/(催婚|相亲|婚房|彩礼|婚恋)/.test(t)) return "婚恋压力";
  if (/(代际|原生家庭|婆媳|翁婿|边界|父母干预)/.test(t)) return "代际边界";
  if (/(同意|边界|身体自主|婚内强迫|强迫性行为)/.test(t)) return "身体边界与同意";
  if (/(情绪劳动|情感劳动|安抚|共情负担)/.test(t)) return "情绪劳动";
  if (/(舆论|双标|网暴|网络暴力|污名)/.test(t)) return "舆论双标";
  if (/(法律|法庭|维权|司法|法规|权益保障)/.test(t)) return "法律保障";
  if (/(刻板印象|偏见|性别角色|男主外女主内)/.test(t)) return "性别刻板印象";
  if (/(心理|焦虑|抑郁|压力|创伤|咨询)/.test(t)) return "心理健康";
  if (/(家暴|家庭暴力|肢体暴力|精神暴力|控制暴力)/.test(t)) return "家庭暴力";
  if (/(机会不平等|资源不平等|教育机会|阶层固化|社会支持网络)/.test(t)) return "资源机会不平等";

  return null;
}

function normalizeThemes({ rawThemes = [], canonicalThemes = [], conflictCore = "" }) {
  const set = new Set();

  const pushTheme = (candidate) => {
    if (!candidate) return;
    const clean = cleanupThemeText(candidate);
    if (!clean) return;

    const alias = THEME_ALIASES[clean] || THEME_ALIASES[candidate] || null;
    const fromKeyword = keywordTheme(clean);
    const normalized = alias || fromKeyword || null;

    if (normalized && CANONICAL_THEMES.includes(normalized)) {
      set.add(normalized);
    }
  };

  canonicalThemes.forEach(pushTheme);
  rawThemes.forEach(pushTheme);
  pushTheme(conflictCore);

  if (set.size === 0) {
    set.add("性别平等综合");
  }

  return Array.from(set).slice(0, 4);
}

function buildExtractionPrompt(section, sourceMeta) {
  const taxonomy = CANONICAL_THEMES.filter((t) => t !== "性别平等综合").join("、");

  return `你是“性别议题桌游”的知识抽取器。你的任务是把书籍章节改写为“可复用的预制冲突故事卡”，用于后续AI生成。

输入来源:
- 文件: ${sourceMeta.file}
- 章节序号: ${section.index}
- 章节标题: ${section.heading}
- 正文字符数: ${section.charCount}

硬性要求:
1) 严禁照抄原文，不要输出书中的真实人名、地点名、机构名
2) 只能保留“冲突结构”，需要抽象成普通人可迁移的情境
3) 如果材料不够形成强冲突(比如纯目录、纯理论铺垫、重复段落)，必须拒绝: accepted=false
4) 拒绝时要简明说明原因 rejectReason，不要勉强生成
5) 主题必须从以下规范主题中选择(可多选): ${taxonomy}
6) 避免输出原文连续引用，任何单句不要超过25字的疑似原文复述

输出只允许是JSON对象:
{
  "accepted": true,
  "rejectReason": "",
  "confidence": 0.86,
  "qualityScore": 88,
  "title": "一句话标题",
  "themesRaw": ["模型自提主题"],
  "themesCanonical": ["女性权利", "家务分配"],
  "conflictCore": "一句话描述核心矛盾",
  "storyBlueprint": {
    "background": "背景",
    "trigger": "导火索",
    "escalation": "冲突升级",
    "dilemma": "关键两难",
    "decisionFrames": [
      {
        "label": "选项A立场",
        "stance": "偏保障个人权利|偏维护传统稳定|偏折中协商",
        "shortTermTradeoff": "短期得失",
        "longTermImpact": "长期影响"
      },
      {
        "label": "选项B立场",
        "stance": "偏保障个人权利|偏维护传统稳定|偏折中协商",
        "shortTermTradeoff": "短期得失",
        "longTermImpact": "长期影响"
      }
    ],
    "endingDirections": ["可能结局1", "可能结局2"]
  },
  "adaptationRules": {
    "replaceMap": [
      { "source": "书中人物身份", "target": "可替换角色原型" }
    ],
    "modernization": ["如何改写为当代城市语境"],
    "safetyBoundaries": ["不应出现的极端化表达"]
  },
  "promptSeed": {
    "sceneHints": ["workplace|family|culture|court"],
    "relationshipHints": ["single|married|all"],
    "conflictHooks": ["用于后续生成的冲突钩子"]
  }
}

如果拒绝，示例:
{
  "accepted": false,
  "rejectReason": "本段以研究方法介绍为主，缺少明确冲突主体和可交互两难",
  "confidence": 0.35,
  "qualityScore": 41,
  "themesRaw": [],
  "themesCanonical": [],
  "conflictCore": "",
  "storyBlueprint": {},
  "adaptationRules": {},
  "promptSeed": {}
}

待处理章节正文:
<<<SECTION>>>
${section.body}
<<<END_SECTION>>>`;
}

async function callLlmJson(prompt) {
  const response = await Promise.race([
    client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "你是一个只输出合法 JSON 对象的助手。不要输出解释、Markdown 或 JSON 以外的文本。",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      reasoning_effort: "high",
      stream: false,
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`请求超时(${requestTimeoutMs}ms)`)), requestTimeoutMs);
    }),
  ]);

  const content = response?.choices?.[0]?.message?.content || "{}";
  return {
    data: extractJson(content),
    usage: response.usage || {},
  };
}

function validateAcceptedCard(card) {
  if (!card || typeof card !== "object") {
    return { ok: false, reason: "输出不是对象" };
  }

  if (card.accepted !== true) {
    return { ok: false, reason: card.rejectReason || "模型拒绝生成" };
  }

  if (typeof card.title !== "string" || card.title.trim().length < 4) {
    return { ok: false, reason: "title 过短" };
  }

  if (typeof card.conflictCore !== "string" || card.conflictCore.trim().length < 12) {
    return { ok: false, reason: "conflictCore 不足" };
  }

  if (!Number.isFinite(Number(card.confidence)) || Number(card.confidence) < 0.72) {
    return { ok: false, reason: "confidence 低于阈值0.72" };
  }

  if (!Number.isFinite(Number(card.qualityScore)) || Number(card.qualityScore) < 75) {
    return { ok: false, reason: "qualityScore 低于阈值75" };
  }

  const bp = card.storyBlueprint || {};
  if (typeof bp.background !== "string" || bp.background.trim().length < 12) {
    return { ok: false, reason: "background 不足" };
  }

  if (typeof bp.trigger !== "string" || bp.trigger.trim().length < 8) {
    return { ok: false, reason: "trigger 不足" };
  }

  if (typeof bp.escalation !== "string" || bp.escalation.trim().length < 8) {
    return { ok: false, reason: "escalation 不足" };
  }

  if (typeof bp.dilemma !== "string" || bp.dilemma.trim().length < 8) {
    return { ok: false, reason: "dilemma 不足" };
  }

  const frames = Array.isArray(bp.decisionFrames) ? bp.decisionFrames : [];
  if (frames.length < 2) {
    return { ok: false, reason: "decisionFrames 少于2个" };
  }

  const hooks = Array.isArray(card?.promptSeed?.conflictHooks) ? card.promptSeed.conflictHooks : [];
  if (hooks.length < 1) {
    return { ok: false, reason: "缺少 conflictHooks" };
  }

  return { ok: true, reason: "ok" };
}

function normalizeCard(card) {
  const rawThemes = Array.isArray(card.themesRaw) ? card.themesRaw : [];
  const canonicalThemes = Array.isArray(card.themesCanonical) ? card.themesCanonical : [];
  const normalizedThemes = normalizeThemes({
    rawThemes,
    canonicalThemes,
    conflictCore: card.conflictCore || "",
  });

  return {
    ...card,
    themesRaw: rawThemes,
    themesCanonical: normalizedThemes,
  };
}

async function appendNdjson(filePath, obj) {
  await fs.appendFile(filePath, `${JSON.stringify(obj)}\n`, "utf8");
}

async function loadExistingSectionKeys(manifestPath) {
  try {
    const text = await fs.readFile(manifestPath, "utf8");
    const keys = new Set();

    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        try {
          const row = JSON.parse(line);
          if (row?.source?.sectionKey) keys.add(row.source.sectionKey);
        } catch {
          // ignore broken lines
        }
      });

    return keys;
  } catch {
    return new Set();
  }
}

function toRelativeFromCwd(absPath) {
  const rel = path.relative(process.cwd(), absPath);
  return rel.startsWith("..") ? absPath : rel;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), args.input);
  const outputDir = path.resolve(process.cwd(), args.outputDir);
  const manifestPath = path.join(outputDir, "manifest.ndjson");

  const inputText = await fs.readFile(inputPath, "utf8");
  const allSections = splitByH1(inputText);
  if (allSections.length === 0) {
    throw new Error("未找到任何 '# ' 一级标题，无法处理");
  }

  const sourceBase = path.basename(inputPath, path.extname(inputPath));
  const sourceFileRel = toRelativeFromCwd(inputPath);

  const selected = allSections
    .filter((s) => s.index >= args.fromIndex)
    .filter((s) => s.charCount >= args.minChars)
    .slice(0, args.maxSections > 0 ? args.maxSections : undefined);

  if (selected.length === 0) {
    console.log("没有可处理章节：请降低 --minChars 或调整 --fromIndex/--maxSections");
    return;
  }

  if (!args.dryRun && !process.env.DEEPSEEK_API_KEY) {
    throw new Error("未配置 DEEPSEEK_API_KEY，无法调用模型。可加 --dryRun 仅看切分结果。");
  }

  await fs.mkdir(outputDir, { recursive: true });

  const existingSectionKeys = await loadExistingSectionKeys(manifestPath);

  const stats = {
    source: sourceFileRel,
    totalSections: allSections.length,
    selected: selected.length,
    skippedExisting: 0,
    accepted: 0,
    rejected: 0,
    errors: 0,
  };

  console.log(`[preset] source=${sourceFileRel} total=${allSections.length} selected=${selected.length}`);

  for (const section of selected) {
    const sectionKey = `${sourceFileRel}::${section.index}::${section.heading}`;
    if (existingSectionKeys.has(sectionKey)) {
      stats.skippedExisting += 1;
      console.log(`[preset] skip existing sec=${section.index} title=${section.heading}`);
      continue;
    }

    if (args.dryRun) {
      console.log(
        `[dry-run] sec=${section.index} line=${section.startLine} chars=${section.charCount} title=${section.heading}`
      );
      continue;
    }

    let acceptedCard = null;
    let lastReason = "";

    for (let attempt = 1; attempt <= args.maxRetries; attempt += 1) {
      const prompt = buildExtractionPrompt(section, { file: sourceFileRel });
      try {
        const { data, usage } = await callLlmJson(prompt);
        const normalized = normalizeCard(data);
        const check = validateAcceptedCard(normalized);

        if (check.ok) {
          acceptedCard = {
            ...normalized,
            _attempt: attempt,
            _usage: usage,
          };
          break;
        }

        lastReason = check.reason;
        console.log(
          `[preset] reject sec=${section.index} attempt=${attempt}/${args.maxRetries} reason=${check.reason}`
        );
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
        console.log(
          `[preset] error sec=${section.index} attempt=${attempt}/${args.maxRetries} reason=${lastReason}`
        );
      }
    }

    if (!acceptedCard) {
      stats.rejected += 1;
      const rejectedPath = path.join(outputDir, `rejected__${safeFilePart(sourceBase)}.ndjson`);
      await appendNdjson(rejectedPath, {
        createdAt: new Date().toISOString(),
        source: {
          file: sourceFileRel,
          sectionKey,
          sectionIndex: section.index,
          heading: section.heading,
          startLine: section.startLine,
          charCount: section.charCount,
        },
        reason: lastReason || "未通过拒绝采样质量门槛",
      });
      continue;
    }

    const payload = {
      schemaVersion: 1,
      presetId: `preset_${sha1Short(`${sectionKey}|${Date.now()}`, 12)}`,
      createdAt: new Date().toISOString(),
      model,
      source: {
        file: sourceFileRel,
        book: sourceBase,
        sectionKey,
        sectionIndex: section.index,
        heading: section.heading,
        startLine: section.startLine,
        charCount: section.charCount,
      },
      themes: {
        canonical: acceptedCard.themesCanonical,
        raw: acceptedCard.themesRaw,
      },
      title: acceptedCard.title,
      conflictCore: acceptedCard.conflictCore,
      storyBlueprint: acceptedCard.storyBlueprint,
      adaptationRules: acceptedCard.adaptationRules,
      promptSeed: acceptedCard.promptSeed,
      quality: {
        confidence: Number(acceptedCard.confidence),
        qualityScore: Number(acceptedCard.qualityScore),
        attempt: acceptedCard._attempt,
      },
      usage: acceptedCard._usage,
    };

    const themePart = payload.themes.canonical.slice(0, 2).map((t) => safeFilePart(t, 16)).join("+") || "性别平等综合";
    const sectionPart = `sec${String(section.index).padStart(3, "0")}`;
    const headingHash = sha1Short(section.heading, 8);
    const outName = `${safeFilePart(sourceBase)}__${themePart}__${sectionPart}__${headingHash}.json`;
    const outPath = path.join(outputDir, outName);

    await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await appendNdjson(manifestPath, {
      createdAt: payload.createdAt,
      presetId: payload.presetId,
      file: path.relative(process.cwd(), outPath),
      source: payload.source,
      themes: payload.themes,
      quality: payload.quality,
    });

    existingSectionKeys.add(sectionKey);
    stats.accepted += 1;

    console.log(
      `[preset] accepted sec=${section.index} themes=${payload.themes.canonical.join(",")} file=${path.relative(process.cwd(), outPath)}`
    );
  }

  console.log("[preset] done", stats);
}

main().catch((error) => {
  console.error(`[preset] fatal ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
