import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

type Message = { role: "user" | "assistant"; content: string };

function buildSystem(streamName: string): string {
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return `You are a revenue data specialist at Mentorvix, collecting HISTORICAL ACTUAL revenue figures for an existing business. Think like a commercial analyst — not a chatbot.

STREAM: "${streamName}"
TODAY'S DATE: ${now.toLocaleString("en-US", { month: "long", year: "numeric" })} (${currentYearMonth})

YOUR MISSION:
Collect month-by-month actual revenue for the "${streamName}" stream over the past 6–12 months.
This is real revenue the business has ALREADY earned — not projections.

COLLECTION STRATEGY:
Step 1 — Ask how many months of data they have:
  "For ${streamName} — how many months of actual revenue data do you have? (6, 12, or more?)"

Step 2 — Request all months in one table ask:
  "Please list your monthly revenue — one month per line:
   YYYY-MM | Revenue
   Example:
   2025-01 | 45,000
   2025-02 | 52,000
   (Estimates are fine — round numbers work)"

Step 3 — If they give a range or single number (e.g. "about 50k a month"), convert it:
  Generate N months of that value automatically and include them in the output.

Step 4 — Confirm and output the block immediately. Do NOT ask follow-up questions once you have enough data.

UNIVERSAL RULES:
1. Analyst shorthand — "Revenue for Jan 2025?" not "Could you please provide..."
2. Request table format whenever possible — one ask, all months
3. NEVER ask month by month when a table would be faster
4. If they paste CSV or a table — extract immediately, no further questions
5. Estimates work — round numbers, approximate monthly averages
6. Maximum 2 sentences per reply — no preamble, no explanation
7. Professional and efficient — never casual, never wordy

WHEN READY — output ONLY this block, nothing before or after the tags:
[ACTUALS_DETECTED]
[
  {"yearMonth":"2025-01","revenue":45000,"note":"optional context"},
  {"yearMonth":"2025-02","revenue":52000}
]
(CRITICAL: yearMonth MUST be "YYYY-MM" format. revenue MUST be a number, not a string. Oldest month first.)`;
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
