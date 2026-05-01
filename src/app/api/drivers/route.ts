import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

type Message = { role: "user" | "assistant"; content: string };
type StreamType = "product" | "service" | "subscription" | "rental" | "marketplace" | "contract" | "custom";

const SITUATION_LABELS: Record<string, string> = {
  new_business:    "STARTING A NEW BUSINESS — use future/planned language (will, planning to, expecting). Never ask about current sales.",
  existing:        "EXISTING OPERATING BUSINESS — ask about current actuals.",
  expansion:       "EXPANSION / GROWTH — distinguish existing vs. new/planned revenue.",
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

  // What each stream type needs — used to guide extraction, NOT as a question script
  const typeNeeds: Record<StreamType, string> = {
    product: `
WHAT TO EXTRACT for product streams:
- Item/SKU names (extract from stream name if enumerated — e.g. "White Maize and Soya Beans" → two items)
- Monthly volume per item (units, kg, litres, bags, etc.)
- Selling price per unit
- Cost price per unit / purchase cost (what the business pays to acquire or produce each unit — needed for gross margin)
If the stream name already lists specific products, those ARE the items — do not ask how many SKUs.
For many items (20+), collect at category level. Ask for table: "Product | Monthly volume | Selling price | Cost price"
If the user gives all data in one message, output [ITEMS_DETECTED] immediately.`,

    service: `
WHAT TO EXTRACT for service streams:
- Service types offered
- Monthly client/job volume per service type
- Average fee per service type (selling price)
- Direct cost per job/session if applicable (subcontractor, materials — for gross margin)`,

    subscription: `
WHAT TO EXTRACT for subscription streams:
- Plan/tier names
- Active subscriber count per tier
- Monthly fee per tier
- Direct cost per subscriber per month (hosting, fulfilment cost — if applicable)
- New subscribers per month (if given)
- Churn rate % (if given)`,

    rental: `
WHAT TO EXTRACT for rental streams:
- Unit/asset types available for rent
- Number of units per type
- Monthly rate per unit
- Direct cost per unit per month (maintenance, cleaning, management fee — if applicable)
- Occupancy % (if given, otherwise assume 100% or ask once)`,

    marketplace: `
WHAT TO EXTRACT for marketplace/commission streams:
- Transaction type(s)
- Monthly transaction value (GMV)
- Commission or take rate %
- Direct cost of facilitating transactions (payment fees, platform costs — if applicable)`,

    contract: `
WHAT TO EXTRACT for contract streams:
- Contract/agreement types
- Number of active contracts
- Average monthly value per contract
- Direct cost of fulfilling each contract (materials, labour — for gross margin)
- Duration and renewal rate (if given)`,

    custom: `
WHAT TO EXTRACT for conversion/repackaging streams:
- Input material and monthly volume purchased
- Cost per input unit (purchase price)
- Output units and how many per input unit
- Selling price per output unit
- Wastage % (if given)
- Sales channel (if given)`,
  };

  const situationCtx = situation && SITUATION_LABELS[situation]
    ? `\nCLIENT SITUATION: ${SITUATION_LABELS[situation]}\n`
    : "";

  const priorCtx = intakeContext
    ? `\nPRIOR CONVERSATION (business mapping — already completed):\n${intakeContext}\n`
    : "";

  return `You are a revenue data specialist at Mentorvix. Your job: extract every number needed to model this stream's revenue. You think like a commercial analyst — not a chatbot.
${situationCtx}${priorCtx}
STREAM: "${streamName}"
TYPE: ${streamType}
PROJECTION FORMULA: ${formulaHint[streamType]}

${typeNeeds[streamType]}

HOW YOU WORK — EXTRACTION FIRST, ALWAYS:
1. Before every reply: scan the full conversation history AND the prior intake context above.
2. Extract every data point already provided: item names, volumes, prices, units.
3. Identify what is genuinely still missing.
4. Ask at most ONE question — only about what is truly absent.
5. If all required numbers are already present, output [ITEMS_DETECTED] immediately — no further questions.

RULES:
- Never re-ask for something already given in this conversation or in the intake context
- If the user gives multiple items at once (table, list, dump of numbers) — extract all of them, ask nothing
- Use analyst shorthand: "Volume and price for maize?" not "Could you tell me approximately..."
- For many items, ask for a table in ONE request: "Name | Monthly volume | Price — one per line, estimates fine"
- Maximum 2 sentences per reply — no preamble, no explanation
- Estimates are fine — say so once if relevant
- Once you have all required data: ${isFirstStream ? "ask the FORECAST HORIZON questions, then output the detection block" : "output the detection block immediately"}
${isFirstStream ? `
FORECAST QUESTIONS (first stream only — ask after all item data is collected):
Question A: "When should the projection start? For example: this month (${new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}), next month, or a specific future month?"
Question B: "How many years to project? For example: 2, 3, 5, or 10 years?"
Ask A first, wait for the answer, then ask B. Include both in the output block.
` : ""}
OUTPUT — when ready, output ONLY this block, nothing before or after:
[ITEMS_DETECTED]
[
  {"name":"item name","category":"category","volume":50,"price":25.00,"cost_price":18.00,"unit":"unit","note":"optional context"}
]
(cost_price = direct cost per unit for gross margin calculation. Omit if genuinely unknown — do not guess.)${isFirstStream ? `
[FORECAST_YEARS]
5
[FORECAST_START]
${(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })()}` : ""}
${isFirstStream ? `CRITICAL — FORECAST FIELDS:
FORECAST_YEARS: Replace 5 with exactly the integer the user stated. Keep 5 only if no answer given.
FORECAST_START: Replace with YYYY-MM matching what the user said.
  • Month name like "May" → ${new Date().getFullYear()}-05 (next year if already past)
  • "next month" → month after current
  • "this month" or no answer → keep current month shown above
  • Never output a year before ${new Date().getFullYear()}` : ""}

UNIT EXAMPLES: unit, kg, litre, bag, roll, hour, session, project, subscriber, contract, GMV
CATEGORY EXAMPLES: Maize, Soya, Interior Paint, Exterior Paint, Residential Units, Basic Plan, Pro Plan`;
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
