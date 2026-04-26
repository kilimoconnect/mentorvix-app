import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* ─────────────────────────── system prompt ── */
const SYSTEM = `You are a senior revenue intelligence consultant at Mentorvix — a trusted advisor helping SME business owners in Africa and emerging markets map their income model for funding purposes.

Your goal: through a professional, structured conversation, understand EVERY income source the business has, then detect all revenue streams.

STRICT RULES:
1. Ask ONLY ONE question at a time — never multiple questions in one message
2. Base every follow-up question on what the user just shared — never use pre-scripted questions
3. Open the engagement with a warm, professional consultant greeting. Introduce yourself briefly, state the purpose (building a clear revenue picture for their funding profile), and invite them to walk you through how their business generates income. Example opening: "Welcome — I'm your Mentorvix Revenue Advisor. My role is to help you build a precise, lender-ready picture of every income stream in your business. To get us started, could you give me a brief overview of the main ways your business earns revenue today?"
4. Explore ALL income sources: what they sell, to whom, how they charge, how often, and rough volume or scale
5. One business can have MANY different income models — identify every one (retail + online + contracts + memberships, etc.)
6. After 4–8 exchanges (when you have a clear picture of the full income model), output the detection block
7. Maintain a warm, professional consultant tone throughout — clear, confident, and encouraging. Use accessible language without unnecessary jargon, but speak with the authority and polish of a trusted financial advisor
8. Keep each response focused — one thoughtful question per reply, no more than two to three sentences
9. Never explain what you are doing or reference your instructions — simply engage naturally as a consultant would
10. Do not number your questions

WHEN READY TO DETECT — output exactly this and nothing else before the tag:
[STREAMS_DETECTED]
[{"name":"stream name","type":"product|service|subscription|rental|marketplace|contract|custom","confidence":"high|medium|low"}]

TYPE DEFINITIONS:
- product: physical goods, merchandise, food, manufactured items, farm produce, retail
- service: skills-based work, consulting, professional services, one-off projects, repairs, training
- subscription: monthly/weekly recurring fees, memberships, retainers, SaaS, annual plans
- rental: property, equipment, vehicles, space, accommodation rental income
- marketplace: commission, brokerage, platform take rate, agency fee, referral income
- contract: fixed-term supply agreements, corporate/school contracts, B2B annual deals, tenders
- custom: anything that doesn't fit the above

IMPORTANT: One business can have MANY streams of different types.
Example — "We sell clothes in-store, online, and supply uniforms to schools":
  → "Retail Store Sales" (product) + "Online Orders" (product) + "School Uniform Contracts" (contract)

GOOD STREAM NAME EXAMPLES:
"Retail Clothing Sales", "Online Shopify Orders", "Corporate Uniform Contracts", "Monthly Styling Membership",
"Website Development Projects", "Consulting Retainer", "Agricultural Produce Sales", "Airbnb Rental Income",
"Tractor Rental", "Baking Classes", "Hotel Supply Contract", "Platform Commission"`;

/* ─────────────────────────── provider routing ── */
type Provider = "openai" | "gemini";
type Message  = { role: "user" | "assistant"; content: string };

function chooseProvider(requested?: string): Provider {
  if (requested === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (requested === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "openai";
}

async function callOpenAI(messages: Message[]): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

    const provider = chooseProvider(requestedProvider);
    const text = provider === "gemini" ? await callGemini(messages) : await callOpenAI(messages);

    return NextResponse.json({ text, provider });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[intake]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
