import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

type Message = { role: "user" | "assistant"; content: string };

function buildSystem(streamName: string): string {
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return `You are a revenue data specialist at Mentorvix. Your job: extract historical monthly revenue figures for this stream from whatever the user provides.

STREAM: "${streamName}"
TODAY: ${now.toLocaleString("en-US", { month: "long", year: "numeric" })} (${currentYearMonth})

HOW YOU WORK — EXTRACTION FIRST, ALWAYS:
1. Before every reply: scan the full conversation history and extract every revenue figure already stated.
2. If the user has already given monthly numbers, a table, a range, or a single average — extract it immediately and output [ACTUALS_DETECTED]. Do NOT ask follow-up questions.
3. Only ask if genuinely nothing can be determined from what they've said.

WHAT TO EXTRACT:
- Month-by-month revenue for the past 6–12 months
- If they give a single monthly figure (e.g. "about 50k a month") → generate 6 months of that value
- If they give a range → use the midpoint
- If they paste a table or CSV → extract every row immediately, no questions

IF YOU MUST ASK:
- Ask for all months in one request: "Paste your monthly revenue — YYYY-MM | Amount, one per line. Estimates fine."
- Never ask month by month
- Never ask how many months they have before asking for the data

RULES:
- Never re-ask for data already given
- Maximum 2 sentences per reply — no preamble, no explanation
- Analyst shorthand only — direct and brief
- Estimates are fine

OUTPUT — when ready, output ONLY this block:
[ACTUALS_DETECTED]
[
  {"yearMonth":"2025-01","revenue":45000,"note":"optional context"},
  {"yearMonth":"2025-02","revenue":52000}
]
(yearMonth MUST be "YYYY-MM". revenue MUST be a number. Oldest month first.)`;
}

function chooseProvider() {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "openai";
}

async function callOpenAI(messages: Message[], system: string): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const turns = messages.length === 0
    ? [{ role: "user" as const, content: "Start" }]
    : messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 600,
    messages: [{ role: "system", content: system }, ...turns],
  });
  return res.choices[0]?.message?.content ?? "";
}

async function callGemini(messages: Message[], system: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const allMessages = messages.length === 0
    ? [{ role: "user" as const, content: "Start" }]
    : messages;
  const history = allMessages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const lastMsg = allMessages[allMessages.length - 1].content;
  const chat = model.startChat({
    history,
    systemInstruction: { role: "system", parts: [{ text: system }] },
  });
  const res = await chat.sendMessage(lastMsg);
  return res.response.text();
}

export async function POST(req: NextRequest) {
  try {
    const { messages, streamName } = await req.json() as {
      messages: Message[];
      streamName: string;
    };

    if (!streamName) {
      return NextResponse.json({ error: "streamName required" }, { status: 400 });
    }

    const system   = buildSystem(streamName);
    const provider = chooseProvider();
    const text     = provider === "gemini"
      ? await callGemini(messages ?? [], system)
      : await callOpenAI(messages ?? [], system);

    return NextResponse.json({ text, provider });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[actuals]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
