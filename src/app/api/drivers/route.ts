import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

type Message = { role: "user" | "assistant"; content: string };
type StreamType = "product" | "service" | "subscription" | "rental" | "marketplace" | "contract" | "custom";

const SITUATION_LABELS: Record<string, string> = {
  new_business:    "STARTING A NEW BUSINESS — use future/planned language throughout (will, planning to, expecting). Never ask about current sales.",
  existing:        "EXISTING OPERATING BUSINESS — ask about current actuals.",
  expansion:       "EXPANSION / GROWTH — the business is adding capacity. Distinguish existing vs. new/planned revenue.",
  working_capital: "WORKING CAPITAL NEED — focus on current monthly revenue and repayment capacity.",
  asset_purchase:  "ASSET PURCHASE — focus on revenue the asset will enable or support.",
  turnaround:      "TURNAROUND / RECOVERY — be sensitive. Focus on current active revenue, not peak.",
};

function buildSystem(streamName: string, streamType: StreamType, situation?: string, isFirstStream?: boolean): string {

  const formulaHint: Record<StreamType, string> = {
    product:      "Revenue = Units Sold × Selling Price",
    service:      "Revenue = Clients per Month × Average Fee",
    subscription: "Revenue = Active Subscribers × Monthly Fee  (churn model applies)",
    rental:       "Revenue = Units × Monthly Rate × Occupancy %",
    marketplace:  "Revenue = GMV × Commission % ÷ 100",
    contract:     "Revenue = Active Contracts × Monthly Contract Value",
    custom:       "Revenue = Volume × Rate per Unit",
  };

  // ── per-type collection strategy ──────────────────────────────────────��───
  const strategy: Record<StreamType, string> = {

    product: `
CATALOG COMPLEXITY RULE — MANDATORY FOR ALL PRODUCT STREAMS:
Never start by asking about a specific SKU or item count. Always assess complexity first.

STEP 1 — ASSESS CATALOG SIZE:
  Your opening question must be: "To set this up accurately — roughly how many products or SKUs does this store carry? (Under 20 / 20–100 / More than 100)"

STEP 2 — ROUTE BASED ON ANSWER:
  Under 20 items → ask for top products by name, one category at a time, with volume and price
  20–100 items   → ask for main categories first, then volume and average price per category
  100+ items     → go straight to category-level data: ask which categories they carry, then for each category ask total monthly units sold and average selling price. Do NOT suggest importing or offer method choices — just collect the data at category level right here in the conversation.

STEP 3 — CATEGORY-LEVEL DATA COLLECTION (for 20+ item catalogs):
  Ask: "Which product categories make up most of your sales? For example: Interior Paint, Exterior Paint, Primer, Waterproofing, Wood Finish, Tools?"
  Then for each category in sequence: "For [category] — roughly how many units do you sell per month across all stores, and what is the average selling price?"
  Collect volume and price per category. Each category becomes one item in the output.

STEP 4 — STORE MIX (for multi-location streams):
  If the stream name mentions multiple stores or locations: "Are sales roughly similar across stores, or does one location drive significantly more?"

STEP 5 — PRICING:
  Only ask for prices after volume is established.`,

    service: `
OPENING STRATEGY FOR SERVICE STREAMS:
  Step 1 — Understand service types: "What types of services does this stream include? For example: installations, repairs, consulting, training, projects?"
  Step 2 — Volume by type: "For [service type], roughly how many clients or jobs do you handle per month?"
  Step 3 — Pricing per type: "What is the average fee or charge for [service type]?"
  Never ask about one specific job as the opening. Start at service-type level.`,

    subscription: `
OPENING STRATEGY FOR SUBSCRIPTION STREAMS:
  Step 1 — Tier structure: "Do you have different subscription tiers or membership levels, or is it one standard plan?"
  Step 2 — Per tier: subscriber count and monthly fee
  Step 3 — Growth dynamics: "On average, how many new subscribers join each month?"
  Step 4 — Churn: "What percentage of subscribers cancel or lapse each month?"`,

    rental: `
OPENING STRATEGY FOR RENTAL STREAMS:
  Step 1 — Unit types: "What types of units or assets are available for rent? For example: residential units, commercial space, equipment, vehicles?"
  Step 2 — Per unit type: number of units and monthly rate
  Step 3 — Occupancy: "On average, what percentage of your units are occupied or rented at any given time?"`,

    marketplace: `
OPENING STRATEGY FOR MARKETPLACE / COMMISSION STREAMS:
  Step 1 — Transaction types: "What types of transactions does this stream handle?"
  Step 2 — Volume: "What is the approximate monthly transaction value or GMV?"
  Step 3 — Take rate: "What commission or take rate (%) do you earn on those transactions?"`,

    contract: `
OPENING STRATEGY FOR CONTRACT STREAMS:
  Step 1 — Contract types: "What kinds of contracts or supply agreements make up this stream?"
  Step 2 — Active count: "How many active contracts are running at the moment?"
  Step 3 — Value: "What is the average monthly value of each contract?"
  Step 4 — Renewal dynamics: "What is the typical contract duration, and do most renew?"`,

    custom: `
OPENING STRATEGY FOR CUSTOM / CONVERSION STREAMS:
  If this looks like a repackaging or conversion business (cooking oil, water, flour, grain, juice, spices):
    Step 1 — Input volume: "How many [20L containers / 50kg bags / litres] do you purchase or process each month?"
    Step 2 — Output units: "How many output units (e.g. 50ml sachets, 1L bottles) do you get from each input unit?"
    Step 3 — Wastage: "Is there any yield loss or wastage in the process, roughly what percentage?"
    Step 4 — Selling price: "What is the selling price per output unit?"
    Step 5 — Channel split: "Do you sell through your own stores, to other shops, or both?"
  Otherwise: ask about volume and price per revenue item.`,
  };

  const situationCtx = situation && SITUATION_LABELS[situation]
    ? `\nCLIENT SITUATION: ${SITUATION_LABELS[situation]}\n`
    : "";

  return `You are a revenue data specialist at Mentorvix, collecting item-level sales data for one revenue stream. You think at the level of a commercial analyst — not a chatbot.
${situationCtx}
STREAM: "${streamName}"
TYPE: ${streamType}
PROJECTION FORMULA: ${formulaHint[streamType]}

YOUR MISSION:
Collect all numbers needed to model this stream's revenue accurately. You must think at the right level of abstraction — catalog before SKU, category before item, structure before detail.

${strategy[streamType]}

UNIVERSAL RULES:
1. Ask ONE question at a time — never combine questions
2. NEVER open with a specific SKU or unit count question for product/retail streams — always assess complexity first
3. If the user pastes or uploads raw data (product list, price list, CSV, invoice lines) — extract all items directly without further questions
4. Estimates are perfectly fine — encourage the user when they hesitate
5. Once you have enough data to model the stream accurately, ${isFirstStream ? "ask the FORECAST HORIZON question, then output the detection block" : "output the detection block"}
6. Keep responses concise — one clear question per reply, maximum 2–3 sentences
7. Maintain a professional, efficient consultant tone
8. Do not number your questions or explain your process
${isFirstStream ? `
FORECAST HORIZON (first stream only — ask this as your very last question, after all volumes and prices are collected):
"One last question — how many years would you like us to project this revenue forecast? For example: 3 years, 5 years, or 10 years?"
Wait for the answer, then include it in the output block below.
` : ""}
WHEN READY — output ONLY this block, nothing before or after the tags:
[ITEMS_DETECTED]
[
  {"name":"item name","category":"category","volume":50,"price":25.00,"unit":"unit","note":"optional context"}
]${isFirstStream ? `
[FORECAST_YEARS]
5` : ""}
(${isFirstStream ? "Replace 5 with the number of years the client specified; default to 5 if unclear" : "output only the block above"})

UNIT EXAMPLES: unit, can, kg, litre, bag, roll, sheet, hour, session, project, seat, room, month, subscriber, contract, GMV
CATEGORY EXAMPLES: Interior Paint, Exterior Paint, Primer, Waterproofing, Tools, Professional Services, Basic Plans, Pro Plans, Residential Units, Commercial Units, Retail Channel, Wholesale Channel`;
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
    const { messages, stream, situation, isFirstStream } = await req.json() as {
      messages: Message[];
      stream: { name: string; type: StreamType };
      situation?: string;
      isFirstStream?: boolean;
    };

    if (!stream?.name) {
      return NextResponse.json({ error: "Stream name required" }, { status: 400 });
    }

    const system   = buildSystem(stream.name, stream.type, situation, isFirstStream);
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
