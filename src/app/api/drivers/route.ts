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

function buildSystem(streamName: string, streamType: StreamType, situation?: string, isFirstStream?: boolean, intakeContext?: string): string {

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
Never open with a specific SKU or unit count question. Always assess catalog size first — but phrase the question using known context.

STEP 1 — ASSESS CATALOG SIZE:
  Check the prior intake context first.
  — If catalog size or product count is already clear from the intake, skip this step and go straight to STEP 2.
  — Otherwise ask ONE short question. Use the stream name and whatever context you already know to make it specific:
    · Name the stream: "For ${streamName} — how many SKUs in the range? Under 20 / 20–100 / 100+"
    · If multi-location is known: "Across the locations — roughly how many SKUs in total? Under 20 / 20–100 / 100+"
    · If it is a wholesale or distribution stream: "Roughly how many product lines does this stream cover? Under 20 / 20–100 / 100+"
  Never open with a generic question that ignores what is already known about this specific stream.

STEP 2 — ROUTE BASED ON SKU COUNT:
  Under 20 items →
    Request a table in ONE ask — do NOT go product by product:
    "List products — one per line: Product | Units/month | Price
    Example: Interior White 4L | 120 | 18.50 — estimates work"
    Parse every line as a separate item. No further questions per product.

  20–100 items →
    Ask: "Which categories make up most of your sales? (e.g. Interior Paint, Exterior Paint, Primer, Tools)"
    Then for each category: "Monthly units + average price for [category]?"
    Each category = one item in the output.

  100+ items →
    Go straight to category level: "Which main product categories do you carry?"
    Collect category-level volume and average price.
    Offer: "If you have a sales list or CSV, paste it — I'll extract everything."

STEP 3 — STORE MIX (multi-location only, if not already answered in intake):
  "Are sales roughly similar across locations, or does one location drive significantly more?"

STEP 4 — PRICING:
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

  const priorCtx = intakeContext
    ? `\nPRIOR CONVERSATION (business mapping session — already completed):\n${intakeContext}\n\nCRITICAL RULES FROM INTAKE CONTEXT:\n1. Do NOT ask again for anything already answered above.\n2. Your opening question MUST reference the business by name (stream: "${streamName}") and any known details (locations, product type, channels).\n3. If the intake already established catalog size, location count, or service types — use that directly and skip the corresponding collection step.\n4. The intake context overrides generic opening scripts. Start from what you know, not from zero.\n`
    : "";

  return `You are a revenue data specialist at Mentorvix, collecting item-level sales data for one revenue stream. You think at the level of a commercial analyst — not a chatbot.
${situationCtx}${priorCtx}
STREAM: "${streamName}"
TYPE: ${streamType}
PROJECTION FORMULA: ${formulaHint[streamType]}

YOUR MISSION:
Collect all numbers needed to model this stream's revenue accurately. Use the prior conversation context to skip questions already answered. Ask only what is still missing.

${strategy[streamType]}

UNIVERSAL RULES:
1. Use analyst shorthand — "Monthly units? Avg price?" not "Could you tell me approximately..."
2. For known lists (products, categories), request table format in ONE ask: "Name | Volume | Price — one per line"
3. NEVER ask one product at a time when a table would be faster
4. NEVER open with a specific SKU or unit count question for product streams — assess complexity first
5. If the user pastes raw data (CSV, invoice, table) — extract all items immediately, no further questions
6. Estimates are fine — say "estimates work"
7. Once you have enough data, ${isFirstStream ? "ask the FORECAST HORIZON question, then output the detection block" : "output the detection block"}
8. Maximum 2 sentences per reply — no preamble, no explanation of what you are doing
9. Professional and efficient — never casual, never wordy
${isFirstStream ? `
FORECAST QUESTIONS (first stream only — ask these as your last two questions, one at a time, after all volumes and prices are collected):
Question A: "When should the projection start? For example: this month (${new Date().toLocaleString("en-US",{month:"long",year:"numeric"})}), next month, or a specific future month?"
Question B: "And how many years would you like us to project? For example: 2, 3, 4, 5, or 10 years?"
Ask A first, wait for the answer, then ask B, then include both answers in the output block below.
` : ""}
WHEN READY — output ONLY this block, nothing before or after the tags:
[ITEMS_DETECTED]
[
  {"name":"item name","category":"category","volume":50,"price":25.00,"unit":"unit","note":"optional context"}
]${isFirstStream ? `
[FORECAST_YEARS]
5
[FORECAST_START]
${(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; })()}` : ""}
(${isFirstStream ? `CRITICAL INSTRUCTIONS FOR FORECAST FIELDS:
FORECAST_YEARS: Replace 5 with EXACTLY the integer the user stated (3 → 3, 10 → 10). Only keep 5 when the user gave no answer.
FORECAST_START: Replace with YYYY-MM matching what the user said.
  • If they said a month name like "May" → use ${new Date().getFullYear()}-05 (or next year if that month has already passed this year).
  • If they said "next month" → compute the month after the current month shown in Question A.
  • If they said "this month" or gave no answer → keep the current month already shown above.
  • NEVER output a year before ${new Date().getFullYear()}. The date must be ${new Date().getFullYear()} or later.
  • Output the date on its own line immediately after the [FORECAST_START] tag — no extra text.` : "output only the block above"})

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
    const { messages, stream, situation, isFirstStream, intakeContext } = await req.json() as {
      messages: Message[];
      stream: { name: string; type: StreamType };
      situation?: string;
      isFirstStream?: boolean;
      intakeContext?: string;
    };

    if (!stream?.name) {
      return NextResponse.json({ error: "Stream name required" }, { status: 400 });
    }

    const system   = buildSystem(stream.name, stream.type, situation, isFirstStream, intakeContext);
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
