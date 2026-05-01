import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

type Message = { role: "user" | "assistant"; content: string };

function buildSystem(situation?: string, intakeContext?: string): string {
  const isNew = situation === "new_business";
  const priorCtx = intakeContext
    ? `\nBUSINESS CONTEXT (already collected):\n${intakeContext}\n`
    : "";

  return `You are a senior analyst at Mentorvix collecting business profile information for a loan application and business plan.
${priorCtx}
YOUR GOAL:
Extract the key facts needed to complete:
1. Business plan (description, market, team, competitive advantage)
2. Loan documents (loan amount, purpose, collateral, registration, repayment term)
3. Balance sheet inputs (existing debt, owner equity / capital invested)

WHAT TO COLLECT (extract from context first — ask only about genuine gaps):

LOAN REQUEST:
- Loan amount needed
- Purpose of the loan (what it will be used for)
- Requested repayment period (months or years)
- Collateral offered (land title, vehicle logbook, equipment, guarantor, etc.)

BUSINESS BASICS:
- Number of employees (total headcount)
- How long the business has been operating (or planned launch date if new)
- Business registration number (if registered)
- Owner's invested capital / equity in the business

EXISTING DEBT:
- Total outstanding loan balance (all current loans combined)
- Monthly repayment amount on existing loans

BUSINESS PLAN NARRATIVE (extract from what they've said — infer where obvious, ask only if truly missing):
- One-line business description
- Who their target customers are
- What gives them a competitive edge

HOW YOU WORK:
1. Extract everything already stated in the business context above
2. Group remaining gaps into ONE natural question — do not ask one field at a time
3. If the user gives all info in one message, output [BIZPROFILE_DETECTED] immediately
4. Never ask about things already covered above

LANGUAGE: ${isNew ? "Use future/planned language — this is a startup." : "Use present tense — this is an operating business."}

RULES:
- Maximum 2 sentences + one question per reply
- Analyst tone — direct, warm, professional
- If a field is unknown/not applicable, omit it from the output (do not output null values)
- Once all loan-critical fields are collected (amount, purpose, collateral), output the block — other fields are optional

OUTPUT — when ready, output ONLY this block, nothing before or after:
[BIZPROFILE_DETECTED]
{
  "employee_count": 15,
  "years_operating": 3,
  "business_reg_number": "REG-12345",
  "loan_amount_requested": 200000000,
  "loan_purpose": "Purchase maize processing equipment to increase capacity",
  "loan_term_months": 36,
  "collateral_description": "Land title and warehouse equipment",
  "existing_loans_total": 50000000,
  "existing_monthly_repayment": 2500000,
  "employee_cost_monthly": 8000000,
  "premises_type": "rented",
  "premises_monthly_cost": 1500000,
  "business_description": "Wholesale maize supplier to animal feed manufacturers",
  "target_market": "Animal feed manufacturers and large-scale poultry farms",
  "competitive_advantage": "Direct farm sourcing and guaranteed monthly volumes"
}
(Include only fields that were actually provided. Omit unknown fields entirely — do not output null.)`;
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
    max_tokens: 700,
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
    const { messages, situation, intakeContext } = await req.json() as {
      messages: Message[];
      situation?: string;
      intakeContext?: string;
    };

    const system   = buildSystem(situation, intakeContext);
    const provider = chooseProvider();
    const text     = provider === "gemini"
      ? await callGemini(messages ?? [], system)
      : await callOpenAI(messages ?? [], system);

    return NextResponse.json({ text, provider });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[bizprofile]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
