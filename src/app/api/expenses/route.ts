import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

type Message = { role: "user" | "assistant"; content: string };

function buildSystem(intakeContext?: string): string {
  const priorCtx = intakeContext
    ? `\nBUSINESS CONTEXT (already collected):\n${intakeContext}\n`
    : "";

  return `You are a financial analyst at Mentorvix collecting monthly operating expenses for the income statement.
${priorCtx}
YOUR GOAL:
Extract all fixed and variable monthly operating costs. These go into the income statement below Gross Profit to calculate EBITDA and Net Profit.

EXPENSE CATEGORIES TO COVER (not a script — extract what's given, ask only about genuine gaps):
- Salaries & wages (staff costs, not owner drawings)
- Rent & premises (if rented — already know from business context above if mentioned)
- Utilities (electricity, water, internet, phone)
- Transport & logistics (fuel, delivery, vehicle costs)
- Raw materials / stock replenishment (if not already captured as COGS per stream)
- Marketing & sales (advertising, commissions)
- Insurance
- Admin & office (stationery, software, subscriptions)
- Loan repayments (existing debt service — monthly installment)
- Any other significant recurring cost

HOW YOU WORK — EXTRACTION FIRST:
1. Read the business context above — extract every cost already mentioned (rent, employees, etc.)
2. Ask for all remaining categories in ONE request — do not go category by category
3. If the user gives a lump sum ("about 5 million a month in costs") — ask them to break it into 2–3 main buckets, then accept it
4. If they paste a list or table — extract immediately, no questions
5. Never re-ask about costs already stated in the business context

RULES:
- Maximum 2 sentences + one question per reply
- Analyst shorthand only — direct and brief
- Estimates and round numbers are fine — say so once
- Once you have the major categories covered, output [EXPENSES_DETECTED] — do not wait for every minor line item

OUTPUT — when ready, output ONLY this block:
[EXPENSES_DETECTED]
[
  {"category":"Salaries","monthly_amount":5000000,"note":"optional context"},
  {"category":"Rent","monthly_amount":800000},
  {"category":"Utilities","monthly_amount":200000}
]
(monthly_amount MUST be a number. category MUST be a non-empty string.)`;
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
    const { messages, intakeContext } = await req.json() as {
      messages: Message[];
      intakeContext?: string;
    };

    const system   = buildSystem(intakeContext);
    const provider = chooseProvider();
    const text     = provider === "gemini"
      ? await callGemini(messages ?? [], system)
      : await callOpenAI(messages ?? [], system);

    return NextResponse.json({ text, provider });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[expenses]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
