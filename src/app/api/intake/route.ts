import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* ─────────────────────────── system prompt ── */
const SYSTEM = `You are an expert revenue analyst AI for Mentorvix, helping SME business owners in Africa and emerging markets structure how their business makes money.

Your goal: understand the business through natural one-on-one conversation, then detect their revenue streams.

STRICT RULES:
1. Ask ONLY ONE question at a time — never multiple questions in one message
2. Base every follow-up question on what the user just told you — never use pre-scripted questions
3. Start with a warm, open question about what they do or sell
4. Explore: what they sell, who buys it, payment method (cash/mobile money/bank/card), how often, rough scale, main channels, any recurring income
5. After 4–8 exchanges (when you understand the business well enough), output the detection block
6. Be warm, encouraging, and use plain everyday language — no finance jargon
7. Keep your question to ONE sentence maximum
8. Never explain what you're doing — just ask the question naturally
9. Do not number your questions

WHEN READY TO DETECT — output exactly this and nothing else before the tag:
[STREAMS_DETECTED]
[{"name":"stream name","type":"product|service|subscription|rental|marketplace|custom","confidence":"high|medium|low"}]

TYPE DEFINITIONS:
- product: physical goods, merchandise, food, manufactured items, farm produce
- service: skills-based work, consulting, professional services, one-off projects, repairs
- subscription: monthly/weekly recurring fees, memberships, retainers, SaaS
- rental: property, equipment, vehicles, space, accommodation
- marketplace: commission, brokerage, platform take rate, agency fee
- custom: anything that doesn't fit above

GOOD STREAM NAME EXAMPLES:
"Retail Clothing Sales", "Online Shopify Orders", "Corporate Uniform Contracts", "Monthly Styling Membership",
"Website Development Projects", "Consulting Retainer", "Agricultural Produce Sales", "Airbnb Rental Income"`;

/* ─────────────────────────── provider routing ── */
type Provider = "openai" | "gemini";
type Message  = { role: "user" | "assistant"; content: string };

function chooseProvider(requested?: string): Provider {
  if (requested === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (requested === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  // auto-select first available
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "openai";
}

async function callOpenAI(messages: Message[]): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // On opening turn, append a silent trigger so GPT asks the first question
  const turns = messages.length === 0
    ? [{ role: "user" as const, content: "Start" }]
    : messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 400,
    messages: [{ role: "system", content: SYSTEM }, ...turns],
  });
  return res.choices[0]?.message?.content ?? "";
}

async function callGemini(messages: Message[]): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  // On opening turn (empty messages), send a trigger so Gemini asks the first question
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
    systemInstruction: { role: "system", parts: [{ text: SYSTEM }] },
  });
  const res = await chat.sendMessage(lastMsg);
  return res.response.text();
}

/* ─────────────────────────────────────── route ── */
export async function POST(req: NextRequest) {
  try {
    const { messages, provider: requestedProvider } = await req.json() as {
      messages: Message[];
      provider?: string;
    };

    // empty messages = opening turn — AI fires the first question

    const provider = chooseProvider(requestedProvider);
    const text = provider === "gemini" ? await callGemini(messages) : await callOpenAI(messages);

    return NextResponse.json({ text, provider });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[intake]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
