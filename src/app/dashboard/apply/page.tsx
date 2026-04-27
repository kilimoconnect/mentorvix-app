"use client";

import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  getOrCreateApplication, saveStreams, saveStreamItems,
  saveIntakeConversation, saveDriverConversation, saveForecastConfig,
  saveProjectionSnapshot, loadApplicationState, updateApplicationFlags,
  type DbApplication, type ApplicationState,
} from "@/lib/supabase/revenue";
import { CURRENCIES, getCurrencySymbol, makeFmt } from "@/lib/utils/currency";
import {
  ArrowLeft, ArrowRight, Plus, Trash2, Edit3, Check, X,
  BrainCircuit, BarChart3, TrendingUp, ShoppingBag, Briefcase,
  Repeat, Landmark, Zap, CheckCircle2, RefreshCw, Send,
  ChevronDown, ChevronUp, Info, Upload, Pencil,
  Calendar, ChevronRight, ScrollText, Users, FileText,
  Rocket, Store, Wrench, RefreshCcw, Banknote,
  Mic, MicOff, Volume2,
} from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

/** Strip lightweight markdown the AI may emit — bold, italic, inline code, headings, hr */
function cleanAI(text: string): string {
  return text
    .replace(/\*\*\*(.*?)\*\*\*/g, "$1")   // bold+italic
    .replace(/\*\*(.*?)\*\*/g,    "$1")    // bold
    .replace(/\*(.*?)\*/g,        "$1")    // italic
    .replace(/`([^`]+)`/g,        "$1")    // inline code
    .replace(/^#{1,6}\s+/gm,      "")      // headings
    .replace(/^---+\s*$/gm,       "")      // horizontal rules
    .trim();
}

/* ═══════════════════════════════════════ situations ══ */
const SITUATIONS = [
  {
    id: "existing",
    icon: Store,
    title: "Existing Operating Business",
    desc: "My business is already generating revenue",
    insight: "Uses your current revenue base with forward growth and margin assumptions.",
    color: "#059669", bg: "#f0fdf4",
  },
  {
    id: "new_business",
    icon: Rocket,
    title: "New Business Launch",
    desc: "Launching a new company, product, or brand",
    insight: "Builds from zero — projects market entry, ramp-up curve, and unit economics.",
    color: "#0e7490", bg: "#f0f9ff",
  },
  {
    id: "expansion",
    icon: TrendingUp,
    title: "Expansion & Growth",
    desc: "Adding locations, products, or capacity to an existing business",
    insight: "Models current operations plus incremental expansion revenue and cost layers.",
    color: "#7c3aed", bg: "#faf5ff",
  },
  {
    id: "working_capital",
    icon: Banknote,
    title: "Working Capital Need",
    desc: "Short-term funding for operations, inventory, or a busy season",
    insight: "Short-term cashflow model focused on liquidity cycles and operational coverage.",
    color: "#b45309", bg: "#fffbeb",
  },
  {
    id: "asset_purchase",
    icon: Wrench,
    title: "Asset / Equipment Purchase",
    desc: "Buying equipment, vehicles, or machinery",
    insight: "Includes depreciation schedules and asset-backed revenue uplift projections.",
    color: "#0f766e", bg: "#f0fdfa",
  },
  {
    id: "turnaround",
    icon: RefreshCcw,
    title: "Recovery & Restructuring",
    desc: "Revenue has declined — need restructuring or a cash injection",
    insight: "Applies recovery benchmarks and restructuring cost assumptions to the model.",
    color: "#e11d48", bg: "#fff1f2",
  },
] as const;

type SituationId = typeof SITUATIONS[number]["id"];

/* Likely revenue model labels shown before AI detects anything */
const SITUATION_LIKELY_MODELS: Record<string, string[]> = {
  existing:        ["Product Sales", "Service", "Mixed"],
  new_business:    ["Subscription", "Retail", "Service"],
  expansion:       ["Product Sales", "Licensing", "Service"],
  working_capital: ["Service", "Retail"],
  asset_purchase:  ["Rental", "Service"],
  turnaround:      ["Product Sales", "Service"],
};

/* Analyst notes per situation — shown in collapsible rail */
const SITUATION_ANALYST_NOTES: Record<string, string> = {
  existing:        "Existing business likely runs a mixed model — expect Product + Service streams.",
  new_business:    "New launch — revenue ramp-up from month 1 expected. Build unit economics carefully.",
  expansion:       "Expansion model: incremental revenue layered on top of existing base operations.",
  working_capital: "Working capital focus: short-cycle cashflow model — seasonal peaks likely.",
  asset_purchase:  "Asset-driven: watch for rental or service revenue directly tied to the asset.",
  turnaround:      "Recovery model: declining revenue baseline — restructuring pathway will be applied.",
};

/* Situation-specific example answers for the right rail */
const SITUATION_EXAMPLES: Record<string, string[]> = {
  existing:        ["We have 3 retail stores selling construction materials", "We offer IT consulting on monthly retainer", "We manufacture and sell packaged food wholesale"],
  new_business:    ["We're launching a subscription-based meal kit delivery", "We plan to open a gym with membership tiers", "We're building a B2B SaaS platform for SMEs"],
  expansion:       ["We're opening 2 new branches of our existing pharmacy", "We're adding an e-commerce channel to our retail stores", "We're licensing our brand to distributors in 3 new regions"],
  working_capital: ["We need inventory funding ahead of the holiday season", "We have a large contract starting next quarter", "We need to bridge a 60-day payment gap from a key client"],
  asset_purchase:  ["We're buying 5 delivery trucks for our logistics fleet", "We need 2 industrial ovens to expand production", "We're purchasing CNC machinery for our fabrication shop"],
  turnaround:      ["Our restaurant revenue dropped 40% — need to restructure", "We lost our largest client and need capital to diversify", "We have high debt service eating into operating margins"],
};

/* ═══════════════════════════════════════ types ══ */
type StreamType = "product" | "service" | "subscription" | "rental" | "marketplace" | "contract" | "custom";
type Confidence = "high" | "medium" | "low";
type Provider   = "openai" | "gemini";
type DriverMode = "chat" | "import" | "manual";

interface ChatMessage { role: "user" | "assistant"; content: string; }
interface StreamItem  { id: string; name: string; category: string; volume: number; price: number; unit: string; note?: string; }
interface RevenueStream {
  id: string; name: string; type: StreamType; confidence: Confidence;
  items: StreamItem[];
  // Growth model — driver-based (volume × price, compounded separately)
  scenario:             GrowthScenario;    // preset selector
  volumeGrowthPct:      number;            // % per month (unit/volume growth)
  annualPriceGrowthPct: number;            // % per year  (price/ARPU uplift)
  monthlyGrowthPct:     number;            // effective combined rate — written to DB
  // Stream-type specific drivers
  subNewPerMonth:     number;   // subscription: new subscribers per month
  subChurnPct:        number;   // subscription: monthly churn %
  rentalOccupancyPct: number;   // rental: % of units occupied
  driverMessages: ChatMessage[];
  driverDone: boolean;
}

/* ═══════════════════════════════════════ constants ══ */
const STREAM_META: Record<StreamType, {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string; bg: string; desc: string;
}> = {
  product:      { label: "Product Sales",            icon: ShoppingBag, color: "#0e7490", bg: "#f0f9ff", desc: "Physical goods, SKUs, merchandise" },
  service:      { label: "Service / Project",        icon: Briefcase,   color: "#7c3aed", bg: "#faf5ff", desc: "Consulting, skills-based work, projects" },
  subscription: { label: "Subscription / MRR",       icon: Repeat,      color: "#059669", bg: "#f0fdf4", desc: "Recurring memberships, SaaS, retainers" },
  rental:       { label: "Rental / Lease",           icon: Landmark,    color: "#b45309", bg: "#fffbeb", desc: "Property, equipment, vehicle rental" },
  marketplace:  { label: "Marketplace / Commission", icon: TrendingUp,  color: "#e11d48", bg: "#fff1f2", desc: "Commission, brokerage, platform take rate" },
  contract:     { label: "Contract / B2B Deal",      icon: ScrollText,  color: "#0f766e", bg: "#f0fdfa", desc: "Fixed-term supply agreements, tenders" },
  custom:       { label: "Custom Stream",            icon: Zap,         color: "#6366f1", bg: "#eef2ff", desc: "Other income that doesn't fit above" },
};

const CONF_STYLE: Record<Confidence, string> = {
  high:   "bg-emerald-50 text-emerald-700 border-emerald-100",
  medium: "bg-amber-50   text-amber-700   border-amber-100",
  low:    "bg-red-50     text-red-600     border-red-100",
};

/* ═════════════════════════════ growth model ══ */
type GrowthScenario = "conservative" | "base" | "growth";

const GROWTH_PRESETS: Record<GrowthScenario, {
  label: string; desc: string; volPct: number; pricePct: number; confidence: Confidence;
}> = {
  conservative: { label: "Conservative", desc: "Low growth, stable pricing",  volPct: 0.5, pricePct: 3.0, confidence: "high"   },
  base:         { label: "Base",         desc: "Realistic execution",          volPct: 1.5, pricePct: 5.0, confidence: "medium" },
  growth:       { label: "Growth Case",  desc: "Strong performance scenario",  volPct: 3.0, pricePct: 8.0, confidence: "low"    },
};

function effectiveMonthlyGrowth(volPct: number, annualPricePct: number): number {
  return parseFloat((volPct + annualPricePct / 12).toFixed(2));
}

const COL_LABELS: Record<StreamType, { vol: string; price: string; rev: string }> = {
  product:      { vol: "Units/mo",       price: "Unit Price",     rev: "Monthly Rev"   },
  service:      { vol: "Clients/mo",     price: "Avg Fee",        rev: "Monthly Rev"   },
  subscription: { vol: "Subscribers",    price: "Monthly Fee",    rev: "MRR"           },
  rental:       { vol: "Units",          price: "Rate/mo",        rev: "Potential Rev" },
  marketplace:  { vol: "GMV/mo",         price: "Commission %",   rev: "Net Commission"},
  contract:     { vol: "Contracts",      price: "Monthly Value",  rev: "Monthly Rev"   },
  custom:       { vol: "Volume",         price: "Price",          rev: "Monthly Rev"   },
};

// Distinct colour palette for revenue-mix chart (one per stream)
const MIX_COLORS = [
  "#0e7490","#7c3aed","#059669","#b45309","#e11d48","#6366f1",
  "#0891b2","#8b5cf6","#0f766e","#dc2626","#d97706","#2563eb",
];

/* ═══════════════════════════════════════ shared voice utilities ══ */
function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang.startsWith("en"));
  const priority: ((v: SpeechSynthesisVoice) => boolean)[] = [
    (v) => /neural|enhanced|premium|natural/i.test(v.name) && v.lang === "en-US",
    (v) => /neural|enhanced|premium|natural/i.test(v.name) && v.lang.startsWith("en"),
    (v) => /online/i.test(v.name) && v.lang === "en-US",
    (v) => /online/i.test(v.name) && v.lang.startsWith("en"),
    (v) => /samantha|karen|victoria|moira/i.test(v.name),
    (v) => /aria|jenny|guy|emma|brian/i.test(v.name),
    (v) => /google us english/i.test(v.name),
    (v) => v.lang === "en-US",
    (v) => v.lang.startsWith("en"),
  ];
  for (const test of priority) { const m = en.find(test); if (m) return m; }
  return voices[0] ?? null;
}

function resolveVoice(
  cached: React.MutableRefObject<SpeechSynthesisVoice | null>
): Promise<SpeechSynthesisVoice | null> {
  return new Promise((resolve) => {
    if (cached.current) { resolve(cached.current); return; }
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      const v = pickBestVoice(voices);
      cached.current = v;
      resolve(v);
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        const v = pickBestVoice(window.speechSynthesis.getVoices());
        cached.current = v;
        window.speechSynthesis.onvoiceschanged = null;
        resolve(v);
      };
    }
  });
}

/* ═══════════════════════════════════════ helpers ══ */
let _id = 0;
const uid = () => `i${++_id}`;

/** True if the string looks like a Postgres UUID (came from the DB) */
const isDbId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function makeStream(name: string, type: StreamType, confidence: Confidence): RevenueStream {
  const base = GROWTH_PRESETS.base;
  return {
    id: uid(), name, type, confidence, items: [],
    scenario: "base",
    volumeGrowthPct:      base.volPct,
    annualPriceGrowthPct: base.pricePct,
    monthlyGrowthPct:     effectiveMonthlyGrowth(base.volPct, base.pricePct),
    subNewPerMonth: 0, subChurnPct: 0, rentalOccupancyPct: 100,
    driverMessages: [], driverDone: false,
  };
}

function itemMonthlyRev(item: StreamItem, type: StreamType): number {
  if (type === "marketplace") return item.volume * (item.price / 100);
  return item.volume * item.price;
}

function streamMRR(s: RevenueStream): number {
  const occ = (s.rentalOccupancyPct ?? 100) / 100;
  return s.items.reduce((sum, it) => {
    if (s.type === "marketplace") return sum + it.volume * (it.price / 100);
    if (s.type === "rental")      return sum + it.volume * it.price * occ;
    return sum + it.volume * it.price;
  }, 0);
}

type CurrencyCode = string;

/* ═══════════════════════════════════════ projection ══ */
interface ProjMonth {
  index: number; year: number; monthLabel: string; yearMonth: string; total: number;
  byStream: {
    id: string; name: string; type: StreamType; rev: number;
    byCategory: Record<string, { rev: number; items: { name: string; rev: number }[] }>;
  }[];
}

function projectRevenue(streams: RevenueStream[], totalMonths: number, startDate: Date): ProjMonth[] {
  // Subscription running totals — local to this call (pure function)
  const subTotals: Record<string, number> = {};
  streams.forEach((s) => {
    if (s.type === "subscription") {
      subTotals[s.id] = Math.max(1, s.items.reduce((a, it) => a + it.volume, 0));
    }
  });

  return Array.from({ length: totalMonths }, (_, i) => {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);

    const byStream = streams.map((s) => {
      const byCategory: Record<string, { rev: number; items: { name: string; rev: number }[] }> = {};
      let streamRev = 0;

      const addItem = (name: string, cat: string, rev: number) => {
        const c = cat || "Other";
        if (!byCategory[c]) byCategory[c] = { rev: 0, items: [] };
        byCategory[c].rev += rev;
        byCategory[c].items.push({ name, rev });
        streamRev += rev;
      };

      // Shared growth factors — volume and price compound independently
      const volFactor   = Math.pow(1 + (s.volumeGrowthPct      ?? 0) / 100,  i);
      const priceFactor = Math.pow(1 + (s.annualPriceGrowthPct ?? 0) / 1200, i); // annual → per-month

      if (s.type === "subscription") {
        // Churn model: subscribers_t = subscribers_{t-1} + new - churn
        if (i > 0) {
          const churn = Math.round(subTotals[s.id] * (s.subChurnPct ?? 0) / 100);
          subTotals[s.id] = Math.max(0, subTotals[s.id] + (s.subNewPerMonth ?? 0) - churn);
        }
        const initial = Math.max(1, s.items.reduce((a, it) => a + it.volume, 0));
        const subFactor = subTotals[s.id] / initial;
        // Subscription: volume growth through churn model; price uplift applied separately
        s.items.forEach((it) => addItem(it.name, it.category, Math.round(it.volume * it.price * subFactor * priceFactor)));

      } else if (s.type === "rental") {
        // Revenue = units × rate × occupancy% × volume growth × price growth
        const occ = (s.rentalOccupancyPct ?? 100) / 100;
        s.items.forEach((it) => addItem(it.name, it.category, Math.round(it.volume * volFactor * it.price * priceFactor * occ)));

      } else if (s.type === "marketplace") {
        // Revenue = GMV × commission% — GMV grows with volume, commission rate may increase with price
        s.items.forEach((it) => addItem(it.name, it.category, Math.round(it.volume * volFactor * (it.price / 100) * priceFactor)));

      } else {
        // product, service, contract, custom → (units × volFactor) × (price × priceFactor)
        s.items.forEach((it) => addItem(it.name, it.category, Math.round(it.volume * volFactor * it.price * priceFactor)));
      }

      return { id: s.id, name: s.name, type: s.type, rev: streamRev, byCategory };
    });

    return {
      index: i, year: d.getFullYear(),
      monthLabel: d.toLocaleDateString("en-US", { month: "short" }),
      yearMonth:  d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      total: byStream.reduce((a, b) => a + b.rev, 0),
      byStream,
    };
  });
}

function groupByYear(months: ProjMonth[]) {
  // Use rolling 12-month periods (Year 1 = months 0-11, Year 2 = 12-23, …)
  // so each period is exactly 12 months regardless of the start date.
  // Calendar-year grouping causes partial first/last years when start ≠ Jan.
  const map = new Map<number, ProjMonth[]>();
  months.forEach((m) => {
    const period = Math.floor(m.index / 12);
    if (!map.has(period)) map.set(period, []);
    map.get(period)!.push(m);
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([period, ms]) => ({
      year:       period + 1,                    // 1-based: Year 1, Year 2 …
      months:     ms,
      total:      ms.reduce((a, b) => a + b.total, 0),
      startLabel: ms[0].yearMonth,               // e.g. "Apr 2026"
      endLabel:   ms[ms.length - 1].yearMonth,   // e.g. "Mar 2027"
    }));
}

/* ═══════════════════════════════════════ parsing ══ */
function parseItems(text: string): StreamItem[] | null {
  const idx = text.indexOf("[ITEMS_DETECTED]");
  if (idx === -1) return null;
  try {
    let jsonPart = text.slice(idx + "[ITEMS_DETECTED]".length).trim();
    // Strip any trailing detection tags so JSON.parse doesn't choke on them
    const nextTag = jsonPart.search(/\[FORECAST_YEARS\]|\[FORECAST_START\]/);
    if (nextTag !== -1) jsonPart = jsonPart.slice(0, nextTag).trim();
    const arr = JSON.parse(jsonPart) as
      { name: string; category?: string; volume?: number; price?: number; unit?: string; note?: string }[];
    return arr.map((a) => ({
      id: uid(), name: a.name, category: a.category ?? "General",
      volume: a.volume ?? 0, price: a.price ?? 0, unit: a.unit ?? "unit", note: a.note,
    }));
  } catch { return null; }
}

function parseForecastYears(text: string): number | null {
  const idx = text.indexOf("[FORECAST_YEARS]");
  if (idx === -1) return null;
  const after = text.slice(idx + "[FORECAST_YEARS]".length).trim();
  const n = parseInt(after.split(/[\s\n,]/)[0], 10);
  return !isNaN(n) && n >= 1 && n <= 50 ? n : null;
}

/** Parses [FORECAST_START] YYYY-MM → { year, month } (month is 0-indexed) */
function parseForecastStart(text: string): { year: number; month: number } | null {
  const idx = text.indexOf("[FORECAST_START]");
  if (idx === -1) return null;
  const after = text.slice(idx + "[FORECAST_START]".length).trim();
  const m = after.match(/(\d{4})[^\d]?(\d{1,2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1; // to 0-indexed
  if (isNaN(year) || isNaN(month) || month < 0 || month > 11) return null;
  return { year, month };
}

function parseStreams(text: string): RevenueStream[] | null {
  const idx = text.indexOf("[STREAMS_DETECTED]");
  if (idx === -1) return null;
  try {
    const arr = JSON.parse(text.slice(idx + "[STREAMS_DETECTED]".length).trim()) as
      { name: string; type: StreamType; confidence: Confidence }[];
    return arr.map((s) => makeStream(s.name, s.type ?? "custom", s.confidence ?? "medium"));
  } catch { return null; }
}

/* ═══════════════════════════════════════ EditableName ══ */
function EditableName({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = () => { onChange(draft); setEditing(false); };
  return editing ? (
    <div className="flex items-center gap-1">
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        className="text-sm font-semibold border-b border-cyan-500 outline-none bg-transparent text-slate-800 w-52" />
      <button onClick={commit}><Check className="w-3.5 h-3.5 text-emerald-500" /></button>
      <button onClick={() => setEditing(false)}><X className="w-3.5 h-3.5 text-slate-400" /></button>
    </div>
  ) : (
    <div className="flex items-center gap-1.5 group cursor-pointer" onClick={() => { setDraft(value); setEditing(true); }}>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
      <Edit3 className="w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors" />
    </div>
  );
}

/* ═══════════════════════════════════════ StreamTypeControls ══ */
// Stream-type-specific parameter panel shown inside ItemTable
function StreamTypeControls({ stream, onUpdate }: { stream: RevenueStream; onUpdate: (s: RevenueStream) => void }) {
  if (stream.type === "subscription") {
    return (
      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-emerald-600" />
          <span className="text-xs font-semibold text-emerald-700">Subscription Growth Model</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">New subscribers / month</label>
            <input type="number" min={0} value={stream.subNewPerMonth ?? 0}
              onChange={(e) => onUpdate({ ...stream, subNewPerMonth: Number(e.target.value) })}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:border-emerald-400 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Monthly churn %</label>
            <input type="number" min={0} max={100} step={0.1} value={stream.subChurnPct ?? 0}
              onChange={(e) => onUpdate({ ...stream, subChurnPct: Number(e.target.value) })}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:border-emerald-400 focus:outline-none" />
          </div>
        </div>
        {(stream.subNewPerMonth > 0 || stream.subChurnPct > 0) && (
          <p className="text-xs text-emerald-600">
            Steady-state subscribers:{" "}
            <span className="font-bold">
              {stream.subChurnPct > 0
                ? Math.round(stream.subNewPerMonth / (stream.subChurnPct / 100)).toLocaleString()
                : "∞ (no churn)"}
            </span>
          </p>
        )}
      </div>
    );
  }

  if (stream.type === "rental") {
    return (
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <Landmark className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-xs font-semibold text-amber-700 flex-shrink-0">Occupancy rate</span>
          <input type="range" min={0} max={100} step={1} value={stream.rentalOccupancyPct ?? 100}
            onChange={(e) => onUpdate({ ...stream, rentalOccupancyPct: Number(e.target.value) })}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer" style={{ accentColor: "#b45309" }} />
          <span className="text-xs font-bold w-10 text-right text-amber-700 flex-shrink-0">
            {stream.rentalOccupancyPct ?? 100}%
          </span>
        </div>
        <p className="text-xs text-amber-600 mt-2 ml-6">
          Effective monthly revenue = Units × Rate × {(stream.rentalOccupancyPct ?? 100)}%
        </p>
      </div>
    );
  }

  if (stream.type === "marketplace") {
    return (
      <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
        <p className="text-xs text-rose-700">
          <span className="font-semibold">Marketplace formula:</span>{" "}
          Net Commission = GMV × Commission % ÷ 100. Enter GMV in Volume column, commission rate (e.g. 5) in Price column.
        </p>
      </div>
    );
  }

  if (stream.type === "contract") {
    return (
      <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-3">
        <p className="text-xs text-teal-700">
          <span className="font-semibold">Contract formula:</span>{" "}
          Monthly Revenue = Active Contracts × Monthly Contract Value. Enter the number of contracts in Volume and the monthly value per contract in Price.
        </p>
      </div>
    );
  }

  return null;
}

/* ═══════════════════════════════════════ ItemRow ══ */
function ItemRow({
  item, type, onChange, onDelete, fmt, currencySymbol,
}: { item: StreamItem; type: StreamType; onChange: (i: StreamItem) => void; onDelete: () => void; fmt: (n: number) => string; currencySymbol: string }) {
  const upN = (k: keyof StreamItem, v: string | number) => onChange({ ...item, [k]: v });
  const rev = itemMonthlyRev(item, type);
  return (
    <tr className="group border-t border-slate-100 hover:bg-slate-50 transition-colors">
      <td className="px-3 py-2">
        <input value={item.name} onChange={(e) => upN("name", e.target.value)}
          className="w-full text-xs text-slate-800 bg-transparent border-b border-transparent group-hover:border-slate-200 focus:border-cyan-400 outline-none" />
      </td>
      <td className="px-3 py-2">
        <input value={item.category} onChange={(e) => upN("category", e.target.value)}
          className="w-full text-xs text-slate-500 bg-transparent border-b border-transparent group-hover:border-slate-200 focus:border-cyan-400 outline-none" />
      </td>
      <td className="px-3 py-2">
        <input type="number" value={item.volume || ""} placeholder="0"
          onChange={(e) => upN("volume", Number(e.target.value))}
          className="w-20 text-xs text-right text-slate-700 bg-transparent border-b border-transparent group-hover:border-slate-200 focus:border-cyan-400 outline-none" />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-0.5">
          <span className="text-xs text-slate-300">{type === "marketplace" ? "%" : currencySymbol}</span>
          <input type="number" value={item.price || ""} placeholder="0"
            onChange={(e) => upN("price", Number(e.target.value))}
            className="w-20 text-xs text-right text-slate-700 bg-transparent border-b border-transparent group-hover:border-slate-200 focus:border-cyan-400 outline-none" />
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <span className="text-xs font-semibold" style={{ color: "#0e7490" }}>{fmt(rev)}</span>
      </td>
      <td className="px-2 py-2 text-right opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onDelete} className="text-slate-300 hover:text-red-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
}

/* ═══════════════════════════════════════ ItemTable ══ */
function ItemTable({ stream, onUpdate, fmt, currencySymbol }: { stream: RevenueStream; onUpdate: (s: RevenueStream) => void; fmt: (n: number) => string; currencySymbol: string }) {
  const addItem = () => {
    const item: StreamItem = { id: uid(), name: "New item", category: "General", volume: 0, price: 0, unit: "unit" };
    onUpdate({ ...stream, items: [...stream.items, item] });
  };
  const updateItem = (updated: StreamItem) =>
    onUpdate({ ...stream, items: stream.items.map((i) => (i.id === updated.id ? updated : i)) });
  const deleteItem = (id: string) =>
    onUpdate({ ...stream, items: stream.items.filter((i) => i.id !== id) });

  const total = streamMRR(stream);
  const cats  = [...new Set(stream.items.map((i) => i.category))];
  const cols  = COL_LABELS[stream.type];

  return (
    <div className="space-y-3">
      {/* ── Growth Assumptions card ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Growth Assumptions</p>
          {/* Scenario selector */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
            {(["conservative", "base", "growth"] as GrowthScenario[]).map((sc) => (
              <button key={sc} onClick={() => {
                const p = GROWTH_PRESETS[sc];
                onUpdate({ ...stream, scenario: sc, volumeGrowthPct: p.volPct, annualPriceGrowthPct: p.pricePct, monthlyGrowthPct: effectiveMonthlyGrowth(p.volPct, p.pricePct) });
              }}
                className={`text-[10px] font-bold px-2 py-1 rounded-md capitalize transition-all ${
                  stream.scenario === sc ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600"
                }`}>
                {GROWTH_PRESETS[sc].label}
              </button>
            ))}
          </div>
        </div>

        {/* Scenario description */}
        <p className="text-[10px] text-slate-400 italic">{GROWTH_PRESETS[stream.scenario]?.desc ?? "Custom growth inputs"}</p>

        {/* Volume + Price inputs */}
        <div className="grid grid-cols-2 gap-3">
          {/* Volume Growth — hidden for subscription (churn model drives volume) */}
          {stream.type !== "subscription" && (
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
                Volume Growth
              </label>
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} max={30} step={0.1}
                  value={stream.volumeGrowthPct}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value) || 0;
                    onUpdate({ ...stream, volumeGrowthPct: v, monthlyGrowthPct: effectiveMonthlyGrowth(v, stream.annualPriceGrowthPct ?? 0) });
                  }}
                  className="w-16 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/20" />
                <span className="text-[11px] text-slate-400">% / month</span>
              </div>
            </div>
          )}
          {/* Annual Price Increase — all stream types */}
          <div className={stream.type === "subscription" ? "col-span-2" : ""}>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
              {stream.type === "subscription" ? "Annual ARPU Increase" : "Annual Price Increase"}
            </label>
            <div className="flex items-center gap-1.5">
              <input type="number" min={0} max={50} step={0.5}
                value={stream.annualPriceGrowthPct}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0;
                  onUpdate({ ...stream, annualPriceGrowthPct: v, monthlyGrowthPct: effectiveMonthlyGrowth(stream.volumeGrowthPct ?? 0, v) });
                }}
                className="w-16 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/20" />
              <span className="text-[11px] text-slate-400">% / year</span>
            </div>
          </div>
        </div>

        {/* Effective rate + Confidence */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div>
            <span className="text-[10px] text-slate-400">Effective rate: </span>
            <span className="text-[10px] font-bold text-slate-700" style={{ color: "#0e7490" }}>
              +{stream.monthlyGrowthPct.toFixed(2)}% / month
            </span>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${CONF_STYLE[GROWTH_PRESETS[stream.scenario]?.confidence ?? "medium"]}`}>
            {GROWTH_PRESETS[stream.scenario]?.confidence === "high" ? "High" : GROWTH_PRESETS[stream.scenario]?.confidence === "low" ? "Low" : "Medium"} confidence
          </span>
        </div>
      </div>

      {/* Type-specific controls */}
      <StreamTypeControls stream={stream} onUpdate={onUpdate} />

      {/* Table */}
      {stream.items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Item / Name</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Category</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">{cols.vol}</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">{cols.price}</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">{cols.rev}</th>
                <th className="px-2 py-2.5 w-6" />
              </tr>
            </thead>
            <tbody>
              {cats.map((cat) => {
                const catItems = stream.items.filter((i) => i.category === cat);
                const catRev   = catItems.reduce((a, i) => a + itemMonthlyRev(i, stream.type), 0);
                return (
                  <>
                    <tr key={`cat-${cat}`} className="bg-slate-50/60">
                      <td colSpan={4} className="px-3 py-1.5">
                        <span className="text-xs font-bold text-slate-600">{cat}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <span className="text-xs font-bold text-slate-600">{fmt(catRev)}</span>
                      </td>
                      <td />
                    </tr>
                    {catItems.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        type={stream.type}
                        onChange={updateItem}
                        onDelete={() => deleteItem(item.id)}
                        fmt={fmt}
                        currencySymbol={currencySymbol}
                      />
                    ))}
                  </>
                );
              })}
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <td colSpan={4} className="px-3 py-2.5 text-xs font-bold text-slate-700">Stream Total</td>
                <td className="px-3 py-2.5 text-right text-sm font-bold" style={{ color: "#0e7490" }}>
                  {fmt(total)}/mo
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <button onClick={addItem}
        className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-cyan-600 transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add item manually
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════ DriverChat ══ */
function DriverChat({ stream, onUpdate, onItemsSaved, situation, isFirstStream, onForecastYears, onForecastStart, intakeContext }: {
  stream: RevenueStream;
  onUpdate: (s: RevenueStream) => void;
  /** Called immediately when [ITEMS_DETECTED] fires — saves items + conversation to DB. */
  onItemsSaved?: (streamId: string, items: StreamItem[], driverMessages: ChatMessage[]) => Promise<void>;
  situation: string | null;
  isFirstStream?: boolean;
  onForecastYears?: (years: number) => void;
  onForecastStart?: (year: number, month: number) => void;
  intakeContext?: string;
}) {
  const [input,       setInput]       = useState("");
  const [typing,      setTyping]      = useState(false);
  const [error,       setError]       = useState("");
  const [micActive,   setMicActive]   = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const endRef        = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const cachedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Pre-warm voice on mount
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) resolveVoice(cachedVoiceRef);
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [stream.driverMessages, typing]);
  useEffect(() => {
    if (stream.driverMessages.length === 0 && !typing) callDriver([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const callDriver = async (history: ChatMessage[]) => {
    setTyping(true); setError("");
    try {
      const res = await fetch("/api/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, stream: { name: stream.name, type: stream.type }, situation, isFirstStream, intakeContext }),
      });
      const data = await res.json() as { text?: string; provider?: Provider; error?: string };
      if (data.error) throw new Error(data.error);
      const text = data.text ?? "";
      const items = parseItems(text);
      if (items) {
        // Capture forecast horizon if provided (first stream only)
        const fy = parseForecastYears(text);
        if (fy && onForecastYears) onForecastYears(fy);
        const fs = parseForecastStart(text);
        if (fs && onForecastStart) onForecastStart(fs.year, fs.month);
        const cleanText = text.slice(0, text.indexOf("[ITEMS_DETECTED]")).trim() ||
          `I've collected all the data for ${stream.name}. Review and edit the items below.`;
        const newMsgs = [...history, { role: "assistant" as const, content: cleanText }];
        const newItems = [...stream.items, ...items];
        onUpdate({ ...stream, driverMessages: newMsgs, items: newItems, driverDone: true });
        // Save items + conversation immediately — no debounce, no timer
        if (onItemsSaved) {
          onItemsSaved(stream.id, newItems, newMsgs).catch(
            (e) => console.error("[DriverChat] items save error:", e)
          );
        }
      } else {
        onUpdate({ ...stream, driverMessages: [...history, { role: "assistant" as const, content: text }] });
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setTyping(false); }
  };

  const send = () => {
    const text = input.trim();
    if (!text || typing) return;
    const updated = [...stream.driverMessages, { role: "user" as const, content: text }];
    onUpdate({ ...stream, driverMessages: updated });
    setInput("");
    callDriver(updated);
  };

  // Speaker — per message
  const speakMsg = async (text: string, idx: number) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speakingIdx === idx) { window.speechSynthesis.cancel(); setSpeakingIdx(null); return; }
    window.speechSynthesis.cancel();
    const voice = await resolveVoice(cachedVoiceRef);
    const utt = new SpeechSynthesisUtterance(text);
    if (voice) utt.voice = voice;
    utt.lang = "en-US"; utt.rate = 1.0; utt.pitch = 1.0;
    utt.onend = () => setSpeakingIdx(null);
    utt.onerror = () => setSpeakingIdx(null);
    setSpeakingIdx(idx);
    window.speechSynthesis.speak(utt);
  };

  // Mic — manual stop+send
  const toggleMic = () => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    if (micActive) {
      // Stop and send whatever was captured
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setMicActive(false);
      setTimeout(() => {
        setInput((prev) => { if (prev.trim()) { /* send via effect below */ } return prev; });
      }, 50);
      // Use a ref-based send to avoid stale closure
      sendRef.current();
      return;
    }

    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += (e.results[i][0]?.transcript as string) ?? "";
      }
      if (final) setInput((prev) => prev ? prev.trimEnd() + " " + final.trim() : final.trim());
    };
    rec.onerror = () => { recognitionRef.current = null; setMicActive(false); };
    rec.onend   = () => { if (recognitionRef.current) { recognitionRef.current = null; setMicActive(false); } };
    rec.start();
    recognitionRef.current = rec;
    setMicActive(true);
  };

  // Stable ref so toggleMic can call send() without stale closure
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; });

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3 overflow-y-auto" style={{ maxHeight: 280 }}>
        {stream.driverMessages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
                style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                <BrainCircuit className="w-3 h-3 text-white" />
              </div>
            )}
            <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
              m.role === "user"
                ? "text-white rounded-tr-sm"
                : "bg-slate-50 border border-slate-100 text-slate-800 rounded-tl-sm"
            }`} style={m.role === "user" ? { background: "linear-gradient(135deg,#0e7490,#0891b2)" } : {}}>
              {cleanAI(m.content)}
            </div>
            {m.role === "assistant" && (
              <button onClick={() => speakMsg(m.content, i)}
                title={speakingIdx === i ? "Stop" : "Read aloud"}
                className={`ml-1.5 mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 self-start transition-all ${
                  speakingIdx === i ? "text-cyan-600 bg-cyan-50" : "text-slate-300 hover:text-cyan-500 hover:bg-slate-50"
                }`}>
                <Volume2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {typing && (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
              <BrainCircuit className="w-3 h-3 text-white" />
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-slate-300"
                    animate={{ y: [0, -3, 0] }} transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.12 }} />
                ))}
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 flex items-center gap-2">
            <span>⚠ {error}</span>
            <button onClick={() => callDriver(stream.driverMessages)} className="ml-auto font-semibold underline">Retry</button>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {!stream.driverDone && (
        <div className="flex items-end gap-2">
          {/* Mic — click to start, click again to stop & send */}
          <motion.button whileTap={{ scale: 0.95 }} onClick={toggleMic}
            title={micActive ? "Stop & send" : "Speak your answer"}
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
              micActive
                ? "bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse"
                : "border border-slate-200 text-slate-400 hover:border-cyan-400 hover:text-cyan-600 bg-white"
            }`}>
            {micActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </motion.button>
          <textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={typing}
            placeholder={micActive ? "Listening… tap mic to stop & send" : "Answer the AI's question… (Enter to send)"}
            className={`flex-1 resize-none px-4 py-2.5 border rounded-xl text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 transition-all placeholder:text-slate-300 disabled:opacity-60 ${
              micActive ? "border-red-300 focus:border-red-400 focus:ring-red-400/20"
                        : "border-slate-200 focus:border-cyan-500 focus:ring-cyan-500/20"
            }`} />
          <motion.button whileTap={{ scale: 0.95 }} onClick={send} disabled={!input.trim() || typing}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
            <Send className="w-4 h-4" />
          </motion.button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════ ImportPane ══ */
function ImportPane({ stream, onUpdate }: { stream: RevenueStream; onUpdate: (s: RevenueStream) => void }) {
  const [raw,     setRaw]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setRaw(ev.target?.result as string ?? "");
    reader.readAsText(file);
  };

  const processImport = async () => {
    if (!raw.trim()) return;
    setLoading(true); setError("");
    const prompt = `Here is my raw data for the "${stream.name}" revenue stream. Please extract all items from it:\n\n${raw}`;
    const msgs: ChatMessage[] = [{ role: "user", content: prompt }];
    try {
      const res  = await fetch("/api/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, stream: { name: stream.name, type: stream.type } }),
      });
      const data = await res.json() as { text?: string; error?: string };
      if (data.error) throw new Error(data.error);
      const text  = data.text ?? "";
      const items = parseItems(text);
      if (items) {
        onUpdate({ ...stream, items: [...stream.items, ...items], driverDone: true, driverMessages: msgs });
      } else {
        setError("AI could not detect items. Try formatting your data more clearly.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      {/* Accepted formats */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <p className="text-xs font-semibold text-blue-700 mb-1.5">Paste or upload any of these:</p>
        <div className="flex flex-wrap gap-1.5">
          {["Product list CSV", "Price list", "Invoice lines", "POS export", "Excel rows", "WhatsApp orders", "M-Pesa statement", "Any text data"].map((t) => (
            <span key={t} className="text-xs bg-white border border-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
      </div>

      {/* File upload */}
      <div className="flex items-center gap-3">
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-slate-300 rounded-xl text-xs font-medium text-slate-500 hover:border-cyan-400 hover:text-cyan-600 transition-colors">
          <FileText className="w-4 h-4" /> Upload CSV / TXT file
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.xls,.xlsx" className="hidden" onChange={handleFile} />
        {raw && <span className="text-xs text-emerald-600 font-medium">✓ File loaded — {raw.split("\n").length} lines</span>}
      </div>

      {/* Paste area */}
      <textarea rows={6} value={raw} onChange={(e) => setRaw(e.target.value)}
        placeholder={`Paste raw data here. Examples:\n\nInterior Wall Paint, 50 cans/month, $25 each\nPrimer, 20 units, $15\nBrush set, 80/month, $6\n\nOr paste CSV rows, invoice lines, product lists…`}
        className="w-full resize-none px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all placeholder:text-slate-300 font-mono" />

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>}

      <button onClick={processImport} disabled={!raw.trim() || loading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
        {loading ? (
          <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg> AI is cleaning &amp; grouping items…</>
        ) : (
          <><BrainCircuit className="w-4 h-4" /> Extract &amp; Clean Items with AI</>
        )}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════ RevenueMix ══ */
function RevenueMix({ streams, months, currency }: { streams: RevenueStream[]; months: ProjMonth[]; currency: string | null }) {
  const fmt = makeFmt(currency);
  if (!months.length || !streams.length) return null;

  const totals = streams.map((s, i) => ({
    id: s.id, name: s.name, type: s.type,
    color: MIX_COLORS[i % MIX_COLORS.length],
    total: months.reduce((a, m) => a + (m.byStream.find((b) => b.id === s.id)?.rev ?? 0), 0),
  }));
  const grand = totals.reduce((a, t) => a + t.total, 0);
  if (!grand) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Revenue Mix</p>

      {/* Stacked bar */}
      <div className="flex rounded-lg overflow-hidden h-5 mb-4 gap-px">
        {totals.map((t) => (
          <motion.div key={t.id}
            initial={{ width: 0 }} animate={{ width: `${(t.total / grand) * 100}%` }}
            transition={{ duration: 0.7, ease: EASE }}
            style={{ background: t.color, minWidth: t.total / grand > 0.02 ? undefined : 0 }}
            title={`${t.name}: ${Math.round((t.total / grand) * 100)}%`}
          />
        ))}
      </div>

      {/* Legend grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {totals.map((t) => {
          const pct = Math.round((t.total / grand) * 100);
          return (
            <div key={t.id} className="flex items-center gap-2 min-w-0">
              <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: t.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-700 truncate">{t.name}</p>
                <p className="text-xs text-slate-400">{fmt(t.total)} · {pct}%</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ ForecastView ══ */
function ForecastView({
  streams,
  onUpdateStream,
  horizonYears,
  onHorizonChange,
  startYear,
  startMonth,
  currency,
}: {
  streams:          RevenueStream[];
  onUpdateStream:   (s: RevenueStream) => void;
  horizonYears:     number;
  onHorizonChange?: (years: number) => void;
  startYear:        number;
  startMonth:       number;
  currency:         string | null;
}) {
  const fmt = makeFmt(currency);
  const [view,            setView]            = useState<"annual" | "monthly" | "sensitivity">("annual");
  const [selectedYear,    setSelectedYear]    = useState(1);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [expandedStreams,  setExpandedStreams]  = useState<Set<string>>(new Set());

  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const startDate  = new Date(startYear, startMonth, 1);
  const totalMths  = horizonYears * 12;
  const projection = projectRevenue(streams, totalMths, startDate);
  const years      = groupByYear(projection);
  const grandTotal = years.reduce((a, y) => a + y.total, 0);
  const totalMRR   = streams.reduce((a, s) => a + streamMRR(s), 0);
  const totalItems = streams.reduce((a, s) => a + s.items.length, 0);

  const cagr = years.length > 1 && (years[0]?.total ?? 0) > 0
    ? ((Math.pow(years[years.length - 1].total / years[0].total, 1 / (years.length - 1)) - 1) * 100)
    : null;

  // Dominant scenario across all streams
  const scenarioCounts = streams.reduce((acc, s) => { acc[s.scenario] = (acc[s.scenario] ?? 0) + 1; return acc; }, {} as Partial<Record<GrowthScenario, number>>);
  const dominantScenario: GrowthScenario = (scenarioCounts["growth"] ?? 0) > 0 && (scenarioCounts["growth"] ?? 0) >= (scenarioCounts["base"] ?? 0) && (scenarioCounts["growth"] ?? 0) >= (scenarioCounts["conservative"] ?? 0) ? "growth" : (scenarioCounts["base"] ?? 0) > 0 && (scenarioCounts["base"] ?? 0) >= (scenarioCounts["conservative"] ?? 0) ? "base" : "conservative";

  const applyGlobalScenario = (sc: GrowthScenario) => {
    const p = GROWTH_PRESETS[sc];
    streams.forEach((s) => onUpdateStream({ ...s, scenario: sc, volumeGrowthPct: p.volPct, annualPriceGrowthPct: p.pricePct, monthlyGrowthPct: effectiveMonthlyGrowth(p.volPct, p.pricePct) }));
  };

  const toggleExpanded = (id: string) =>
    setExpandedStreams((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Sensitivity scenario definitions
  const SENSITIVITY_ROWS = [
    { label: "Bear Case",      volMult: 0.25, priceMult: 0.5,  color: "#ef4444" },
    { label: "Conservative",   volMult: 0.5,  priceMult: 1.0,  color: "#f59e0b" },
    { label: "Base (current)", volMult: 1.0,  priceMult: 1.0,  color: "#0e7490", isCurrent: true },
    { label: "Growth Case",    volMult: 2.0,  priceMult: 1.0,  color: "#059669" },
    { label: "Bull Case",      volMult: 3.0,  priceMult: 1.5,  color: "#7c3aed" },
  ] as const;

  // ── Cell helpers ──────────────────────────────────────────────────────────
  const TH = ({ children, cls = "" }: { children: React.ReactNode; cls?: string }) => (
    <th className={`px-3 py-2 text-right text-[11px] font-bold whitespace-nowrap ${cls}`}>{children}</th>
  );
  const TD = ({ children, cls = "", style }: { children: React.ReactNode; cls?: string; style?: React.CSSProperties }) => (
    <td className={`px-3 py-2 text-right text-[11px] tabular-nums whitespace-nowrap ${cls}`} style={style}>{children}</td>
  );

  // ── Stream total for a year ───────────────────────────────────────────────
  const streamYearTotal = (sid: string, yr: ReturnType<typeof groupByYear>[0]) =>
    yr.months.reduce((a, m) => a + (m.byStream.find((b) => b.id === sid)?.rev ?? 0), 0);

  // ── Stream total for a month ──────────────────────────────────────────────
  const streamMonthRev = (sid: string, mRow: ReturnType<typeof projectRevenue>[0]) =>
    mRow.byStream.find((b) => b.id === sid)?.rev ?? 0;

  // ── Quarter totals for monthly view ──────────────────────────────────────
  const selectedYearData = years.find((y) => y.year === selectedYear) ?? years[0];

  // Group months into quarters
  const quarters = selectedYearData
    ? [0,1,2,3].map((qi) => ({
        label: `Q${qi + 1}`,
        months: selectedYearData.months.filter((_, i) => Math.floor(i / 3) === qi),
      })).filter((q) => q.months.length > 0)
    : [];

  return (
    <div className="space-y-4">

      {/* ── Control bar ── */}
      <div className="bg-white rounded-2xl border border-slate-100 px-4 pt-3.5 pb-3 space-y-3">
        {/* Row 1: Global scenario toggle */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">Scenario</span>
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {(["conservative", "base", "growth"] as GrowthScenario[]).map((sc) => {
              const active = dominantScenario === sc;
              const cls = sc === "conservative"
                ? (active ? "bg-amber-500 text-white shadow-sm" : "text-slate-400 hover:text-amber-600")
                : sc === "base"
                  ? (active ? "bg-cyan-600 text-white shadow-sm" : "text-slate-400 hover:text-cyan-700")
                  : (active ? "bg-emerald-500 text-white shadow-sm" : "text-slate-400 hover:text-emerald-600");
              return (
                <button key={sc} onClick={() => applyGlobalScenario(sc)}
                  className={`text-[11px] font-semibold px-3 py-1 rounded-md transition-all ${cls}`}>
                  {GROWTH_PRESETS[sc].label}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] text-slate-400 italic hidden sm:block">
            {GROWTH_PRESETS[dominantScenario].desc} · all streams
          </span>
        </div>
        {/* Row 2: Start date + horizon + view toggle */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-xs text-slate-500">Starting</span>
            <span className="text-xs font-semibold text-slate-700">{MONTH_NAMES[startMonth]} {startYear}</span>
            <span className="text-xs text-slate-300">·</span>
            <span className="text-xs text-slate-500">Horizon</span>
            <select
              value={horizonYears}
              onChange={(e) => onHorizonChange?.(Number(e.target.value))}
              className="text-xs font-semibold text-slate-700 bg-slate-100 border-0 rounded-md px-2 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-500 appearance-none pr-5"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 4px center" }}
            >
              {[1,2,3,4,5,7,10].map((y) => (
                <option key={y} value={y}>{y} {y === 1 ? "year" : "years"}</option>
              ))}
            </select>
          </div>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {(["annual", "monthly", "sensitivity"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-all capitalize ${
                  view === v ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Current Monthly Revenue",             val: fmt(totalMRR),                              sub: "Baseline MRR" },
          { label: `Cumulative ${horizonYears}-Year Revenue`, val: fmt(grandTotal),                        sub: "Total projection" },
          { label: "First-Year Revenue",                  val: fmt(years[0]?.total ?? 0),                  sub: "Months 1 – 12" },
          { label: "Final-Year Revenue",                  val: fmt(years[years.length - 1]?.total ?? 0),   sub: `Year ${horizonYears}` },
        ].map(({ label, val, sub }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 px-4 py-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 leading-tight">{label}</p>
            <p className="text-sm font-bold text-slate-900">{val}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Model Summary Strip ── */}
      <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {[
          { label: "Streams",    val: String(streams.length) },
          { label: "Items",      val: String(totalItems) },
          { label: "Currency",   val: currency ?? "—" },
          { label: "Confidence", val: "Medium", highlight: "amber" },
          { label: "CAGR",       val: cagr !== null ? `${cagr >= 0 ? "+" : ""}${cagr.toFixed(1)}%` : "—", highlight: cagr !== null && cagr > 0 ? "emerald" : "" },
        ].map(({ label, val, highlight }, i) => (
          <div key={label} className={`flex items-center gap-1.5 ${i > 0 ? "sm:border-l sm:border-slate-200 sm:pl-5" : ""}`}>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</span>
            <span className={`text-[11px] font-bold ${highlight === "emerald" ? "text-emerald-600" : highlight === "amber" ? "text-amber-600" : "text-slate-700"}`}>{val}</span>
          </div>
        ))}
      </div>

      {/* ── Annual bar chart ── */}
      {years.length > 0 && grandTotal > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 px-5 pt-4 pb-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Annual Revenue Trajectory</p>
            {cagr !== null && (
              <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1">
                <TrendingUp className="w-3 h-3 text-emerald-600" />
                <span className="text-[10px] font-bold text-emerald-700">CAGR {cagr >= 0 ? "+" : ""}{cagr.toFixed(1)}%</span>
              </div>
            )}
          </div>
          {/* Three independent rows: labels / bars / axis */}
          {(() => {
            const maxY = Math.max(...years.map((yy) => yy.total));
            return (
              <div>
                {/* Row 1 — value + YoY labels (fixed 36px) */}
                <div className="flex gap-3" style={{ height: 36 }}>
                  {years.map((y, i) => {
                    const prev = years[i - 1];
                    const yoy  = prev && prev.total > 0 ? ((y.total - prev.total) / prev.total) * 100 : null;
                    return (
                      <div key={y.year} className="flex-1 flex flex-col items-center justify-end min-w-0">
                        <span className="text-[9px] font-bold text-slate-700 truncate w-full text-center leading-tight">{fmt(y.total)}</span>
                        {yoy !== null
                          ? <span className={`text-[8px] font-bold mt-0.5 ${yoy >= 0 ? "text-emerald-600" : "text-red-500"}`}>{yoy >= 0 ? "▲" : "▼"}{Math.abs(yoy).toFixed(1)}%</span>
                          : <span className="text-[8px] text-transparent mt-0.5" aria-hidden>–</span>
                        }
                      </div>
                    );
                  })}
                </div>
                {/* Row 2 — bars (fixed 96px, grow from bottom) */}
                <div className="flex items-end gap-3 mt-1" style={{ height: 96 }}>
                  {years.map((y, i) => {
                    const pct = maxY > 0 ? (y.total / maxY) * 100 : 4;
                    return (
                      <div key={y.year} className="flex-1 h-full flex items-end min-w-0">
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: `${Math.max(pct, 3)}%` }}
                          transition={{ duration: 0.6, delay: i * 0.07, ease: EASE }}
                          className="w-full rounded-t-lg"
                          style={{ background: i === years.length - 1 ? "#0e7490" : MIX_COLORS[i % MIX_COLORS.length], opacity: 0.88, minHeight: 6 }}
                        />
                      </div>
                    );
                  })}
                </div>
                {/* Row 3 — axis labels (fixed 24px) */}
                <div className="flex gap-3 mt-1.5">
                  {years.map((y) => (
                    <div key={y.year} className="flex-1 text-center min-w-0">
                      <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap">Yr {y.year}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Revenue Mix ── */}
      {(() => {
        if (!projection.length || !streams.length) return null;
        const mixTotals = streams.map((s, i) => ({
          id: s.id, name: s.name,
          color: MIX_COLORS[i % MIX_COLORS.length],
          total: projection.reduce((a, m) => a + (m.byStream.find((b) => b.id === s.id)?.rev ?? 0), 0),
        }));
        const mixGrand = mixTotals.reduce((a, t) => a + t.total, 0);
        if (!mixGrand) return null;
        const isSingle = streams.length === 1;
        return (
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                {isSingle ? "Revenue Concentration" : "Revenue Mix"}
              </p>
              {isSingle && <span className="text-[10px] text-slate-400 italic">Single-stream business profile</span>}
            </div>
            {isSingle ? (
              <div className="flex items-center gap-4">
                <div className="flex-1 bg-slate-100 rounded-lg h-8 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }} animate={{ width: "100%" }}
                    transition={{ duration: 0.7, ease: EASE }}
                    className="h-full rounded-lg flex items-center px-3"
                    style={{ background: mixTotals[0].color }}
                  >
                    <span className="text-[10px] font-bold text-white truncate">{mixTotals[0].name}</span>
                  </motion.div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-900">100%</p>
                  <p className="text-[10px] text-slate-400">{fmt(mixTotals[0].total)} total</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex rounded-lg overflow-hidden h-5 mb-4 gap-px">
                  {mixTotals.map((t) => (
                    <motion.div key={t.id}
                      initial={{ width: 0 }} animate={{ width: `${(t.total / mixGrand) * 100}%` }}
                      transition={{ duration: 0.7, ease: EASE }}
                      style={{ background: t.color, minWidth: t.total / mixGrand > 0.02 ? undefined : 0 }}
                      title={`${t.name}: ${Math.round((t.total / mixGrand) * 100)}%`}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {mixTotals.map((t) => {
                    const pct = Math.round((t.total / mixGrand) * 100);
                    return (
                      <div key={t.id} className="flex items-center gap-2 min-w-0">
                        <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: t.color }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-700 truncate">{t.name}</p>
                          <p className="text-xs text-slate-400">{fmt(t.total)} · {pct}%</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ── Assumptions ── */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <button
          onClick={() => setShowAssumptions((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <TrendingUp className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-xs font-bold text-slate-700 shrink-0">Assumptions</span>
            {!showAssumptions && streams.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[10px] text-slate-400">
                  Vol: <span className="font-semibold text-slate-600">+{streams[0].volumeGrowthPct}%/mo</span>
                </span>
                <span className="text-[10px] text-slate-400">
                  Price: <span className="font-semibold text-slate-600">+{streams[0].annualPriceGrowthPct}%/yr</span>
                </span>
                <span className="text-[10px] text-slate-400">
                  Start: <span className="font-semibold text-slate-600">{MONTH_NAMES[startMonth]} {startYear}</span>
                </span>
                <span className="text-[10px] text-slate-400">
                  Method: <span className="font-semibold text-slate-600">User Input</span>
                </span>
              </div>
            )}
          </div>
          {showAssumptions ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
        </button>
        {showAssumptions && (
          <div className="px-5 pb-5 space-y-4 border-t border-slate-100">
            {streams.map((s, si) => {
              const Meta = STREAM_META[s.type];
              const Icon = Meta.icon;
              const mrr  = streamMRR(s);
              return (
                <div key={s.id} className="pt-4 first:pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: Meta.bg }}>
                      <Icon className="w-3 h-3" style={{ color: Meta.color }} />
                    </div>
                    <span className="text-xs font-semibold text-slate-800">{s.name}</span>
                    {mrr > 0 && <span className="text-xs text-emerald-600 font-medium ml-auto">{fmt(mrr)}/mo baseline</span>}
                  </div>

                  {s.type === "subscription" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">New subscribers / month</label>
                        <input type="number" min={0} value={s.subNewPerMonth}
                          onChange={(e) => onUpdateStream({ ...s, subNewPerMonth: Number(e.target.value) })}
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:border-cyan-400 focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Monthly churn %</label>
                        <input type="number" min={0} max={100} step={0.1} value={s.subChurnPct}
                          onChange={(e) => onUpdateStream({ ...s, subChurnPct: Number(e.target.value) })}
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:border-cyan-400 focus:outline-none" />
                      </div>
                      {(s.subNewPerMonth > 0 || s.subChurnPct > 0) && (
                        <p className="col-span-2 text-[10px] text-emerald-600">
                          Steady-state: <span className="font-bold">
                            {s.subChurnPct > 0 ? Math.round(s.subNewPerMonth / (s.subChurnPct / 100)).toLocaleString() : "∞"} subscribers
                          </span>
                        </p>
                      )}
                    </div>
                  ) : s.type === "rental" ? (
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 flex-shrink-0">Occupancy %</span>
                      <input type="range" min={0} max={100} step={1} value={s.rentalOccupancyPct}
                        onChange={(e) => onUpdateStream({ ...s, rentalOccupancyPct: Number(e.target.value) })}
                        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer" style={{ accentColor: "#b45309" }} />
                      <span className="text-xs font-bold w-10 text-right text-amber-700 flex-shrink-0">{s.rentalOccupancyPct}%</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-500 w-28 shrink-0">Volume growth</span>
                        <input type="range" min={0} max={20} step={0.5} value={s.volumeGrowthPct}
                          onChange={(e) => { const v = parseFloat(e.target.value) || 0; onUpdateStream({ ...s, volumeGrowthPct: v, monthlyGrowthPct: effectiveMonthlyGrowth(v, s.annualPriceGrowthPct ?? 0) }); }}
                          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer" style={{ accentColor: "#0e7490" }} />
                        <span className="text-xs font-bold w-14 text-right shrink-0 text-cyan-700">+{s.volumeGrowthPct}%/mo</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-500 w-28 shrink-0">Annual price rise</span>
                        <input type="range" min={0} max={30} step={0.5} value={s.annualPriceGrowthPct}
                          onChange={(e) => { const v = parseFloat(e.target.value) || 0; onUpdateStream({ ...s, annualPriceGrowthPct: v, monthlyGrowthPct: effectiveMonthlyGrowth(s.volumeGrowthPct ?? 0, v) }); }}
                          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer" style={{ accentColor: "#7c3aed" }} />
                        <span className="text-xs font-bold w-14 text-right shrink-0 text-violet-700">+{s.annualPriceGrowthPct}%/yr</span>
                      </div>
                    </div>
                  )}
                  {si < streams.length - 1 && <div className="mt-4 border-t border-slate-100" />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ══ ANNUAL VIEW — multi-year P&L style ══ */}
      {view === "annual" && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">Revenue Statement</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Annual projection · {streams.length} stream{streams.length !== 1 ? "s" : ""}</p>
            </div>
            <span className="text-[10px] text-slate-400 font-medium">Amounts in {getCurrencySymbol(currency)} ({currency ?? "—"})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              {/* Header */}
              <thead>
                <tr style={{ background: "#042f3d" }}>
                  <th className="px-3 py-3 text-left text-[11px] font-bold text-white sticky left-0 min-w-[180px]" style={{ background: "#042f3d" }}>
                    Revenue Stream
                  </th>
                  {years.map((y) => (
                    <TH key={y.year} cls="text-white">
                      Year {y.year}<span className="block text-[9px] font-normal opacity-60">{y.startLabel} – {y.endLabel}</span>
                    </TH>
                  ))}
                  <TH cls="text-cyan-300 border-l border-white/10">Grand Total</TH>
                  {years.length > 1 && <TH cls="text-slate-300">CAGR</TH>}
                </tr>
              </thead>

              <tbody>
                {/* Section header */}
                <tr style={{ background: "#f0f9ff" }}>
                  <td colSpan={years.length + 3} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-700">
                    Revenue
                  </td>
                </tr>

                {/* One row per stream + expandable item drilldown */}
                {streams.map((s, si) => {
                  const streamColor = MIX_COLORS[si % MIX_COLORS.length];
                  const yearTotals  = years.map((y) => streamYearTotal(s.id, y));
                  const streamGrand = yearTotals.reduce((a, v) => a + v, 0);
                  const sCagr = years.length > 1 && yearTotals[0] > 0
                    ? ((Math.pow(yearTotals[yearTotals.length - 1] / yearTotals[0], 1 / (years.length - 1)) - 1) * 100)
                    : null;
                  const isExpanded  = expandedStreams.has(s.id);
                  const sMRR        = streamMRR(s);
                  return (
                    <>
                      <tr key={s.id} className={si % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                        <td className="px-3 py-2.5 text-[11px] sticky left-0 bg-inherit">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: streamColor }} />
                            <span className="font-medium text-slate-800">{s.name}</span>
                            {s.items.length > 0 && (
                              <button onClick={() => toggleExpanded(s.id)}
                                className="flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-slate-600 ml-1">
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                <span>{s.items.length} item{s.items.length !== 1 ? "s" : ""}</span>
                              </button>
                            )}
                          </div>
                        </td>
                        {yearTotals.map((v, i) => <TD key={i}>{fmt(v)}</TD>)}
                        <TD cls="font-semibold border-l border-slate-100">{fmt(streamGrand)}</TD>
                        {years.length > 1 && (
                          <TD cls={sCagr !== null ? (sCagr >= 0 ? "text-emerald-600" : "text-red-500") : ""}>
                            {sCagr !== null ? `${sCagr >= 0 ? "+" : ""}${sCagr.toFixed(1)}%` : "—"}
                          </TD>
                        )}
                      </tr>
                      {/* Item drilldown rows */}
                      {isExpanded && s.items.map((it) => {
                        const itMRR  = it.volume * (s.type === "marketplace" ? (it.price / 100) : s.type === "rental" ? it.price * ((s.rentalOccupancyPct ?? 100) / 100) : it.price);
                        const frac   = sMRR > 0 ? itMRR / sMRR : 0;
                        return (
                          <tr key={it.id} className="bg-slate-50/30 border-t border-slate-50">
                            <td className="pl-8 pr-3 py-2 text-[10px] text-slate-500 sticky left-0 bg-slate-50/30">
                              <span className="flex items-center gap-1.5">
                                <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                                {it.name}{it.category ? ` · ${it.category}` : ""}
                              </span>
                            </td>
                            {yearTotals.map((yt, i) => (
                              <td key={i} className="px-3 py-2 text-right text-[10px] tabular-nums whitespace-nowrap text-slate-500">
                                {fmt(Math.round(yt * frac))}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right text-[10px] tabular-nums text-slate-500 border-l border-slate-100">
                              {fmt(Math.round(streamGrand * frac))}
                            </td>
                            {years.length > 1 && <td className="px-3 py-2 text-right text-[10px] text-slate-300">—</td>}
                          </tr>
                        );
                      })}
                    </>
                  );
                })}

                {/* Subtotal row */}
                <tr className="border-t-2 border-slate-200" style={{ background: "#f0f9ff" }}>
                  <td className="px-3 py-3 text-[11px] font-bold text-slate-900 sticky left-0" style={{ background: "#f0f9ff" }}>
                    Total Revenue
                  </td>
                  {years.map((y, i) => (
                    <TD key={i} cls="font-bold text-slate-900">{fmt(y.total)}</TD>
                  ))}
                  <TD cls="font-bold border-l border-slate-200" style={{ color: "#0e7490" }}>{fmt(grandTotal)}</TD>
                  {years.length > 1 && (
                    <TD cls={years[0]?.total > 0 ? (years[years.length-1]?.total >= years[0]?.total ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold") : ""}>
                      {years.length > 1 && years[0]?.total > 0
                        ? `${((Math.pow(years[years.length-1].total / years[0].total, 1/(years.length-1)) - 1)*100).toFixed(1)}%`
                        : "—"}
                    </TD>
                  )}
                </tr>

                {/* YoY growth row */}
                {years.length > 1 && (
                  <tr className="border-t border-slate-100 bg-white">
                    <td className="px-3 py-2 text-[10px] text-slate-400 italic sticky left-0 bg-white">YoY Growth</td>
                    {years.map((y, i) => {
                      const prev = years[i - 1];
                      const g = prev ? ((y.total - prev.total) / prev.total) * 100 : null;
                      return (
                        <TD key={i} cls={`text-[10px] italic ${g !== null ? (g >= 0 ? "text-emerald-600" : "text-red-500") : "text-slate-400"}`}>
                          {g !== null ? `${g >= 0 ? "+" : ""}${g.toFixed(1)}%` : "—"}
                        </TD>
                      );
                    })}
                    <TD cls="border-l border-slate-100 text-[10px] text-slate-400">—</TD>
                    {years.length > 1 && <TD cls="text-[10px] text-slate-400">—</TD>}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ MONTHLY VIEW — P&L by month with quarterly subtotals ══ */}
      {view === "monthly" && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          {/* Year selector tabs */}
          <div className="flex items-center gap-0.5 px-4 pt-3 pb-0 border-b border-slate-100">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-2">Year</span>
            {years.map((y) => (
              <button key={y.year} onClick={() => setSelectedYear(y.year)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-t-lg border-x border-t transition-all ${
                  selectedYear === y.year
                    ? "bg-white text-slate-800 border-slate-200"
                    : "text-slate-400 border-transparent hover:text-slate-600"
                }`}>
                Yr {y.year}
              </button>
            ))}
          </div>

          {selectedYearData && (
            <>
              <div className="px-4 py-2 flex items-center justify-between bg-slate-50/50">
                <p className="text-[10px] text-slate-400">
                  Monthly breakdown · {selectedYearData.months.length} months · {streams.length} revenue stream{streams.length !== 1 ? "s" : ""}
                </p>
                <p className="text-[10px] font-semibold text-slate-600">Year total: <span style={{ color: "#0e7490" }}>{fmt(selectedYearData.total)}</span></p>
              </div>
              <div className="overflow-x-auto">
                <table className="border-collapse" style={{ minWidth: "max-content", width: "100%" }}>
                  <thead>
                    {/* Quarter header row */}
                    <tr style={{ background: "#0e7490" }}>
                      <th className="px-3 py-2 text-left text-[10px] font-bold text-white sticky left-0 min-w-[180px]" style={{ background: "#0e7490" }}>
                        Revenue Stream
                      </th>
                      {quarters.map((q) => (
                        <th key={q.label} colSpan={q.months.length + 1}
                          className="px-3 py-2 text-center text-[10px] font-bold text-cyan-200 border-l border-white/20">
                          {q.label}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right text-[10px] font-bold text-cyan-200 border-l border-white/20">
                        Yr {selectedYear}
                      </th>
                    </tr>
                    {/* Month header row */}
                    <tr style={{ background: "#042f3d" }}>
                      <th className="px-3 py-2 text-left text-[10px] text-slate-400 sticky left-0" style={{ background: "#042f3d" }} />
                      {quarters.map((q) => (
                        <>
                          {q.months.map((m) => {
                            const d = new Date(m.yearMonth + "-01");
                            return (
                              <th key={m.yearMonth} className="px-3 py-1.5 text-right text-[10px] font-semibold text-slate-300 border-l border-white/10 whitespace-nowrap">
                                {MONTH_NAMES[d.getMonth()]}
                              </th>
                            );
                          })}
                          <th key={`${q.label}-tot`} className="px-3 py-1.5 text-right text-[10px] font-bold text-cyan-400 border-l border-white/20">
                            {q.label} Total
                          </th>
                        </>
                      ))}
                      <th className="px-3 py-1.5 text-right text-[10px] font-bold text-cyan-400 border-l border-white/20">Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {/* Section header */}
                    <tr style={{ background: "#f0f9ff" }}>
                      <td colSpan={99} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-700">Revenue</td>
                    </tr>

                    {/* Stream rows + item drilldown */}
                    {streams.map((s, si) => {
                      const streamColor = MIX_COLORS[si % MIX_COLORS.length];
                      const yearTotal   = streamYearTotal(s.id, selectedYearData);
                      const isExpanded  = expandedStreams.has(s.id);
                      const sMRR        = streamMRR(s);
                      return (
                        <>
                          <tr key={s.id} className={si % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                            <td className="px-3 py-2 text-[11px] sticky left-0 bg-inherit">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: streamColor }} />
                                <span className="font-medium text-slate-800">{s.name}</span>
                                {s.items.length > 0 && (
                                  <button onClick={() => toggleExpanded(s.id)}
                                    className="flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-slate-600 ml-1">
                                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    <span>{s.items.length} item{s.items.length !== 1 ? "s" : ""}</span>
                                  </button>
                                )}
                              </div>
                            </td>
                            {quarters.map((q) => (
                              <>
                                {q.months.map((m) => (
                                  <TD key={m.yearMonth} cls="border-l border-slate-50/80">
                                    {fmt(streamMonthRev(s.id, m))}
                                  </TD>
                                ))}
                                <TD key={`${q.label}-tot`} cls="font-semibold border-l border-slate-200 bg-slate-50/80">
                                  {fmt(q.months.reduce((a, m) => a + streamMonthRev(s.id, m), 0))}
                                </TD>
                              </>
                            ))}
                            <TD cls="font-bold border-l border-slate-200">{fmt(yearTotal)}</TD>
                          </tr>
                          {/* Item drilldown rows */}
                          {isExpanded && s.items.map((it) => {
                            const itMRR = it.volume * (s.type === "marketplace" ? (it.price / 100) : s.type === "rental" ? it.price * ((s.rentalOccupancyPct ?? 100) / 100) : it.price);
                            const frac  = sMRR > 0 ? itMRR / sMRR : 0;
                            return (
                              <tr key={it.id} className="bg-slate-50/30 border-t border-slate-50">
                                <td className="pl-8 pr-3 py-1.5 text-[10px] text-slate-500 sticky left-0 bg-slate-50/30">
                                  <span className="flex items-center gap-1.5">
                                    <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                                    {it.name}{it.category ? ` · ${it.category}` : ""}
                                  </span>
                                </td>
                                {quarters.map((q) => (
                                  <>
                                    {q.months.map((m) => (
                                      <td key={m.yearMonth} className="px-3 py-1.5 text-right text-[10px] tabular-nums whitespace-nowrap text-slate-400 border-l border-slate-50/80">
                                        {fmt(Math.round(streamMonthRev(s.id, m) * frac))}
                                      </td>
                                    ))}
                                    <td key={`${q.label}-itot`} className="px-3 py-1.5 text-right text-[10px] tabular-nums whitespace-nowrap text-slate-400 font-medium border-l border-slate-200 bg-slate-50/80">
                                      {fmt(Math.round(q.months.reduce((a, m) => a + streamMonthRev(s.id, m), 0) * frac))}
                                    </td>
                                  </>
                                ))}
                                <td className="px-3 py-1.5 text-right text-[10px] tabular-nums whitespace-nowrap text-slate-400 font-medium border-l border-slate-200">
                                  {fmt(Math.round(yearTotal * frac))}
                                </td>
                              </tr>
                            );
                          })}
                        </>
                      );
                    })}

                    {/* Total Revenue row */}
                    <tr className="border-t-2 border-slate-300" style={{ background: "#f0f9ff" }}>
                      <td className="px-3 py-3 text-[11px] font-bold text-slate-900 sticky left-0" style={{ background: "#f0f9ff" }}>
                        Total Revenue
                      </td>
                      {quarters.map((q) => (
                        <>
                          {q.months.map((m) => (
                            <TD key={m.yearMonth} cls="font-bold text-slate-900 border-l border-slate-100">
                              {fmt(m.total)}
                            </TD>
                          ))}
                          <TD key={`${q.label}-tot`} cls="font-bold border-l border-slate-200 bg-slate-100" style={{ color: "#0e7490" }}>
                            {fmt(q.months.reduce((a, m) => a + m.total, 0))}
                          </TD>
                        </>
                      ))}
                      <TD cls="font-bold border-l border-slate-200 text-base" style={{ color: "#0e7490" }}>
                        {fmt(selectedYearData.total)}
                      </TD>
                    </tr>

                    {/* MoM growth row */}
                    <tr className="border-t border-slate-100 bg-white">
                      <td className="px-3 py-2 text-[10px] text-slate-400 italic sticky left-0 bg-white">MoM Growth</td>
                      {quarters.map((q) => {
                        const allMths = quarters.flatMap((qq) => qq.months);
                        return (
                          <>
                            {q.months.map((m, mi) => {
                              const globalIdx = allMths.findIndex((x) => x.yearMonth === m.yearMonth);
                              const prev = allMths[globalIdx - 1];
                              const g = prev ? ((m.total - prev.total) / Math.max(prev.total, 1)) * 100 : null;
                              return (
                                <TD key={m.yearMonth} cls={`text-[10px] italic border-l border-slate-50/80 ${g !== null ? (g >= 0 ? "text-emerald-600" : "text-red-500") : "text-slate-400"}`}>
                                  {g !== null ? `${g >= 0 ? "+" : ""}${g.toFixed(1)}%` : "—"}
                                </TD>
                              );
                            })}
                            <TD key={`${q.label}-g`} cls="border-l border-slate-200 text-[10px] text-slate-400">—</TD>
                          </>
                        );
                      })}
                      <TD cls="border-l border-slate-200 text-[10px] text-slate-400">—</TD>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══ SENSITIVITY VIEW ══ */}
      {view === "sensitivity" && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-slate-100">
            <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">Sensitivity Analysis</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Revenue outcome across growth scenarios · {horizonYears}-year horizon</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: "#042f3d" }}>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-white sticky left-0 min-w-[150px]" style={{ background: "#042f3d" }}>Scenario</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold text-slate-300 whitespace-nowrap">Vol/mo</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold text-slate-300 whitespace-nowrap">Price/yr</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold text-white whitespace-nowrap">Year 1</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold text-white whitespace-nowrap">Final Year</th>
                  <TH cls="text-cyan-300 border-l border-white/10">Grand Total</TH>
                  <TH cls="text-slate-300">CAGR</TH>
                </tr>
              </thead>
              <tbody>
                {SENSITIVITY_ROWS.map((row, ri) => {
                  const adjStreams = streams.map((s) => ({
                    ...s,
                    volumeGrowthPct:      (s.volumeGrowthPct ?? 0) * row.volMult,
                    annualPriceGrowthPct: (s.annualPriceGrowthPct ?? 0) * row.priceMult,
                  }));
                  const adjProj  = projectRevenue(adjStreams, totalMths, startDate);
                  const adjYears = groupByYear(adjProj);
                  const adjTotal = adjYears.reduce((a, y) => a + y.total, 0);
                  const adjCagr  = adjYears.length > 1 && (adjYears[0]?.total ?? 0) > 0
                    ? ((Math.pow(adjYears[adjYears.length - 1].total / adjYears[0].total, 1 / (adjYears.length - 1)) - 1) * 100)
                    : null;
                  const isBase = "isCurrent" in row && row.isCurrent;
                  return (
                    <tr key={row.label}
                      className={isBase ? "border-y-2 border-cyan-200" : ri % 2 === 0 ? "bg-white" : "bg-slate-50/40"}
                      style={isBase ? { background: "#f0f9ff" } : {}}>
                      <td className="px-4 py-3 text-[11px] sticky left-0 bg-inherit">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: row.color }} />
                          <span className={`font-semibold ${isBase ? "text-cyan-700" : "text-slate-700"}`}>{row.label}</span>
                          {isBase && <span className="text-[9px] bg-cyan-100 text-cyan-700 font-bold px-1.5 py-0.5 rounded-full">current</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-[11px] tabular-nums text-slate-600">
                        +{((streams[0]?.volumeGrowthPct ?? 0) * row.volMult).toFixed(1)}%
                      </td>
                      <td className="px-3 py-3 text-right text-[11px] tabular-nums text-slate-600">
                        +{((streams[0]?.annualPriceGrowthPct ?? 0) * row.priceMult).toFixed(1)}%
                      </td>
                      <td className="px-3 py-3 text-right text-[11px] tabular-nums font-semibold text-slate-800">
                        {fmt(adjYears[0]?.total ?? 0)}
                      </td>
                      <td className="px-3 py-3 text-right text-[11px] tabular-nums font-semibold text-slate-800">
                        {fmt(adjYears[adjYears.length - 1]?.total ?? 0)}
                      </td>
                      <TD cls="font-bold border-l border-slate-100" style={{ color: isBase ? "#0e7490" : row.color }}>{fmt(adjTotal)}</TD>
                      <TD cls={adjCagr !== null ? (adjCagr > 10 ? "text-emerald-600 font-semibold" : adjCagr > 0 ? "text-slate-700" : "text-red-500") : "text-slate-400"}>
                        {adjCagr !== null ? `${adjCagr >= 0 ? "+" : ""}${adjCagr.toFixed(1)}%` : "—"}
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2.5 text-[10px] text-slate-400 border-t border-slate-100">
            Bear/Bull cases apply 0.25× / 3× volume multipliers and 0.5× / 1.5× price multipliers to your current stream assumptions.
          </p>
        </div>
      )}

      {/* ── Confidence Banner ── */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-800">Forecast Confidence: Medium</p>
            <p className="text-xs text-amber-700 mt-0.5">Based on manual estimates only. Connect verified sales data or import bank records to reach High confidence.</p>
          </div>
        </div>
      </div>

    </div>
  );
}

/* ═══════════════════════════════════════ ApplyPage ══ */
function ApplyPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetAppId = searchParams.get("id"); // optional — open a specific application
  const [step, setStep] = useState(0);
  const [dir,  setDir]  = useState(1);
  // Shared save-in-progress flag — used at every step transition
  const [isSaving,  setIsSaving]  = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Situation detection (pre-gate)
  const [situation,     setSituation]     = useState<SituationId | null>(null);
  const [currency,      setCurrency]      = useState<CurrencyCode | null>(null);
  const [nameDone,      setNameDone]      = useState(false);  // passed the "name your project" screen
  const [situationDone, setSituationDone] = useState(false);
  const [notSureOpen,   setNotSureOpen]   = useState(false); // "Not sure which applies?" drawer

  // Currency-aware number formatter used everywhere outside ForecastView/RevenueMix
  const fmt = makeFmt(currency);

  // Progress bar position: 0=situation, 1=mapping, 2=confirm, 3=data, 4=forecast
  const displayStep = !situationDone ? 0 : step + 1;

  // Intake chat
  const [messages,  setMessages]  = useState<ChatMessage[]>([]);
  const [input,     setInput]     = useState("");
  const [aiTyping,  setAiTyping]  = useState(false);
  const [chatError, setChatError] = useState("");
  const endRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Project name — editable, auto-generated from detected streams, saved to DB
  const [appName, setAppName] = useState("New Application");

  // Streams
  const [streams,      setStreams]      = useState<RevenueStream[]>([]);
  const [streamIdx,    setStreamIdx]    = useState(0);
  const [driverMode,   setDriverMode]   = useState<DriverMode>("chat");

  // Forecast config — lifted so Phase 4 detection can set them directly
  const now0 = new Date();
  const [forecastHorizon,    setForecastHorizon]    = useState(5);
  const [forecastStartYear,  setForecastStartYear]  = useState(now0.getFullYear());
  const [forecastStartMonth, setForecastStartMonth] = useState(now0.getMonth());

  // ── DB persistence state ────────────────────────────────────────────────────
  const [appId,       setAppId]       = useState<string | null>(null);
  const [userId,      setUserId]      = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  // No debounce timers — all saves are explicit and awaited at step boundaries

  // Voice — mic (speech-to-text) + per-message speaker (Web Speech API, best available voice)
  const [micActive,    setMicActive]    = useState(false);
  const [speakingIdx,  setSpeakingIdx]  = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const cachedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Pre-warm: load and cache the voice as soon as the component mounts
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) resolveVoice(cachedVoiceRef);
  }, []);

  const speakMessage = useCallback(async (text: string, idx: number) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speakingIdx === idx) { window.speechSynthesis.cancel(); setSpeakingIdx(null); return; }
    window.speechSynthesis.cancel();
    const voice = await resolveVoice(cachedVoiceRef);
    const utt = new SpeechSynthesisUtterance(text);
    if (voice) utt.voice = voice;
    utt.lang = "en-US"; utt.rate = 1.0; utt.pitch = 1.0;
    utt.onend = () => setSpeakingIdx(null);
    utt.onerror = () => setSpeakingIdx(null);
    setSpeakingIdx(idx);
    window.speechSynthesis.speak(utt);
  }, [speakingIdx]);

  // sendIntake ref so toggleMic closure always calls the latest version
  const sendIntakeRef = useRef<() => void>(() => {});

  const toggleMic = useCallback(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    if (micActive) {
      // Stop recording and immediately send whatever was captured
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setMicActive(false);
      sendIntakeRef.current();
      return;
    }

    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += (e.results[i][0]?.transcript as string) ?? "";
      }
      if (finalText) setInput((prev) => prev ? prev.trimEnd() + " " + finalText.trim() : finalText.trim());
    };
    rec.onerror = () => { recognitionRef.current = null; setMicActive(false); };
    rec.onend   = () => { if (recognitionRef.current) { recognitionRef.current = null; setMicActive(false); } };
    rec.start();
    recognitionRef.current = rec;
    setMicActive(true);
  }, [micActive]);

  const go = (n: number) => { setDir(n > step ? 1 : -1); setStep(n); };

  // ── needsRedetection: set when messages restored but no streams in DB ────────
  const [needsRedetection, setNeedsRedetection] = useState(false);

  // ── Restore a saved application state into local state ──────────────────────
  function restoreFromDb(app: DbApplication, state: ApplicationState): void {
    if (app.name) setAppName(app.name);
    if (app.situation) {
      setSituation(app.situation as SituationId);
      setNameDone(true); // they've already passed the "name your project" screen
    }
    if (app.currency) setCurrency(app.currency as CurrencyCode);

    const intake = state.intakeConversation;
    if (intake?.messages?.length) {
      setMessages(intake.messages as ChatMessage[]);
      // Any messages mean the user already passed situation selection — restore that gate.
      // (is_complete is only true once streams are detected; don't wait for it.)
      setSituationDone(true);
    }

    if (state.streams.length > 0) {
      const restored: RevenueStream[] = state.streams.map((s) => ({
        id:                  s.id,
        name:                s.name,
        type:                s.type as StreamType,
        confidence:          s.confidence as Confidence,
        // Growth fields — DB only stores combined monthly rate; decompose on restore
        monthlyGrowthPct:    Number(s.monthly_growth_pct),
        volumeGrowthPct:     Number(s.monthly_growth_pct), // treat stored rate as volume growth
        annualPriceGrowthPct: 0,                            // price growth unknown — default 0
        scenario:            (Number(s.monthly_growth_pct) <= 1.0 ? "conservative" : Number(s.monthly_growth_pct) <= 2.5 ? "base" : "growth") as GrowthScenario,
        subNewPerMonth:      Number(s.sub_new_per_month),
        subChurnPct:         Number(s.sub_churn_pct),
        rentalOccupancyPct:  Number(s.rental_occupancy_pct),
        driverDone:          s.driver_done,
        items: (state.itemsByStream[s.id] ?? []).map((it) => ({
          id:       it.id,
          name:     it.name,
          category: it.category,
          volume:   Number(it.volume),
          price:    Number(it.price),
          unit:     it.unit,
          note:     it.note ?? undefined,
        })),
        driverMessages: ((state.driverConversations.find((c) => c.stream_id === s.id)?.messages) ?? []) as ChatMessage[],
      }));
      setStreams(restored);

      if (state.forecastConfig) {
        setForecastHorizon(state.forecastConfig.horizon_years);
        setForecastStartYear(state.forecastConfig.start_year);
        setForecastStartMonth(state.forecastConfig.start_month);
      }

      // ── Determine which step to restore ────────────────────────────────────
      // wizard_step in DB is written by the auto-save useEffect as the React
      // `step` variable value (0=intake,1=confirm,2=revenue,3=forecast).
      // When streams exist the user must be at least on Confirm Structure (step≥1).
      const ws = app.wizard_step ?? 0;
      const targetStep = Math.min(Math.max(ws, 1), 3);
      setDir(1);
      setStep(targetStep);

      // For Revenue Data: resume at the first stream that still needs items
      if (targetStep === 2) {
        const firstPending = restored.findIndex((s) => !s.driverDone);
        setStreamIdx(firstPending >= 0 ? firstPending : 0);
        setDriverMode("chat");
      }
      return;
    }

    // ── No streams in DB — user is mid-intake chat ──────────────────────────────
    // Trigger re-detection if the conversation is marked complete but streams are
    // missing (e.g., the detection save failed and the user refreshed).
    if (intake?.messages?.length && (intake.is_complete || app.intake_done)) {
      setNeedsRedetection(true);
    }
    // step stays at 0 (intake chat) — situationDone was set above if messages exist
  }

  // ── On mount: load a specific application (from ?id=) or the latest draft ────
  useEffect(() => {
    (async () => {
      setIsRestoring(true);
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) { setIsRestoring(false); return; }
        setUserId(user.id);

        let app: DbApplication;
        if (targetAppId) {
          // Load the specific application the dashboard card linked to
          const { data, error } = await sb
            .from("applications")
            .select("*")
            .eq("id", targetAppId)
            .eq("user_id", user.id) // security: only own apps
            .single();
          if (error || !data) {
            // Fallback: load/create the latest draft
            app = await getOrCreateApplication(sb, user.id);
          } else {
            app = data as DbApplication;
          }
        } else {
          app = await getOrCreateApplication(sb, user.id);
        }

        setAppId(app.id);

        // Restore if user has gotten past fresh start (selected a situation, or has intake data).
        // app.situation != null covers mid-chat logouts (situation saved but wizard not complete).
        if (app.situation != null || app.intake_done) {
          const state = await loadApplicationState(sb, app.id);
          restoreFromDb(app, state);
        }
      } catch (e) {
        console.error("[apply] restore error", e);
      } finally {
        setIsRestoring(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-save wizard_step on every navigation ───────────────────────────────
  // Fires whenever the user moves between steps (or situationDone toggles to true).
  // isRestoring guard prevents writing back the value we just read from DB.
  // wizard_step in DB = React step (0=intake,1=confirm,2=revenue,3=forecast)
  useEffect(() => {
    if (!appId || !userId || isRestoring || !situationDone) return;
    updateApplicationFlags(createClient(), appId, { wizard_step: step }).catch(
      (e) => console.error("[apply] wizard_step save:", e)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, situationDone]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, aiTyping]);
  // Fire opening message only after situation is confirmed and no messages yet
  useEffect(() => {
    if (situationDone && messages.length === 0) callIntake([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situationDone]);

  // ── Auto-redetect: restored messages but streams missing from DB ─────────────
  // Replays the full conversation through the intake AI to re-extract streams.
  useEffect(() => {
    if (!needsRedetection || aiTyping || messages.length === 0) return;
    setNeedsRedetection(false);
    callIntake(messages);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRedetection]);

  const callIntake = useCallback(async (history: ChatMessage[]) => {
    setAiTyping(true); setChatError("");
    try {
      const res  = await fetch("/api/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, situation }),
      });
      const data = await res.json() as { text?: string; provider?: string; error?: string };
      if (data.error) throw new Error(data.error);
      const text = data.text ?? "";
      const detected = parseStreams(text);

      if (detected) {
        // ── Streams detected ───────────────────────────────────────────────────
        const clean = text.slice(0, text.indexOf("[STREAMS_DETECTED]")).trim() ||
          `Great — I've identified ${detected.length} income source${detected.length !== 1 ? "s" : ""}. Let me show you what I found.`;
        const finalMessages = [...history, { role: "assistant" as const, content: clean }];
        setMessages(finalMessages);
        setStreams(detected);

        // DB save — has its own try/catch so a failure is NON-FATAL.
        // go(1) always fires regardless. If IDs are still local, the
        // Confirm Structure → Collect Revenue Data button retries the save
        // and assigns proper DB UUIDs before DriverChat mounts.
        if (appId && userId) {
          try {
            const sb = createClient();
            const savedStreams = await saveStreams(sb, appId, userId,
              detected.map((s, i) => ({
                name: s.name, type: s.type, confidence: s.confidence,
                monthly_growth_pct: s.monthlyGrowthPct,
                sub_new_per_month: s.subNewPerMonth,
                sub_churn_pct: s.subChurnPct,
                rental_occupancy_pct: s.rentalOccupancyPct,
                driver_done: s.driverDone,
                position: i,
              }))
            );
            // Map local IDs → DB UUIDs
            const idMap: Record<string, string> = {};
            detected.forEach((s, i) => {
              const db = savedStreams[i];
              if (db && s.id !== db.id) idMap[s.id] = db.id;
            });
            if (Object.keys(idMap).length > 0) {
              setStreams((prev) => prev.map((s) => ({ ...s, id: idMap[s.id] ?? s.id })));
            }
            // Auto-name + mark intake done
            const parts = detected.map((s) => s.name).slice(0, 2);
            const extra = detected.length > 2 ? ` +${detected.length - 2} more` : "";
            const autoName = parts.join(" & ") + extra;
            setAppName(autoName);
            await saveIntakeConversation(sb, appId, userId, finalMessages, null, true);
            await updateApplicationFlags(sb, appId, { intake_done: true, name: autoName });
          } catch (saveErr) {
            // Non-fatal — step 1→2 save will retry and assign proper DB IDs
            console.error("[apply] detection save (non-fatal):", saveErr);
          }
        }

        // Always advance — save failure does not block the user
        setTimeout(() => go(1), 900);

      } else {
        // ── Mid-conversation message — save intake progress immediately ────────
        const updatedMessages = [...history, { role: "assistant" as const, content: text }];
        setMessages(updatedMessages);
        if (appId && userId) {
          const sb = createClient();
          // Fire-and-forget is fine here — data will be re-saved at streams detection
          saveIntakeConversation(sb, appId, userId, updatedMessages, null, false).catch(
            (e) => console.error("[apply] intake progress save:", e)
          );
        }
      }
    } catch (e) { setChatError(e instanceof Error ? e.message : "Connection error"); }
    finally { setAiTyping(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation, appId, userId]);

  const sendIntake = () => {
    const text = input.trim();
    if (!text || aiTyping) return;
    const updated = [...messages, { role: "user" as const, content: text }];
    setMessages(updated); setInput(""); callIntake(updated);
  };
  // Keep ref in sync so toggleMic's closure always calls the latest sendIntake
  useEffect(() => { sendIntakeRef.current = sendIntake; });

  const updateStream = useCallback((updated: RevenueStream) => {
    setStreams((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  // ── Called by DriverChat the moment items are detected ──────────────────────
  // Saves items + driver conversation immediately (no debounce).
  // Also marks drivers_done on the application if every stream now has data.
  const handleItemsSaved = useCallback(async (
    streamId: string,
    items: StreamItem[],
    driverMessages: ChatMessage[],
  ) => {
    if (!appId || !userId || !isDbId(streamId)) return;
    try {
      const sb = createClient();
      await saveStreamItems(sb, streamId, userId, items.map((it, pos) => ({
        name: it.name, category: it.category,
        volume: it.volume, price: it.price,
        unit: it.unit, note: it.note ?? undefined, position: pos,
      })));
      await saveDriverConversation(sb, appId, userId, streamId, driverMessages, null, true);
      // Mark drivers_done if every stream now has items
      setStreams((prev) => {
        const updated = prev.map((s) => s.id === streamId ? { ...s, driverDone: true } : s);
        if (updated.every((s) => s.driverDone || s.items.length > 0)) {
          updateApplicationFlags(sb, appId, { drivers_done: true }).catch(console.error);
        }
        return updated;
      });
    } catch (e) {
      console.error("[apply] items save error:", e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, userId]);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const currentStream   = streams[streamIdx];
  const allStreamsReady = streams.length > 0 && streams.every((s) => s.driverDone || s.items.length > 0);

  // Count distinct types for summary
  const detectedTypes = [...new Set(streams.map((s) => s.type))];

  // Auto-advance to next stream when AI finishes collecting items
  const currentDone = streams[streamIdx]?.driverDone ?? false;
  useEffect(() => {
    if (step !== 2 || !currentDone || streamIdx >= streams.length - 1) return;
    const t = setTimeout(() => {
      setStreamIdx((prev) => Math.min(prev + 1, streams.length - 1));
      setDriverMode("chat");
    }, 1400); // brief pause so user sees the "complete" badge before sliding
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, currentDone, streamIdx, streams.length]);

  const slide = {
    enter:  (d: number) => ({ opacity: 0, x: d > 0 ? 48 : -48 }),
    center: { opacity: 1, x: 0, transition: { duration: 0.38, ease: EASE } },
    exit:   (d: number) => ({ opacity: 0, x: d > 0 ? -48 : 48, transition: { duration: 0.25, ease: EASE } }),
  };

  // Show a simple full-screen loader while restoring saved state from DB
  if (isRestoring) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
            <BrainCircuit className="w-5 h-5 text-white animate-pulse" />
          </div>
          <p className="text-sm text-slate-500 font-medium">Restoring your progress…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-4 flex items-center gap-4 flex-shrink-0">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors flex-shrink-0">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2">
            {["Context", "Revenue Mapping", "Structure Review", "Driver Inputs", "Forecast"].map((label, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${displayStep >= i ? "text-cyan-700" : "text-slate-400"}`}>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: displayStep >= i ? "#0e7490" : "#e2e8f0", color: displayStep >= i ? "#fff" : "#94a3b8" }}>
                    {displayStep > i ? <Check className="w-3 h-3" /> : i + 1}
                  </div>
                  <span className="hidden sm:block">{label}</span>
                </div>
                {i < 4 && <div className={`w-4 sm:w-6 h-px ${displayStep > i ? "bg-cyan-600" : "bg-slate-200"}`} />}
              </div>
            ))}
          </div>
        </div>
        {/* Editable project name — always visible once user has started */}
        <div className="flex-shrink-0 hidden sm:block">
          <EditableName value={appName} onChange={setAppName} />
        </div>
      </div>

      <div className="flex-1 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
        <div className="w-full max-w-3xl">
          <AnimatePresence mode="wait" custom={dir}>

            {/* ══ SCREEN A: Create your revenue model ══ */}
            {!situationDone && !nameDone && (
              <motion.div key="name-project" custom={1} variants={slide} initial="enter" animate="center" exit="exit">

                {/* Header */}
                <div className="mb-6">
                  <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#0891b2" }}>
                    Revenue Projection Setup &nbsp;·&nbsp; Step 1 of 5
                  </p>
                  <h2 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 leading-tight">
                    Create your revenue model
                  </h2>
                  <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                    Choose a clear business, branch, or opportunity name — it appears on all reports and exports.
                  </p>
                </div>

                {/* Two-column workspace */}
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-4">

                  {/* ── Left: main form ── */}
                  <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_16px_rgba(0,0,0,0.07)] p-5 space-y-3">
                      <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                        Business / Model Name
                      </label>
                      <input
                        autoFocus
                        type="text"
                        value={appName === "New Application" ? "" : appName}
                        onChange={(e) => setAppName(e.target.value.trim() ? e.target.value : "New Application")}
                        onKeyDown={(e) => { if (e.key === "Enter" && appName !== "New Application") setNameDone(true); }}
                        placeholder="e.g. Schneider GmbH — Main Operations"
                        className="w-full text-base font-medium text-slate-800 border border-slate-200 rounded-xl px-4 py-3.5 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all placeholder:text-slate-300 placeholder:font-normal"
                      />
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Try:{" "}
                        <span className="italic text-slate-500">"Bauer & Sons — Munich Retail Division"</span>
                        {" "}or{" "}
                        <span className="italic text-slate-500">"Leclerc Logistics — Lyon Expansion 2026"</span>
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <Link href="/dashboard"
                        className="flex items-center gap-2 px-5 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                        <ArrowLeft className="w-4 h-4" /> Back
                      </Link>
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        disabled={isSaving}
                        onClick={async () => {
                          if (appId) {
                            setIsSaving(true); setSaveError(null);
                            try {
                              const sb = createClient();
                              const finalName = appName !== "New Application" ? appName : null;
                              await updateApplicationFlags(sb, appId, {
                                ...(finalName ? { name: finalName } : {}),
                                wizard_step: 0,
                              });
                            } catch (e) {
                              setSaveError(e instanceof Error ? e.message : (e as {message?: string}).message ?? "Save failed");
                              setIsSaving(false);
                              return;
                            }
                            setIsSaving(false);
                          }
                          setNameDone(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-60"
                        style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                        {isSaving ? (
                          <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg> Saving…</>
                        ) : <>Continue to Funding Context <ArrowRight className="w-4 h-4" /></>}
                      </motion.button>
                    </div>

                    {saveError && <p className="text-xs text-red-500">{saveError}</p>}

                    <p className="text-[11px] text-slate-400 text-center">
                      Your draft saves automatically as you progress.
                    </p>
                  </div>

                  {/* ── Right: Model Status panel ── */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_16px_rgba(0,0,0,0.07)] p-4 h-fit">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                      Model Status
                    </p>
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Status</span>
                        <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                          Draft
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Scenario</span>
                        <span className="text-xs font-medium text-slate-700">Base</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Currency</span>
                        <span className="text-xs font-medium text-slate-400 italic">Pending</span>
                      </div>
                      <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                        <span className="text-xs text-slate-500">Autosave</span>
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                          On
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        A professional revenue model helps investors and partners evaluate your opportunity with confidence.
                      </p>
                    </div>
                  </div>

                </div>{/* /two-column */}
              </motion.div>
            )}

            {/* ══ SCREEN B: Select business context ══ */}
            {!situationDone && nameDone && (
              <motion.div key="situation" custom={1} variants={slide} initial="enter" animate="center" exit="exit">

                {/* Header */}
                <div className="mb-5">
                  <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#0891b2" }}>
                    Revenue Projection Setup &nbsp;·&nbsp; Step 1 of 5
                  </p>
                  <h2 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 leading-tight">
                    Select your business context
                  </h2>
                  <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                    This determines the forecast methodology and funding pathway used for your model.
                  </p>
                </div>

                {/* Two-column workspace */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5">

                  {/* ── Left column ── */}
                  <div className="space-y-4">

                    {/* Situation cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {SITUATIONS.map(({ id, icon: Icon, title, desc, insight, color, bg }) => {
                        const selected = situation === id;
                        return (
                          <motion.button key={id} onClick={() => setSituation(id)}
                            whileHover={{ y: -1, boxShadow: "0 4px 20px rgba(0,0,0,0.10)" }}
                            whileTap={{ scale: 0.985 }}
                            className={`text-left rounded-2xl border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 ${
                              selected
                                ? "shadow-lg"
                                : "border-slate-100 hover:border-slate-200 bg-white"
                            }`}
                            style={selected ? { background: bg, borderColor: color, boxShadow: `0 4px 20px ${color}22` } : {}}>
                            <div className="p-4">
                              <div className="flex items-start gap-3">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                                  style={{ background: selected ? "white" : bg }}>
                                  <Icon className="w-4 h-4" style={{ color }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-bold text-slate-800">{title}</p>
                                    {selected && (
                                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                        style={{ background: color, color: "white" }}>
                                        Selected
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{desc}</p>
                                </div>
                              </div>
                              {/* Intelligence micro-text — shown when selected */}
                              {selected && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  className="mt-3 pt-3 border-t"
                                  style={{ borderColor: `${color}33` }}>
                                  <p className="text-[11px] leading-relaxed font-medium" style={{ color }}>
                                    {insight}
                                  </p>
                                </motion.div>
                              )}
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>

                    {/* "Not sure?" drawer */}
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => setNotSureOpen(v => !v)}
                        className="text-xs text-slate-400 hover:text-cyan-600 transition-colors underline underline-offset-2 decoration-dotted">
                        Not sure which applies?
                      </button>
                      <AnimatePresence>
                        {notSureOpen && (
                          <motion.div
                            key="not-sure"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden">
                            <div className="mt-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-left space-y-2">
                              <p className="text-xs font-semibold text-slate-700">Why this matters</p>
                              <p className="text-xs text-slate-500 leading-relaxed">
                                Lenders and investors evaluate new businesses differently from existing operators. Your selection shapes the forecasting logic, risk assumptions, and funding narrative throughout the model — choosing the closest match gives you the most accurate output.
                              </p>
                              <p className="text-xs text-slate-400">
                                You can update this at any time before submitting.
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Reporting Currency */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_1px_8px_rgba(0,0,0,0.05)] px-4 py-4">
                      <div className="mb-2.5">
                        <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Reporting Currency</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          All projections, statements, and dashboards will use this currency.
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-cyan-700">
                            {currency ? getCurrencySymbol(currency) : "¤"}
                          </span>
                        </div>
                        <select
                          value={currency ?? ""}
                          onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                          className="flex-1 text-sm text-slate-700 bg-transparent border-0 focus:outline-none focus:ring-0 cursor-pointer"
                        >
                          <option value="" disabled>Select reporting currency…</option>
                          {CURRENCIES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.symbol} — {c.name} ({c.code})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3">
                      <button onClick={() => { setNameDone(false); setIsSaving(false); setSaveError(null); }}
                        className="flex items-center gap-2 px-5 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                        <ArrowLeft className="w-4 h-4" /> Back
                      </button>
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        disabled={!situation || !currency || isSaving}
                        onClick={async () => {
                          if (!situation || !currency) return;
                          if (appId) {
                            setIsSaving(true); setSaveError(null);
                            try {
                              const sb = createClient();
                              await updateApplicationFlags(sb, appId, { situation, currency });
                            } catch (e) {
                              setSaveError(e instanceof Error ? e.message : (e as {message?: string}).message ?? "Save failed");
                              setIsSaving(false);
                              return;
                            }
                            setIsSaving(false);
                          }
                          setSituationDone(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                        {isSaving ? (
                          <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg> Saving…</>
                        ) : <>Continue to Revenue Mapping <ArrowRight className="w-4 h-4" /></>}
                      </motion.button>
                    </div>
                    {saveError && <p className="text-xs text-red-500">{saveError}</p>}
                  </div>

                  {/* ── Right: Model Setup panel ── */}
                  <div className="hidden lg:block">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_16px_rgba(0,0,0,0.07)] p-4 sticky top-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                        Model Setup
                      </p>
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-500 flex-shrink-0">Business</span>
                          <span className="text-xs font-semibold text-slate-700 text-right truncate max-w-[120px]">
                            {appName !== "New Application" ? appName : <span className="italic text-slate-400">Unnamed</span>}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500">Scenario</span>
                          <span className="text-xs font-medium text-slate-700">Base</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500">Context</span>
                          <span className="text-xs font-medium text-right" style={{ color: situation ? SITUATIONS.find(s => s.id === situation)?.color ?? "#64748b" : "#94a3b8" }}>
                            {situation ? SITUATIONS.find(s => s.id === situation)?.title ?? "—" : <span className="italic text-slate-400">Pending</span>}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500">Currency</span>
                          <span className="text-xs font-medium text-slate-700">
                            {currency
                              ? <>{getCurrencySymbol(currency)} <span className="text-slate-400 font-normal">{currency}</span></>
                              : <span className="italic text-slate-400">Pending</span>}
                          </span>
                        </div>
                        <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                          <span className="text-xs text-slate-500">Autosave</span>
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                            On
                          </span>
                        </div>
                      </div>
                      <div className="mt-4 pt-3 border-t border-slate-100">
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          Your context selection shapes the forecast methodology, risk weighting, and funding narrative throughout your model.
                        </p>
                      </div>
                    </div>
                  </div>

                </div>{/* /two-column */}
              </motion.div>
            )}

            {/* ══ STEP 0: Revenue Mapping Interview ══ */}
            {situationDone && step === 0 && (() => {
              const userMsgCount = messages.filter(m => m.role === "user").length;
              const mappingProgress = streams.length > 0 ? 85 : Math.min(75, userMsgCount * 15 + 10);
              const situationMeta = SITUATIONS.find(s => s.id === situation);
              const likelyModels = SITUATION_LIKELY_MODELS[situation ?? "existing"] ?? [];
              const analystNote  = SITUATION_ANALYST_NOTES[situation ?? "existing"] ?? "";
              const examples     = SITUATION_EXAMPLES[situation ?? "existing"] ?? [];

              const sendQuick = (text: string) => {
                const updated = [...messages, { role: "user" as const, content: text }];
                setMessages(updated); callIntake(updated);
              };

              return (
                <motion.div key="intake" custom={dir} variants={slide} initial="enter" animate="center" exit="exit"
                  className="flex gap-5" style={{ height: "calc(100vh - 180px)", maxHeight: 640 }}>

                  {/* ── Left: Chat panel ── */}
                  <div className="flex flex-col flex-1 min-w-0">

                    {/* Session header */}
                    <div className="mb-3">
                      <button
                        onClick={() => { setSituationDone(false); setNameDone(true); setMessages([]); setStreams([]); }}
                        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors mb-2.5">
                        <ArrowLeft className="w-3 h-3" /> Change context
                      </button>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                          style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                          <BrainCircuit className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">Revenue Mapping Interview</p>
                          <p className="text-xs text-slate-400">AI-led revenue model discovery</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                          Autosave active
                        </span>
                        <span className="text-slate-200">·</span>
                        <span>Stage: Revenue Discovery</span>
                        <span className="text-slate-200">·</span>
                        <span>Est. 2–4 min</span>
                      </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-2">
                      {messages.map((m, i) => (
                        <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, ease: EASE }}>
                          <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                            {m.role === "assistant" && (
                              <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
                                style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                                <BrainCircuit className="w-3.5 h-3.5 text-white" />
                              </div>
                            )}
                            <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                              m.role === "user"
                                ? "text-white rounded-tr-sm"
                                : "bg-white border border-slate-100 text-slate-800 rounded-tl-sm shadow-sm"
                            }`} style={m.role === "user" ? { background: "linear-gradient(135deg,#0e7490,#0891b2)" } : {}}>
                              {cleanAI(m.content)}
                            </div>
                            {m.role === "assistant" && (
                              <button onClick={() => speakMessage(m.content, i)}
                                title={speakingIdx === i ? "Stop" : "Read aloud"}
                                className={`ml-1.5 mt-1 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-all self-start ${
                                  speakingIdx === i ? "text-cyan-600 bg-cyan-50" : "text-slate-300 hover:text-cyan-500 hover:bg-slate-50"
                                }`}>
                                <Volume2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          {/* Quick replies — shown below the first AI message only */}
                          {m.role === "assistant" && i === 0 && userMsgCount === 0 && !aiTyping && (
                            <div className="flex flex-wrap gap-2 mt-3 pl-9">
                              {["Retail products", "Services / consulting", "Subscription model", "Mixed revenue", "Not sure yet"].map((opt) => (
                                <button key={opt} onClick={() => sendQuick(opt)}
                                  className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:border-cyan-400 hover:text-cyan-600 text-slate-500 transition-all">
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      ))}

                      {aiTyping && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-xl flex items-center justify-center"
                            style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                            <BrainCircuit className="w-3.5 h-3.5 text-white" />
                          </div>
                          <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                            <div className="flex items-center gap-1">
                              {[0, 1, 2].map((dot) => (
                                <motion.div key={dot} className="w-1.5 h-1.5 rounded-full bg-slate-300"
                                  animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: dot * 0.15 }} />
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {chatError && (
                        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                          <span>⚠ {chatError}</span>
                          <button onClick={() => callIntake(messages)} className="ml-auto font-semibold underline">Retry</button>
                        </div>
                      )}
                      <div ref={endRef} />
                    </div>

                    {/* Input area */}
                    <div className="mt-3 flex items-end gap-2">
                      <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                        onClick={toggleMic} title={micActive ? "Stop & send" : "Speak your answer"}
                        className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all ${
                          micActive
                            ? "bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse"
                            : "border border-slate-200 text-slate-400 hover:border-cyan-400 hover:text-cyan-600 bg-white"
                        }`}>
                        {micActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </motion.button>

                      <textarea ref={inputRef} rows={2} value={input} onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendIntake(); } }}
                        disabled={aiTyping}
                        placeholder={micActive ? "Listening…" : "Describe how the business earns revenue…"}
                        className={`flex-1 resize-none px-4 py-3 border rounded-2xl text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 transition-all placeholder:text-slate-300 disabled:opacity-60 ${
                          micActive
                            ? "border-red-300 focus:border-red-400 focus:ring-red-400/20"
                            : "border-slate-200 focus:border-cyan-500 focus:ring-cyan-500/20"
                        }`} />

                      <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={sendIntake}
                        disabled={!input.trim() || aiTyping}
                        className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-md disabled:opacity-40 flex-shrink-0"
                        style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                        <Send className="w-4 h-4" />
                      </motion.button>
                    </div>
                    <p className="text-[11px] text-slate-300 text-center mt-2">Shift+Enter for new line · Enter to send</p>
                  </div>

                  {/* ── Right: Intelligence rail ── */}
                  <div className="hidden lg:flex flex-col w-56 flex-shrink-0 gap-3 overflow-y-auto pb-2">

                    {/* Revenue Intelligence card */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_16px_rgba(0,0,0,0.07)] p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                        Revenue Intelligence
                      </p>
                      <div className="space-y-3.5">

                        {/* Business Context */}
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Business Context</p>
                          <p className="text-xs font-semibold" style={{ color: situationMeta?.color ?? "#64748b" }}>
                            {situationMeta?.title ?? "—"}
                          </p>
                        </div>

                        {/* Detected Streams */}
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Detected Streams</p>
                          <p className="text-xs font-bold text-slate-800">
                            {streams.length === 0 ? "0 — awaiting inputs" : `${streams.length} identified`}
                          </p>
                        </div>

                        {/* Likely Models / Stream Types */}
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">
                            {streams.length > 0 ? "Stream Types" : "Likely Models"}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {streams.length > 0
                              ? detectedTypes.map(t => (
                                  <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                                    style={{ background: STREAM_META[t].bg, color: STREAM_META[t].color }}>
                                    {STREAM_META[t].label}
                                  </span>
                                ))
                              : likelyModels.map(m => (
                                  <span key={m} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                                    {m}
                                  </span>
                                ))
                            }
                          </div>
                        </div>

                        {/* Confidence */}
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider">Confidence</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            streams.length >= 3
                              ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                              : streams.length >= 1
                              ? "bg-amber-50 text-amber-700 border-amber-100"
                              : "bg-red-50 text-red-600 border-red-100"
                          }`}>
                            {streams.length >= 3 ? "High" : streams.length >= 1 ? "Medium" : "Low"}
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Progress</p>
                            <p className="text-[10px] font-semibold text-slate-600">{mappingProgress}%</p>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div className="h-full rounded-full"
                              style={{ background: "linear-gradient(90deg,#0e7490,#0891b2)" }}
                              animate={{ width: `${mappingProgress}%` }}
                              transition={{ duration: 0.6, ease: "easeOut" }} />
                          </div>
                        </div>

                        {/* Next Goal */}
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Next Goal</p>
                          <p className="text-xs font-medium text-slate-700">
                            {streams.length === 0
                              ? "Identify revenue streams"
                              : streams.length < 2
                              ? "Map pricing & volume"
                              : "Confirm all streams found"}
                          </p>
                        </div>

                      </div>
                    </div>

                    {/* Analyst Notes — collapsible */}
                    <details className="bg-slate-50 border border-slate-200 rounded-2xl p-3 group">
                      <summary className="text-[10px] font-bold uppercase tracking-widest text-slate-400 cursor-pointer select-none list-none flex items-center justify-between">
                        Analyst Notes
                        <span className="text-slate-300 group-open:rotate-180 transition-transform text-xs">▾</span>
                      </summary>
                      <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">{analystNote}</p>
                    </details>

                    {/* Example answers — context-specific, shown early in conversation */}
                    {userMsgCount <= 1 && (
                      <div className="bg-white border border-slate-200 rounded-2xl p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                          Example Answers
                        </p>
                        <div className="space-y-2">
                          {examples.map((ex) => (
                            <button key={ex} onClick={() => sendQuick(ex)}
                              className="w-full text-left text-[10px] text-slate-500 hover:text-cyan-700 transition-colors leading-relaxed">
                              "{ex}"
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>{/* /intelligence rail */}

                </motion.div>
              );
            })()}


            {/* ══ STEP 1: Structure Review ══ */}
            {step === 1 && (() => {
              const complexity = streams.length >= 4 ? "Complex" : streams.length >= 2 ? "Moderate" : "Standard";
              const overallConf = streams.every(s => s.confidence === "high") ? "High"
                : streams.some(s => s.confidence === "high") ? "Medium" : "Low";
              const totalItems = streams.reduce((a, s) => a + s.items.length, 0);
              const INPUT_MODE: Record<StreamType, string> = {
                product:      "Category / SKU",
                service:      "Client / Project",
                subscription: "Subscription Tiers",
                rental:       "Unit / Rate",
                marketplace:  "GMV / Commission",
                contract:     "Contract / Deal",
                custom:       "Custom Inputs",
              };
              const DETECTION_BASIS: Record<StreamType, string[]> = {
                product:      ["Physical goods / inventory implied", "SKU-driven pricing model selected", "Retail or wholesale distribution identified"],
                service:      ["Skills-based / consulting work identified", "Project or retainer billing model selected", "Client volume and fee rate applicable"],
                subscription: ["Recurring membership model detected", "Monthly billing and churn rate applicable", "Subscriber growth curve will be modelled"],
                rental:       ["Asset-based income stream identified", "Occupancy rate and lease terms required", "Unit yield and vacancy factored in"],
                marketplace:  ["Platform or brokerage model detected", "GMV and commission take-rate applicable", "Transaction volume will drive projections"],
                contract:     ["Fixed-term supply agreement implied", "Contract value and duration applicable", "Pipeline conversion rate will be modelled"],
                custom:       ["Custom income stream identified", "Manual driver inputs required", "Stream will be modelled on volume × price basis"],
              };

              return (
                <motion.div key="review" custom={dir} variants={slide} initial="enter" animate="center" exit="exit">
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_216px] gap-5">

                    {/* ── Left column ── */}
                    <div className="space-y-4">

                      {/* Header */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-600">
                            Revenue Mapping Complete
                          </span>
                        </div>
                        <h2 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 leading-tight">
                          {streams.length} Revenue Stream{streams.length !== 1 ? "s" : ""} Confirmed
                        </h2>
                        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                          Your forecast structure is ready for driver inputs and projection modelling.
                        </p>
                      </div>

                      {/* Summary row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { label: "Detected Streams", value: String(streams.length) },
                          { label: "Primary Model",    value: detectedTypes.length > 0 ? STREAM_META[detectedTypes[0]].label : "—" },
                          { label: "Confidence",       value: overallConf },
                          { label: "Complexity",       value: complexity },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-white border border-slate-100 rounded-xl px-3 py-2.5">
                            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
                            <p className="text-xs font-bold text-slate-800">{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Stream cards */}
                      <div className="space-y-2">
                        {streams.map((s, i) => {
                          const Meta = STREAM_META[s.type]; const Icon = Meta.icon;
                          return (
                            <motion.div key={s.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.07, ease: EASE }}
                              className="bg-white rounded-2xl border border-slate-200 shadow-[0_1px_6px_rgba(0,0,0,0.05)]">

                              {/* Card top row */}
                              <div className="flex items-start gap-3 p-4">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                                  style={{ background: Meta.bg }}>
                                  <Icon className="w-4 h-4" style={{ color: Meta.color }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <EditableName value={s.name} onChange={(name) => updateStream({ ...s, name })} />
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <select value={s.type}
                                      onChange={(e) => updateStream({ ...s, type: e.target.value as StreamType })}
                                      className="text-xs text-slate-500 border border-slate-100 rounded-md px-1.5 py-0.5 bg-transparent focus:border-cyan-400 focus:outline-none cursor-pointer">
                                      {Object.entries(STREAM_META).map(([k, v]) => (
                                        <option key={k} value={k}>{v.label}</option>
                                      ))}
                                    </select>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${CONF_STYLE[s.confidence]}`}>
                                      {s.confidence === "high" ? "High" : s.confidence === "medium" ? "Medium" : "Low"} confidence
                                    </span>
                                  </div>
                                </div>
                                {deleteConfirmId === s.id ? (
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className="text-xs text-red-500 font-medium whitespace-nowrap">Remove?</span>
                                    <button onClick={() => { setStreams((prev) => prev.filter((x) => x.id !== s.id)); setDeleteConfirmId(null); }}
                                      className="text-xs font-semibold px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">Yes</button>
                                    <button onClick={() => setDeleteConfirmId(null)}
                                      className="text-xs font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">No</button>
                                  </div>
                                ) : (
                                  <button onClick={() => setDeleteConfirmId(s.id)}
                                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>

                              {/* Card detail row */}
                              <div className="px-4 pb-3 ml-12 border-t border-slate-50 pt-2.5">
                                <div className="grid grid-cols-3 gap-3">
                                  <div>
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Input Mode</p>
                                    <p className="text-[11px] font-medium text-slate-600">{INPUT_MODE[s.type]}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Status</p>
                                    {s.items.length > 0 ? (
                                      <p className="text-[11px] font-bold text-emerald-600">{fmt(streamMRR(s))}/mo</p>
                                    ) : (
                                      <p className="text-[11px] font-medium text-amber-600">Awaiting Drivers</p>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Description</p>
                                    <p className="text-[11px] text-slate-500 leading-relaxed">{Meta.desc}</p>
                                  </div>
                                </div>
                              </div>

                              {/* Detection Basis — collapsible */}
                              <details className="px-4 pb-3 ml-12 group">
                                <summary className="text-[10px] text-slate-400 hover:text-cyan-600 cursor-pointer select-none list-none flex items-center gap-1 transition-colors">
                                  <span className="underline underline-offset-2 decoration-dotted">Detection Basis</span>
                                  <span className="text-slate-300 group-open:rotate-180 transition-transform text-[10px]">▾</span>
                                </summary>
                                <ul className="mt-1.5 space-y-1">
                                  {DETECTION_BASIS[s.type].map((point) => (
                                    <li key={point} className="text-[10px] text-slate-400 flex items-start gap-1.5">
                                      <span className="text-cyan-400 flex-shrink-0 mt-px">·</span>
                                      {point}
                                    </li>
                                  ))}
                                </ul>
                              </details>

                            </motion.div>
                          );
                        })}
                      </div>

                      {/* Add stream + Re-run mapping */}
                      <div className="space-y-2">
                        <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-4">
                          <p className="text-[11px] font-semibold text-slate-500 mb-2.5">+ Add Additional Revenue Stream</p>
                          <div className="flex flex-wrap gap-2">
                            {(["product","service","subscription","rental","contract","marketplace"] as StreamType[]).map((t) => {
                              const M = STREAM_META[t]; const TIcon = M.icon;
                              return (
                                <button key={t} onClick={() => setStreams(p => [...p, makeStream(M.label, t, "low")])}
                                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:border-cyan-400 hover:text-cyan-600 text-slate-500 transition-all">
                                  <TIcon className="w-3 h-3" style={{ color: M.color }} />
                                  {M.label}
                                </button>
                              );
                            })}
                            <button onClick={() => setStreams(p => [...p, makeStream("New Revenue Stream", "custom", "low")])}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-dashed border-slate-200 text-slate-400 hover:border-slate-400 transition-all">
                              <Plus className="w-3 h-3" /> Other
                            </button>
                          </div>
                        </div>

                        <button onClick={() => { setMessages([]); setStreams([]); go(0); }}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors">
                          <RefreshCw className="w-3.5 h-3.5" /> Re-run AI Mapping
                        </button>
                      </div>

                      {/* MRR summary — when data exists */}
                      {streams.some((s) => s.items.length > 0) && (
                        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                          <div className="flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-emerald-600" />
                            <span className="text-xs font-medium text-emerald-700">
                              {streams.filter((s) => s.items.length > 0).length} of {streams.length} stream{streams.length !== 1 ? "s" : ""} have data
                            </span>
                          </div>
                          <span className="text-sm font-bold text-emerald-700">
                            {fmt(streams.reduce((a, s) => a + streamMRR(s), 0))}/mo
                          </span>
                        </div>
                      )}

                      {/* CTA */}
                      <div>
                        <button
                          disabled={streams.length === 0 || isSaving}
                          onClick={async () => {
                            setIsSaving(true); setSaveError(null);
                            try {
                              if (appId && userId) {
                                const sb = createClient();
                                const savedStreams = await saveStreams(sb, appId, userId,
                                  streams.map((s, i) => ({
                                    id: isDbId(s.id) ? s.id : undefined,
                                    name: s.name, type: s.type, confidence: s.confidence,
                                    monthly_growth_pct: s.monthlyGrowthPct,
                                    sub_new_per_month: s.subNewPerMonth,
                                    sub_churn_pct: s.subChurnPct,
                                    rental_occupancy_pct: s.rentalOccupancyPct,
                                    driver_done: s.driverDone,
                                    position: i,
                                  }))
                                );
                                const idMap: Record<string, string> = {};
                                streams.forEach((s, i) => {
                                  const db = savedStreams[i];
                                  if (db && s.id !== db.id) idMap[s.id] = db.id;
                                });
                                if (Object.keys(idMap).length > 0) {
                                  setStreams((prev) => prev.map((s) => ({ ...s, id: idMap[s.id] ?? s.id })));
                                }
                                await updateApplicationFlags(sb, appId, { intake_done: true });
                              }
                              setStreamIdx(0); setDriverMode("chat"); go(2);
                            } catch (e) {
                              console.error("[Collect Revenue Data] save failed:", e);
                              setSaveError(e instanceof Error ? e.message : (e as {message?: string}).message ?? "Save failed — please retry");
                            } finally {
                              setIsSaving(false);
                            }
                          }}
                          className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                          style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                          {isSaving ? (
                            <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                            </svg> Saving structure…</>
                          ) : <>Continue to Driver Inputs <ArrowRight className="w-4 h-4" /></>}
                        </button>
                        {saveError && <p className="text-xs text-red-500 text-center mt-2">{saveError}</p>}
                        <p className="text-[11px] text-slate-400 text-center mt-2.5">
                          You can edit streams, add categories, or return to mapping at any time.
                        </p>
                      </div>
                    </div>

                    {/* ── Right: Model Snapshot panel ── */}
                    <div className="hidden lg:block">
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_16px_rgba(0,0,0,0.07)] p-4 sticky top-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                          Model Snapshot
                        </p>
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Streams</span>
                            <span className="text-xs font-bold text-slate-800">{streams.length}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Categories</span>
                            <span className="text-xs font-medium text-slate-400 italic">
                              {totalItems > 0 ? totalItems : "Pending"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Items</span>
                            <span className="text-xs font-medium text-slate-400 italic">
                              {totalItems > 0 ? `${totalItems} entered` : "Pending"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Forecast Horizon</span>
                            <span className="text-xs font-medium text-slate-400 italic">Pending</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Currency</span>
                            <span className="text-xs font-semibold text-slate-700">
                              {currency ? <>{getCurrencySymbol(currency)} <span className="font-normal text-slate-400">{currency}</span></> : <span className="italic text-slate-400">—</span>}
                            </span>
                          </div>
                          <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                            <span className="text-xs text-slate-500">Autosave</span>
                            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> On
                            </span>
                          </div>
                        </div>

                        {/* Stream type breakdown */}
                        {detectedTypes.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Stream Types</p>
                            {detectedTypes.map(t => {
                              const M = STREAM_META[t]; const TI = M.icon;
                              return (
                                <div key={t} className="flex items-center gap-2">
                                  <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                                    style={{ background: M.bg }}>
                                    <TI className="w-3 h-3" style={{ color: M.color }} />
                                  </div>
                                  <span className="text-[11px] text-slate-600">{M.label}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="mt-4 pt-3 border-t border-slate-100">
                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            Driver inputs define volumes, pricing, and growth — the engine of your projection model.
                          </p>
                        </div>
                      </div>
                    </div>

                  </div>{/* /two-column */}
                </motion.div>
              );
            })()}


            {/* ══ STEP 2: Per-Stream Driver Collection ══ */}
            {step === 2 && currentStream && (() => {
              const Meta = STREAM_META[currentStream.type];
              const StreamIcon = Meta.icon;
              const hasItems    = currentStream.items.length > 0;
              const hasVolumes  = currentStream.items.some(it => it.volume > 0);
              const hasPricing  = currentStream.items.some(it => it.price > 0);
              const cats        = [...new Set(currentStream.items.map(it => it.category).filter(Boolean))];
              const curMRR      = streamMRR(currentStream);

              const streamPct = (s: RevenueStream) => {
                let p = 15;
                if (s.items.length > 0) p += 25;
                if (s.items.some(i => i.volume > 0)) p += 25;
                if (s.items.some(i => i.price > 0)) p += 25;
                if (s.driverDone) p += 10;
                return Math.min(100, p);
              };
              const overallReadiness = streams.length === 0 ? 0
                : Math.round(streams.reduce((a, s) => a + streamPct(s), 0) / streams.length);
              const currentReadiness = streamPct(currentStream);

              const inputStatus = [
                { label: "Stream identified",   done: true },
                { label: "Input method set",    done: true },
                { label: "Items / categories",  done: hasItems },
                { label: "Volume data",         done: hasVolumes },
                { label: "Pricing data",        done: hasPricing },
              ];

              return (
                <motion.div key={`drivers-${currentStream.id}`} custom={dir} variants={slide} initial="enter" animate="center" exit="exit">

                  {/* ── Top header ── */}
                  <div className="mb-4">
                    {/* Stream pills + running MRR */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {streams.map((s, i) => {
                          const done = s.driverDone || s.items.length > 0;
                          return (
                            <button key={s.id} onClick={() => { setStreamIdx(i); setDriverMode("chat"); }}
                              title={s.name}
                              className={`h-2 rounded-full transition-all flex-shrink-0 ${i === streamIdx ? "w-8" : "w-2"} ${done ? "bg-emerald-500" : i === streamIdx ? "bg-cyan-600" : "bg-slate-200"}`} />
                          );
                        })}
                        <span className="text-[11px] text-slate-400 truncate ml-1">
                          Stream {streamIdx + 1} of {streams.length} · <span className="font-semibold text-slate-600">{currentStream.name}</span>
                        </span>
                      </div>
                      {streams.some(s => streamMRR(s) > 0) && (
                        <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full flex-shrink-0">
                          {fmt(streams.reduce((a, s) => a + streamMRR(s), 0))}/mo total
                        </span>
                      )}
                    </div>

                    {/* H2 + subtitle */}
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: Meta.bg }}>
                        <StreamIcon className="w-5 h-5" style={{ color: Meta.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-xl font-bold text-slate-900">Revenue Driver Inputs</h2>
                          {(currentStream.driverDone || hasItems) && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                              <CheckCircle2 className="w-3 h-3" /> {currentStream.items.length} items
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {currentStream.name} · {Meta.label} · Capture sales drivers for accurate forecasting.
                        </p>
                      </div>
                    </div>

                    {/* Micro readiness bar */}
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div className="h-full rounded-full"
                          style={{ background: overallReadiness >= 60
                            ? "linear-gradient(90deg,#059669,#10b981)"
                            : "linear-gradient(90deg,#0e7490,#0891b2)" }}
                          animate={{ width: `${overallReadiness}%` }}
                          transition={{ duration: 0.6, ease: "easeOut" }} />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-500 flex-shrink-0">
                        Forecast readiness {overallReadiness}%
                      </span>
                    </div>
                  </div>

                  {/* ── Two-column ── */}
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_216px] gap-5">

                    {/* Left: Input session */}
                    <div className="space-y-4">

                      {/* Mode tabs */}
                      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                        {([
                          { id: "chat"   as DriverMode, label: "AI Guided",      icon: BrainCircuit },
                          { id: "import" as DriverMode, label: "Import / Paste", icon: Upload },
                          { id: "manual" as DriverMode, label: "Manual Entry",   icon: Pencil },
                        ]).map(({ id, label, icon: Icon }) => (
                          <button key={id} onClick={() => setDriverMode(id)}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                              driverMode === id ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                            }`}>
                            <Icon className="w-3.5 h-3.5" /> {label}
                          </button>
                        ))}
                      </div>

                      {/* Import info banner */}
                      {driverMode === "import" && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-1">
                          <p className="text-xs font-semibold text-slate-700">Upload or paste a product / sales list</p>
                          <p className="text-[11px] text-slate-500">Accepted: Excel, CSV, or pasted table data.</p>
                          <p className="text-[11px] text-slate-400">We&apos;ll extract categories, units, and pricing automatically.</p>
                        </div>
                      )}

                      {/* Manual entry info */}
                      {driverMode === "manual" && currentStream.items.length === 0 && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600">
                          Add items directly in the table below — fill in name, category, volume and price.
                        </div>
                      )}

                      {/* Mode content */}
                      {driverMode === "chat" && <DriverChat
                        stream={currentStream}
                        onUpdate={updateStream}
                        onItemsSaved={handleItemsSaved}
                        situation={situation}
                        isFirstStream={streamIdx === 0}
                        onForecastYears={setForecastHorizon}
                        onForecastStart={(y, m) => { setForecastStartYear(y); setForecastStartMonth(m); }}
                        intakeContext={messages.map(m => `${m.role === "user" ? "Client" : "AI"}: ${m.content}`).join("\n")}
                      />}
                      {driverMode === "import" && <ImportPane stream={currentStream} onUpdate={updateStream} />}

                      {/* Item table */}
                      {(currentStream.items.length > 0 || driverMode === "manual") && (
                        <div>
                          {currentStream.items.length > 0 && (
                            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                              Revenue Items — edit inline
                            </p>
                          )}
                          <ItemTable stream={currentStream} onUpdate={updateStream} fmt={fmt} currencySymbol={getCurrencySymbol(currency)} />
                        </div>
                      )}

                      {/* Navigation */}
                      <div className="flex gap-3 pt-1">
                        <button
                          onClick={() => {
                            if (streamIdx > 0) { setStreamIdx(streamIdx - 1); setDriverMode("chat"); }
                            else { go(1); }
                          }}
                          className="flex items-center gap-2 px-5 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                          <ArrowLeft className="w-4 h-4" /> Back
                        </button>

                        {streamIdx < streams.length - 1 ? (
                          <button onClick={() => { setStreamIdx(streamIdx + 1); setDriverMode("chat"); }}
                            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20"
                            style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                            Next Stream: {streams[streamIdx + 1]?.name} <ArrowRight className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            disabled={!allStreamsReady || isSaving}
                            onClick={async () => {
                              setIsSaving(true); setSaveError(null);
                              try {
                                if (appId && userId) {
                                  const sb = createClient();
                                  await saveStreams(sb, appId, userId,
                                    streams.map((s, i) => ({
                                      id: isDbId(s.id) ? s.id : undefined,
                                      name: s.name, type: s.type, confidence: s.confidence,
                                      monthly_growth_pct: s.monthlyGrowthPct,
                                      sub_new_per_month: s.subNewPerMonth,
                                      sub_churn_pct: s.subChurnPct,
                                      rental_occupancy_pct: s.rentalOccupancyPct,
                                      driver_done: s.driverDone,
                                      position: i,
                                    }))
                                  );
                                  await updateApplicationFlags(sb, appId, { drivers_done: true });
                                }
                                go(3);
                              } catch (e) {
                                setSaveError(e instanceof Error ? e.message : (e as {message?: string}).message ?? "Save failed — please retry");
                              } finally {
                                setIsSaving(false);
                              }
                            }}
                            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                            {isSaving
                              ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                </svg> Saving…</>
                              : <><BarChart3 className="w-4 h-4" /> Build Forecast</>
                            }
                          </button>
                        )}
                      </div>
                      {saveError && <p className="text-xs text-red-500 text-center">{saveError}</p>}
                      {!allStreamsReady && streamIdx === streams.length - 1 && (
                        <p className="text-[11px] text-slate-400 text-center">
                          Complete driver inputs for all streams to unlock forecast generation.
                        </p>
                      )}
                    </div>

                    {/* ── Right: Live Revenue Model ── */}
                    <div className="hidden lg:flex flex-col gap-3">

                      {/* Input Status */}
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_16px_rgba(0,0,0,0.07)] p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                          Input Status
                        </p>
                        <p className="text-[11px] font-semibold text-slate-600 mb-2 truncate">{currentStream.name}</p>
                        <div className="space-y-2">
                          {inputStatus.map(({ label, done }) => (
                            <div key={label} className="flex items-center gap-2">
                              <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                                done ? "bg-emerald-500" : "border-2 border-slate-200"
                              }`}>
                                {done && <Check className="w-2.5 h-2.5 text-white" />}
                              </div>
                              <span className={`text-xs ${done ? "text-slate-700 font-medium" : "text-slate-400"}`}>
                                {label}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Stream readiness mini-bar */}
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] text-slate-400 uppercase tracking-wider">Stream Readiness</p>
                            <p className="text-[10px] font-bold text-slate-600">{currentReadiness}%</p>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div className="h-full rounded-full"
                              style={{ background: currentReadiness >= 75 ? "linear-gradient(90deg,#059669,#10b981)" : "linear-gradient(90deg,#0e7490,#0891b2)" }}
                              animate={{ width: `${currentReadiness}%` }}
                              transition={{ duration: 0.5 }} />
                          </div>
                        </div>
                      </div>

                      {/* Detected Structure */}
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_16px_rgba(0,0,0,0.07)] p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                          Detected Structure
                        </p>
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Items</span>
                            <span className="text-xs font-bold text-slate-800">{currentStream.items.length}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Categories</span>
                            <span className="text-xs font-bold text-slate-800">{cats.length || "—"}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Est. MRR</span>
                            <span className={`text-xs font-bold ${curMRR > 0 ? "text-emerald-600" : "text-slate-400 italic font-normal"}`}>
                              {curMRR > 0 ? `${fmt(curMRR)}/mo` : "Pending"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Stream Type</span>
                            <span className="text-xs font-medium" style={{ color: Meta.color }}>{Meta.label}</span>
                          </div>
                        </div>
                      </div>

                      {/* Overall Forecast Readiness */}
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_16px_rgba(0,0,0,0.07)] p-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            Forecast Readiness
                          </p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            overallReadiness >= 75
                              ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                              : overallReadiness >= 40
                              ? "bg-amber-50 text-amber-700 border-amber-100"
                              : "bg-red-50 text-red-600 border-red-100"
                          }`}>
                            {overallReadiness >= 75 ? "Ready" : overallReadiness >= 40 ? "Building" : "Early"}
                          </span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-1.5">
                          <motion.div className="h-full rounded-full"
                            style={{ background: overallReadiness >= 75
                              ? "linear-gradient(90deg,#059669,#10b981)"
                              : "linear-gradient(90deg,#0e7490,#0891b2)" }}
                            animate={{ width: `${overallReadiness}%` }}
                            transition={{ duration: 0.6, ease: "easeOut" }} />
                        </div>
                        <p className="text-[10px] text-slate-400 text-right font-semibold">{overallReadiness}%</p>
                        <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                          {overallReadiness >= 75
                            ? "All driver inputs captured — you can build the forecast."
                            : "Complete volumes and pricing to unlock forecast generation."}
                        </p>
                      </div>

                    </div>{/* /right rail */}

                  </div>{/* /two-column */}
                </motion.div>
              );
            })()}


            {/* ══ STEP 3: Multi-Year Forecast ══ */}
            {step === 3 && (
              <motion.div key="forecast" custom={dir} variants={slide} initial="enter" animate="center" exit="exit"
                className="space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className="w-5 h-5" style={{ color: "#0e7490" }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#0e7490" }}>
                      Revenue Forecast
                    </span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Revenue Projection Model</h2>
                  <p className="text-slate-500 text-sm mt-1">
                    {forecastHorizon}-year forecast · Item-level drivers · Scenario-ready
                  </p>
                </div>

                <ForecastView
                  streams={streams}
                  onUpdateStream={updateStream}
                  horizonYears={forecastHorizon}
                  onHorizonChange={setForecastHorizon}
                  startYear={forecastStartYear}
                  startMonth={forecastStartMonth}
                  currency={currency}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button onClick={() => go(2)}
                    className="flex items-center justify-center gap-2 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Adjust Numbers
                  </button>
                  <button
                    disabled={isSaving}
                    onClick={async () => {
                      setIsSaving(true); setSaveError(null);
                      try {
                        // Build projection using the user's chosen horizon + start date
                        const startDate = new Date(forecastStartYear, forecastStartMonth, 1);
                        const projection = projectRevenue(streams, forecastHorizon * 12, startDate);

                        // Derive dashboard metrics from the projection
                        const monthlyBaseline   = projection[0]?.total ?? 0;
                        const year1Revenue      = projection.slice(0, 12).reduce((a, m) => a + m.total, 0);
                        const totalRevenue      = projection.reduce((a, m) => a + m.total, 0);
                        const finalYearRevenue  = projection.slice(-12).reduce((a, m) => a + m.total, 0);

                        // Keep localStorage for any legacy readers
                        localStorage.setItem("mvx_revenue_model", JSON.stringify({
                          streams, projection, applicationId: appId,
                        }));

                        // Persist everything to Supabase using the session's appId
                        if (appId && userId) {
                          const sb = createClient();

                          // 1. Final stream + item save (with correct DB IDs)
                          const savedStreams = await saveStreams(sb, appId, userId,
                            streams.map((s, i) => ({
                              id: isDbId(s.id) ? s.id : undefined,
                              name: s.name, type: s.type, confidence: s.confidence,
                              monthly_growth_pct: s.monthlyGrowthPct,
                              sub_new_per_month: s.subNewPerMonth,
                              sub_churn_pct: s.subChurnPct,
                              rental_occupancy_pct: s.rentalOccupancyPct,
                              driver_done: s.driverDone,
                              position: i,
                            }))
                          );
                          for (let i = 0; i < savedStreams.length; i++) {
                            const local = streams[i]; const db = savedStreams[i];
                            if (local?.items?.length && db) {
                              await saveStreamItems(sb, db.id, userId, local.items.map((it, pos) => ({
                                name: it.name, category: it.category,
                                volume: it.volume, price: it.price,
                                unit: it.unit, note: it.note, position: pos,
                              })));
                            }
                          }

                          // 2. Forecast config
                          const fConfig = await saveForecastConfig(sb, appId, userId, {
                            startMonth:   forecastStartMonth,
                            startYear:    forecastStartYear,
                            horizonYears: forecastHorizon,
                          });

                          // 3. Projection snapshot (powers dashboard metrics)
                          await saveProjectionSnapshot(sb, appId, userId, fConfig.id, {
                            monthlyBaseline, year1Revenue, totalRevenue, finalYearRevenue,
                          }, projection);

                          // 4. Mark forecast complete
                          await updateApplicationFlags(sb, appId, {
                            forecast_done: true, drivers_done: true, wizard_step: 3,
                          });
                        }

                        router.push("/dashboard");
                      } catch (e) {
                        console.error("[apply] forecast save error:", e);
                        setSaveError(e instanceof Error ? e.message : (e as {message?: string}).message ?? "Save failed — please retry");
                        setIsSaving(false); // let user retry
                      }
                    }}
                    className="flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                    {isSaving ? (
                      <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg> Saving…</>
                    ) : (
                      <>Save &amp; Continue Application <ArrowRight className="w-4 h-4" /></>
                    )}
                  </button>
                  {saveError && (
                    <p className="text-xs text-red-500 col-span-2 text-center -mt-2">{saveError}</p>
                  )}
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// useSearchParams() requires a Suspense boundary in Next.js App Router
export default function ApplyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
            <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
          </div>
          <p className="text-sm text-slate-500 font-medium">Loading…</p>
        </div>
      </div>
    }>
      <ApplyPageInner />
    </Suspense>
  );
}
