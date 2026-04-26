import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

type Message = { role: "user" | "assistant"; content: string };
type StreamType = "product" | "service" | "subscription" | "rental" | "marketplace" | "custom";

function buildSystem(streamName: string, streamType: StreamType): string {
  const typeHints: Record<StreamType, string> = {
    product:      "physical goods, SKUs, products with units and selling prices",
    service:      "services, projects, packages with number of clients and fees",
    subscription: "recurring plans, tiers, memberships with subscriber counts and monthly fees",
    rental:       "rental units, rooms, equipment with occupancy and rates",
    marketplace:  "transaction types, commission rates, GMV volumes",
    custom:       "revenue items with volumes and rates",
  };

  return `You are a precise revenue analyst AI helping collect item-level sales data for one specific revenue stream.

STREAM: "${streamName}" — Type: ${streamType} (${typeHints[streamType]})

YOUR MISSION: Through natural conversation, discover every individual product / service / SKU / item / tier in this stream, along with:
- Exact item name
- Category or group it belongs to
- Monthly volume sold (units, sessions, subscribers, etc.)
- Price per unit / session / month

RULES:
1. Ask ONE question at a time
2. Be specific — name actual items: "How many cans of interior wall paint do you sell per month, and at what price?"
3. Group items into logical categories as you discover them
4. If user pastes raw data (product list, price list, CSV rows, invoice lines) — extract items directly from it, no more questions needed
5. Estimates are perfectly fine — encourage the user
6. After you have enough items to accurately represent this stream (usually 4–15 items), output the detection block
7. Do NOT ask generic questions like "what do you sell" — you already know the stream, ask about specific items within it

OPENING: Start by acknowledging the stream name and asking about the first/main item specifically.

WHEN READY — output ONLY this (nothing before the tag):
[ITEMS_DETECTED]
[
  {"name":"item name","category":"category","volume":50,"price":25.00,"unit":"can","note":"optional context"}
]

UNIT EXAMPLES: unit, can, kg, litre, bag, roll, sheet, hour, session, project, seat, room, month, subscription
CATEGORY EXAMPLES: Paint Products, Wall Treatments, Tools & Accessories, Professional Services, Residential, Commercial, Basic Plans, Pro Plans`;
}

function chooseProvider() {
  if (process.env.OPENAI_API_KEY)  return "openai";
  if (process.env.GEMINI_API_KEY)  return "gemini";
  return "openai";
}

async function callOpenAI(messages: Message[], system: string): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const turns = messages.length === 0
    ? [{ role: "user" as const, content: "Start" }]
    : messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 500,
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
    const { messages, stream } = await req.json() as {
      messages: Message[];
      stream: { name: string; type: StreamType };
    };

    if (!stream?.name) {
      return NextResponse.json({ error: "Stream name required" }, { status: 400 });
    }

    const system   = buildSystem(stream.name, stream.type);
    const provider = chooseProvider();
    const text     = provider === "gemini"
      ? await callGemini(messages ?? [], system)
      : await callOpenAI(messages ?? [], system);

    return NextResponse.json({ text, provider });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[drivers]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
