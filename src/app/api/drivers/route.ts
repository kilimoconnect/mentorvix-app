import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

type Message = { role: "user" | "assistant"; content: string };
type StreamType = "product" | "service" | "subscription" | "rental" | "marketplace" | "contract" | "custom";

function buildSystem(streamName: string, streamType: StreamType): string {
  const typeHints: Record<StreamType, string> = {
    product:
      "physical goods, SKUs, products. For each item ask: item name, category, units sold per month, selling price per unit.",
    service:
      "services, sessions, projects. For each ask: service name, category, number of clients per month, average fee per client.",
    subscription:
      "recurring plans, tiers, memberships. For each tier ask: tier name, current subscriber count, monthly fee per subscriber. Also ask: how many new subscribers join each month, and what is the monthly cancellation/churn rate (%).",
    rental:
      "rental units, rooms, plots, equipment. For each ask: unit name, category, number of units available, monthly rate per unit. Also ask: what is the typical occupancy rate (what % of units are rented at any given time).",
    marketplace:
      "transaction types where you earn a commission or take rate. For each type ask: transaction name, category, monthly Gross Merchandise Value (GMV) or total transaction volume, commission or take rate (%).",
    contract:
      "fixed-term supply or service agreements. For each ask: contract name, category, number of active contracts, average monthly value per contract. Also ask: typical contract duration and renewal rate.",
    custom:
      "revenue items — ask for: item name, category, monthly volume, price or rate per unit.",
  };

  const formulaHint: Record<StreamType, string> = {
    product:      "Revenue = Units × Selling Price",
    service:      "Revenue = Clients × Avg Fee",
    subscription: "Revenue = Subscribers × Monthly Fee  (churn model tracks subscriber growth)",
    rental:       "Revenue = Units × Rate × Occupancy %",
    marketplace:  "Revenue = GMV × Commission %",
    contract:     "Revenue = Active Contracts × Monthly Contract Value",
    custom:       "Revenue = Volume × Rate",
  };

  return `You are a precise revenue analyst AI helping collect item-level sales data for one specific revenue stream.

STREAM: "${streamName}" — Type: ${streamType}
What this stream contains: ${typeHints[streamType]}
Projection formula: ${formulaHint[streamType]}

YOUR MISSION: Through natural conversation, discover every individual product / service / SKU / tier / item in this stream, along with all the numbers needed to project its revenue.

RULES:
1. Ask ONE question at a time — never multiple questions
2. Be specific — name actual items: "How many cans of interior wall paint do you sell per month, and at what price?"
3. Group items into logical categories as you discover them
4. If user pastes raw data (product list, price list, CSV rows, invoice lines) — extract items directly, no more questions needed
5. Estimates are perfectly fine — encourage the user
6. After you have enough items to accurately represent this stream (usually 3–15 items), output the detection block
7. Do NOT ask generic questions — you already know the stream type, ask about specific items within it

OPENING: Start by acknowledging the stream and asking about the first/main item specifically.
For subscription streams also ask about new signups and churn after collecting tiers.
For rental streams also ask about occupancy rate after collecting units.

WHEN READY — output ONLY this (nothing before the tag, nothing after):
[ITEMS_DETECTED]
[
  {"name":"item name","category":"category","volume":50,"price":25.00,"unit":"unit","note":"optional context"}
]

UNIT EXAMPLES: unit, can, kg, litre, bag, roll, sheet, hour, session, project, seat, room, month, subscriber, contract, GMV
CATEGORY EXAMPLES: Paint Products, Wall Treatments, Footwear, Clothing, Accessories, Professional Services, Basic Plans, Pro Plans, Residential Units, Commercial Units`;
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
