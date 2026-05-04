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
  saveActuals, saveOperatingExpenses, saveBusinessProfile,
  updateStream as updateStreamDb,
  type DbApplication, type ApplicationState, type DbBusinessProfile,
} from "@/lib/supabase/revenue";
import { RevenueEngine } from "./RevenueEngine";
import { CURRENCIES, getCurrencySymbol, makeFmt } from "@/lib/utils/currency";
import {
  ArrowLeft, ArrowRight, Plus, Trash2, Edit3, Check, X,
  BrainCircuit, BarChart3, TrendingUp, ShoppingBag, Briefcase,
  Repeat, Landmark, Zap, CheckCircle2, RefreshCw, Send,
  ChevronDown, ChevronUp, Info, Pencil, Clipboard,
  Calendar, ChevronRight, ScrollText, Users,
  Rocket, Store, Wrench, RefreshCcw, Banknote,
  Mic, MicOff, Volume2,
} from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

/** Strip markdown the AI may emit — bold, italic, bullets, headings, separators */
function cleanAI(text: string): string {
  return text
    .replace(/^\s*\*{3,}\s*$/gm,  "")     // standalone *** / **** separator lines
    .replace(/^\s*-{3,}\s*$/gm,   "")     // standalone --- separator lines
    .replace(/\*\*\*(.*?)\*\*\*/gs, "$1") // bold+italic ***text***
    .replace(/\*\*(.*?)\*\*/gs,    "$1")  // bold **text**
    .replace(/\*(.*?)\*/gs,        "$1")  // italic *text*
    .replace(/`([^`]+)`/g,         "$1")  // inline code `text`
    .replace(/^#{1,6}\s+/gm,       "")    // headings # H1
    .replace(/^[-•]\s+/gm,         "")    // bullet list items - item
    .replace(/^\d+\.\s+/gm,        "")    // numbered list items 1. item
    .replace(/\n{3,}/g,            "\n\n")// collapse triple+ blank lines
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
type SeasonalityPreset = "none" | "q4_peak" | "q1_slow" | "summer_peak" | "end_of_year" | "construction"
  | "wet_season" | "harvest" | "school_term" | "tourism_high" | "ramadan" | "back_to_school" | "mid_year_slow" | "agri_planting"
  | "custom";

interface ChatMessage { role: "user" | "assistant"; content: string; }
interface StreamItem  { id: string; name: string; category: string; volume: number; price: number; costPrice?: number; unit: string; note?: string; seasonalityPreset?: SeasonalityPreset; }

/** Per-category or per-item growth/seasonality/event override. null = inherit from stream. */
interface GrowthOverride {
  id:                    string;
  scope:                 "category" | "item";
  targetId:              string;                      // category name OR item.id
  targetName:            string;
  volumeGrowthPct:       number | null;               // null → stream default
  annualPriceGrowthPct:  number | null;               // null → stream default
  seasonalityPreset:     SeasonalityPreset | null;
  seasonalityMultipliers: number[] | null;            // 12-element array or null
  launchMonth:           number | null;               // 0-based; null = always active
  sunsetMonth:           number | null;               // 0-based; null = never ends
}

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
  // Seasonality
  seasonalityPreset:      SeasonalityPreset;
  seasonalityMultipliers: number[];          // 12 per-month relative factors (avg ≈ 1)
  // Expansion event
  expansionMonth:         number | null;     // 0-based month index when expansion kicks in
  expansionMultiplier:    number;            // e.g. 1.5 = 50% uplift from that month on
  // Advanced per-category / per-item overrides
  overrides: GrowthOverride[];
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
// "custom" = engine-extracted rates that don't match any preset — never overwritten by preset buttons
type GrowthScenario = "conservative" | "base" | "growth" | "custom";

const GROWTH_PRESETS: Record<Exclude<GrowthScenario, "custom">, {
  label: string; desc: string; volPct: number; pricePct: number; confidence: Confidence;
}> = {
  conservative: { label: "Conservative", desc: "Modest growth, stable pricing",               volPct: 0.5, pricePct: 2.0, confidence: "high" },
  base:         { label: "Base",         desc: "Flat — current run rate, no growth assumed",  volPct: 0,   pricePct: 0,   confidence: "high" },
  growth:       { label: "Growth Case",  desc: "Strong performance scenario",                 volPct: 3.0, pricePct: 8.0, confidence: "low"  },
};

/* ═══════════════════════════════ seasonality presets ══ */
// Each months[] array contains 12 relative multipliers that sum to exactly 12
// (so the annual average multiplier is 1.0 — no inflation/deflation of the total).
const SEASONALITY_PRESETS: Record<SeasonalityPreset, { label: string; desc: string; months: number[] }> = {
  none:        { label: "None",          desc: "Flat revenue — no seasonal pattern applied",        months: Array(12).fill(1) },
  q4_peak:     { label: "Q4 Retail",     desc: "Nov–Dec surge, Jan–Feb slow (retail / e-commerce)", months: [0.82, 0.80, 0.90, 0.92, 0.95, 0.98, 0.95, 0.92, 1.00, 1.05, 1.20, 1.51] },
  q1_slow:     { label: "Q1 Slow",       desc: "Post-holiday demand dip in Q1",                    months: [0.75, 0.78, 0.95, 1.05, 1.10, 1.12, 1.12, 1.08, 1.02, 1.02, 1.00, 1.01] },
  summer_peak: { label: "Summer Peak",   desc: "Jun–Aug high season (tourism / outdoor)",          months: [0.80, 0.82, 0.90, 1.00, 1.08, 1.20, 1.28, 1.22, 1.10, 0.98, 0.90, 0.72] },
  end_of_year: { label: "Year-End Corp", desc: "Q4 corporate budget flush (B2B / consulting)",     months: [0.88, 0.88, 0.92, 0.95, 1.00, 1.00, 0.92, 0.95, 1.05, 1.10, 1.18, 1.17] },
  construction:  { label: "Dry Season",         desc: "Dry-season peak (construction / farming)",           months: [1.15, 1.18, 1.20, 1.10, 1.05, 0.85, 0.80, 0.82, 0.90, 1.00, 1.05, 0.90] },
  wet_season:    { label: "Wet Season",         desc: "Rainy season slowdown, dry months peak",              months: [1.10, 1.05, 1.00, 0.90, 0.75, 0.65, 0.60, 0.65, 0.80, 1.00, 1.10, 1.15] },
  harvest:       { label: "Harvest Season",     desc: "Oct–Nov harvest spike",                               months: [0.85, 0.82, 0.90, 0.95, 1.00, 0.95, 0.90, 0.95, 1.05, 1.25, 1.35, 1.03] },
  school_term:   { label: "School Term",        desc: "School holidays dip, term-time peaks",               months: [1.00, 1.05, 1.10, 1.05, 1.05, 0.70, 0.65, 0.70, 1.20, 1.25, 1.15, 0.80] },
  tourism_high:  { label: "Tourism High",       desc: "Jan + Dec peak high season",                         months: [1.30, 1.25, 1.15, 1.05, 0.90, 0.80, 0.85, 0.90, 0.95, 1.00, 1.10, 1.35] },
  ramadan:       { label: "Ramadan / Eid",      desc: "Mar–Apr surge, Dec festive boost",                   months: [0.95, 0.95, 1.50, 1.60, 1.20, 0.90, 0.85, 0.88, 0.90, 0.92, 0.95, 1.40] },
  back_to_school:{ label: "Back-to-School",     desc: "Aug–Sep back-to-school spike",                       months: [1.10, 1.05, 0.95, 0.92, 0.90, 0.80, 0.80, 1.45, 1.35, 1.10, 0.92, 0.72] },
  mid_year_slow: { label: "Mid-Year Slow",      desc: "Jun–Aug mid-year trough",                            months: [1.10, 1.05, 1.02, 0.95, 0.85, 0.75, 0.72, 0.78, 0.95, 1.10, 1.15, 1.18] },
  agri_planting: { label: "Agri Planting",      desc: "Mar–May planting spend cycle",                       months: [0.80, 0.82, 1.10, 1.30, 1.20, 0.90, 0.75, 0.80, 0.85, 1.00, 1.05, 0.93] },
  custom:        { label: "Custom",             desc: "Define your own monthly pattern",                    months: Array(12).fill(1) },
};

function effectiveMonthlyGrowth(volPct: number, annualPricePct: number): number {
  return parseFloat((volPct + annualPricePct / 12).toFixed(2));
}

/**
 * Derive the growth scenario purely from vol + price rates — do NOT rely on
 * stream.scenario which is set by the UI preset buttons and may lag behind
 * engine-extracted rates written directly to the DB.
 */
function effectiveScenario(volPct: number, annualPricePct: number): GrowthScenario {
  const r     = effectiveMonthlyGrowth(volPct, annualPricePct);
  const cRate = effectiveMonthlyGrowth(0.5, 2.0);   // conservative
  const gRate = effectiveMonthlyGrowth(3.0, 8.0);   // growth
  if (r === 0)                     return "base";
  if (Math.abs(r - cRate) < 0.05) return "conservative";
  if (Math.abs(r - gRate) < 0.1)  return "growth";
  return "custom";
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
    seasonalityPreset:      "none",
    seasonalityMultipliers: Array(12).fill(1) as number[],
    expansionMonth:         null,
    expansionMultiplier:    1.5,
    overrides: [],
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

/** Plain-English description of an active override rule — used in ItemTable card and modal. */
function describeOverrideRule(ovr: GrowthOverride): string {
  const parts: string[] = [];
  if (ovr.volumeGrowthPct      !== null) parts.push(`${ovr.volumeGrowthPct > 0 ? "+" : ""}${ovr.volumeGrowthPct}% growth/mo`);
  if (ovr.annualPriceGrowthPct !== null) parts.push(`${ovr.annualPriceGrowthPct > 0 ? "+" : ""}${ovr.annualPriceGrowthPct}% price/yr`);
  if (ovr.seasonalityPreset)              parts.push(SEASONALITY_PRESETS[ovr.seasonalityPreset]?.label ?? ovr.seasonalityPreset);
  if (ovr.launchMonth  !== null)          parts.push(`from month ${ovr.launchMonth + 1}`);
  if (ovr.sunsetMonth  !== null)          parts.push(`ends month ${ovr.sunsetMonth + 1}`);
  return parts.length ? parts.join(" · ") : "Uses base assumptions";
}

/* ═══════════════════════════════════════ projection ══ */
interface ProjMonth {
  index: number; year: number; monthLabel: string; yearMonth: string; total: number;
  byStream: {
    id: string; name: string; type: StreamType; rev: number;
    byCategory: Record<string, { rev: number; items: { id: string; name: string; rev: number }[] }>;
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
      const byCategory: Record<string, { rev: number; items: { id: string; name: string; rev: number }[] }> = {};
      let streamRev = 0;

      const addItem = (id: string, name: string, cat: string, rev: number) => {
        const c = cat || "Other";
        if (!byCategory[c]) byCategory[c] = { rev: 0, items: [] };
        byCategory[c].rev += rev;
        byCategory[c].items.push({ id, name, rev });
        streamRev += rev;
      };

      // Calendar month for seasonality lookup
      const calMonth = (startDate.getMonth() + i) % 12;

      // Stream-level expansion factor (applies to all items, stream-wide)
      const expansionFactor = (s.expansionMonth !== null && s.expansionMonth !== undefined && i >= s.expansionMonth)
        ? (s.expansionMultiplier ?? 1)
        : 1;

      // Per-item override resolver:
      // seasonality priority: item.seasonalityPreset > item override > category override > stream default
      // growth/pricing priority: item override > category override > stream default
      const getItemParams = (it: StreamItem) => {
        const ovrs = s.overrides ?? [];
        const itemOvr = ovrs.find((o) => o.scope === "item"     && o.targetId === it.id);
        const catOvr  = ovrs.find((o) => o.scope === "category" && o.targetId === it.category);
        const ovr = itemOvr ?? catOvr ?? null;
        // Item-level seasonality preset is highest priority (but "none" means flat, not "inherit")
        const itemSeasonMults: number[] | null =
          it.seasonalityPreset
            ? (it.seasonalityPreset === "none"
                ? Array(12).fill(1) as number[]
                : SEASONALITY_PRESETS[it.seasonalityPreset]?.months ?? null)
            : null;
        return {
          volPct:      ovr?.volumeGrowthPct      ?? s.volumeGrowthPct      ?? 0,
          pricePct:    ovr?.annualPriceGrowthPct ?? s.annualPriceGrowthPct ?? 0,
          seasonMults: itemSeasonMults ?? ovr?.seasonalityMultipliers ?? s.seasonalityMultipliers ?? (Array(12).fill(1) as number[]),
          launchMonth: ovr?.launchMonth ?? null,
          sunsetMonth: ovr?.sunsetMonth ?? null,
        };
      };

      if (s.type === "subscription") {
        // Churn model: subscribers_t = subscribers_{t-1} + new - churn
        if (i > 0) {
          const churn = Math.round(subTotals[s.id] * (s.subChurnPct ?? 0) / 100);
          subTotals[s.id] = Math.max(0, subTotals[s.id] + (s.subNewPerMonth ?? 0) - churn);
        }
        const initial = Math.max(1, s.items.reduce((a, it) => a + it.volume, 0));
        const subFactor = subTotals[s.id] / initial;
        s.items.forEach((it) => {
          const p = getItemParams(it);
          if (p.launchMonth !== null && i < p.launchMonth) return;
          if (p.sunsetMonth !== null && i > p.sunsetMonth) return;
          const pF = Math.pow(1 + p.pricePct / 1200, i);
          const sF = p.seasonMults[calMonth] ?? 1;
          addItem(it.id, it.name, it.category, Math.round(it.volume * it.price * subFactor * pF * sF * expansionFactor));
        });

      } else if (s.type === "rental") {
        const occ = (s.rentalOccupancyPct ?? 100) / 100;
        s.items.forEach((it) => {
          const p = getItemParams(it);
          if (p.launchMonth !== null && i < p.launchMonth) return;
          if (p.sunsetMonth !== null && i > p.sunsetMonth) return;
          const vF = Math.pow(1 + p.volPct   / 100,  i);
          const pF = Math.pow(1 + p.pricePct / 1200, i);
          const sF = p.seasonMults[calMonth] ?? 1;
          addItem(it.id, it.name, it.category, Math.round(it.volume * vF * it.price * pF * occ * sF * expansionFactor));
        });

      } else if (s.type === "marketplace") {
        s.items.forEach((it) => {
          const p = getItemParams(it);
          if (p.launchMonth !== null && i < p.launchMonth) return;
          if (p.sunsetMonth !== null && i > p.sunsetMonth) return;
          const vF = Math.pow(1 + p.volPct   / 100,  i);
          const pF = Math.pow(1 + p.pricePct / 1200, i);
          const sF = p.seasonMults[calMonth] ?? 1;
          addItem(it.id, it.name, it.category, Math.round(it.volume * vF * (it.price / 100) * pF * sF * expansionFactor));
        });

      } else {
        // product, service, contract, custom
        s.items.forEach((it) => {
          const p = getItemParams(it);
          if (p.launchMonth !== null && i < p.launchMonth) return;
          if (p.sunsetMonth !== null && i > p.sunsetMonth) return;
          const vF = Math.pow(1 + p.volPct   / 100,  i);
          const pF = Math.pow(1 + p.pricePct / 1200, i);
          const sF = p.seasonMults[calMonth] ?? 1;
          addItem(it.id, it.name, it.category, Math.round(it.volume * vF * it.price * pF * sF * expansionFactor));
        });
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

/**
 * groupByFY — group projection months by financial year.
 * fyEndMonth: 0=Jan … 11=Dec — the last month of the financial year.
 * e.g. fyEndMonth=2 → FY runs Apr–Mar; fyEndMonth=11 → Jan–Dec (calendar year).
 * The fyYear label is the calendar year in which the FY ends.
 */
function groupByFY(
  months: ProjMonth[],
  fyEndMonth: number,
  projStartYear: number,
  projStartMonth: number,
) {
  const map = new Map<number, ProjMonth[]>();
  months.forEach((m) => {
    const absMonth = projStartMonth + m.index;
    const calMonth = absMonth % 12;                                   // 0-indexed calendar month
    const calYear  = projStartYear + Math.floor(absMonth / 12);
    // FY ends in calYear when calMonth ≤ fyEndMonth, else FY ends next year
    const fyYear   = calMonth <= fyEndMonth ? calYear : calYear + 1;
    if (!map.has(fyYear)) map.set(fyYear, []);
    map.get(fyYear)!.push(m);
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([fyYear, ms], i) => ({
      year:       i + 1,        // 1-based period index (used for fallback)
      fyYear,                   // the calendar year in which this FY ends
      months:     ms,
      total:      ms.reduce((a, b) => a + b.total, 0),
      startLabel: ms[0].yearMonth,
      endLabel:   ms[ms.length - 1].yearMonth,
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
      { name: string; category?: string; volume?: number; price?: number; cost_price?: number; unit?: string; note?: string }[];
    return arr.map((a) => ({
      id: uid(), name: a.name, category: a.category ?? "General",
      volume: a.volume ?? 0, price: a.price ?? 0,
      costPrice: typeof a.cost_price === "number" ? a.cost_price : undefined,
      unit: a.unit ?? "unit", note: a.note,
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

/** One month of actual (historical) revenue data */
interface ActualMonth { yearMonth: string; total: number; }

function parseActuals(text: string): ActualMonth[] | null {
  const idx = text.indexOf("[ACTUALS_DETECTED]");
  if (idx === -1) return null;
  try {
    const arr = JSON.parse(text.slice(idx + "[ACTUALS_DETECTED]".length).trim()) as
      { yearMonth?: string; revenue?: number; note?: string }[];
    return arr
      .map((a) => ({ yearMonth: a.yearMonth ?? "", total: Number(a.revenue ?? 0) }))
      .filter((a) => /^\d{4}-\d{2}$/.test(a.yearMonth))
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
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

  if (stream.type === "custom") {
    return (
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
        <p className="text-xs text-indigo-700">
          <span className="font-semibold">Custom formula:</span>{" "}
          Revenue = Volume × Price per unit. Use Volume for your output quantity (e.g. sachets, kg, litres) and Price for the selling price per unit.
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
      <td className="px-2 py-2 text-center">
        <select
          value={item.seasonalityPreset ?? ""}
          onChange={(e) => {
            const val = e.target.value as SeasonalityPreset | "";
            onChange({ ...item, seasonalityPreset: val || undefined });
          }}
          title="Per-item seasonality — overrides stream default"
          className="text-[9px] text-slate-400 bg-transparent border-b border-transparent group-hover:border-slate-200 focus:border-cyan-400 outline-none cursor-pointer hover:text-slate-600 transition-colors max-w-[72px]">
          <option value="">Stream</option>
          {(Object.keys(SEASONALITY_PRESETS) as SeasonalityPreset[])
            .filter((p) => p !== "custom")
            .map((p) => (
              <option key={p} value={p}>{SEASONALITY_PRESETS[p].label}</option>
            ))}
        </select>
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

/* ═══════════════════════════════════════ OverrideRow ══ */
function OverrideRow({
  override: ovr, onUpdate, onDelete, isEditing, onToggleEdit,
}: {
  override: GrowthOverride;
  onUpdate: (o: GrowthOverride) => void;
  onDelete: () => void;
  isEditing: boolean;
  onToggleEdit: () => void;
}) {
  const months12 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const summary = [
    ovr.volumeGrowthPct      !== null ? `Vol ${ovr.volumeGrowthPct}%/mo`       : null,
    ovr.annualPriceGrowthPct !== null ? `Price ${ovr.annualPriceGrowthPct}%/yr` : null,
    ovr.seasonalityPreset               ? SEASONALITY_PRESETS[ovr.seasonalityPreset]?.label : null,
  ].filter(Boolean).join(" · ") || "All defaults — click to configure";

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 cursor-pointer" onClick={onToggleEdit}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${ovr.scope === "category" ? "bg-cyan-50 text-cyan-700" : "bg-violet-50 text-violet-700"}`}>
            {ovr.scope === "category" ? "Category" : "Item"}
          </span>
          <span className="text-xs font-semibold text-slate-700 truncate">{ovr.targetName}</span>
          <span className="text-[10px] text-slate-400 truncate hidden sm:block">{summary}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isEditing ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded hover:bg-red-50 transition-colors ml-1">
            <Trash2 className="w-3 h-3 text-slate-300 hover:text-red-400" />
          </button>
        </div>
      </div>

      {isEditing && (
        <div className="px-4 py-3 space-y-3 border-t border-slate-100 bg-white">
          {/* Vol + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Vol Growth / mo</label>
              <div className="flex items-center gap-1.5">
                <input type="number" min={-10} max={30} step={0.1} placeholder="stream"
                  value={ovr.volumeGrowthPct ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const n = parseFloat(val);
                    const v = val === "" || isNaN(n) ? null : n;
                    const r: GrowthOverride = { ...ovr, volumeGrowthPct: v };
                    onUpdate(r);
                  }}
                  className="w-16 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400 placeholder:text-slate-300 placeholder:font-normal" />
                <span className="text-[10px] text-slate-400">% (blank = stream)</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Price Increase / yr</label>
              <div className="flex items-center gap-1.5">
                <input type="number" min={-10} max={50} step={0.5} placeholder="stream"
                  value={ovr.annualPriceGrowthPct ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const n = parseFloat(val);
                    const v = val === "" || isNaN(n) ? null : n;
                    const r: GrowthOverride = { ...ovr, annualPriceGrowthPct: v };
                    onUpdate(r);
                  }}
                  className="w-16 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400 placeholder:text-slate-300 placeholder:font-normal" />
                <span className="text-[10px] text-slate-400">% (blank = stream)</span>
              </div>
            </div>
          </div>

          {/* Seasonality */}
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Seasonality Pattern</label>
            <select
              value={ovr.seasonalityPreset ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (!val) {
                  onUpdate({ ...ovr, seasonalityPreset: null, seasonalityMultipliers: null });
                } else {
                  const preset = val as SeasonalityPreset;
                  onUpdate({ ...ovr, seasonalityPreset: preset, seasonalityMultipliers: [...SEASONALITY_PRESETS[preset].months] });
                }
              }}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:border-cyan-400 w-full max-w-xs">
              <option value="">— use stream default —</option>
              {(Object.keys(SEASONALITY_PRESETS) as SeasonalityPreset[]).map((p) => (
                <option key={p} value={p}>{SEASONALITY_PRESETS[p].label} — {SEASONALITY_PRESETS[p].desc}</option>
              ))}
            </select>

            {ovr.seasonalityPreset === "custom" && (
              <div className="space-y-1.5 mt-2.5 p-3 bg-slate-50 rounded-xl">
                {(ovr.seasonalityMultipliers ?? Array(12).fill(1) as number[]).map((v, mi) => (
                  <div key={mi} className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-400 w-7 text-right shrink-0">{months12[mi]}</span>
                    <input type="range" min={0} max={3} step={0.05} value={v}
                      onChange={(e) => {
                        const mults = [...(ovr.seasonalityMultipliers ?? Array(12).fill(1) as number[])];
                        mults[mi] = parseFloat(e.target.value);
                        onUpdate({ ...ovr, seasonalityMultipliers: mults });
                      }}
                      className="flex-1 h-1 appearance-none cursor-pointer rounded-full"
                      style={{ accentColor: "#0e7490" }} />
                    <span className="text-[9px] font-bold text-slate-600 w-8 text-right shrink-0">{v.toFixed(2)}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Launch / Sunset */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Launch Month</label>
              <div className="flex items-center gap-1.5">
                <input type="number" min={1} max={240} placeholder="always"
                  value={ovr.launchMonth !== null ? ovr.launchMonth + 1 : ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const n = parseInt(val, 10);
                    onUpdate({ ...ovr, launchMonth: val === "" || isNaN(n) ? null : Math.max(0, n - 1) });
                  }}
                  className="w-16 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400 placeholder:text-slate-300 placeholder:font-normal" />
                <span className="text-[10px] text-slate-400">of projection</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Sunset Month</label>
              <div className="flex items-center gap-1.5">
                <input type="number" min={1} max={240} placeholder="never"
                  value={ovr.sunsetMonth !== null ? ovr.sunsetMonth + 1 : ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const n = parseInt(val, 10);
                    onUpdate({ ...ovr, sunsetMonth: val === "" || isNaN(n) ? null : Math.max(0, n - 1) });
                  }}
                  className="w-16 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400 placeholder:text-slate-300 placeholder:font-normal" />
                <span className="text-[10px] text-slate-400">of projection</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════ AdvancedGrowthModal ══ */
function AdvancedGrowthModal({
  stream, onUpdate, onClose,
}: {
  stream: RevenueStream;
  onUpdate: (s: RevenueStream) => void;
  onClose: () => void;
}) {
  const months12 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const categories = [...new Set(stream.items.map((i) => i.category))];

  /* ── Builder state ── */
  type BuilderState = {
    scope: "category" | "item";
    targetId: string;
    volPct: string;
    pricePct: string;
    seasonality: SeasonalityPreset | "";
    customMults: number[];
    launch: string;
    sunset: string;
  };
  const emptyBuilder = (): BuilderState => ({
    scope: "category", targetId: "",
    volPct: "", pricePct: "",
    seasonality: "", customMults: Array(12).fill(1) as number[],
    launch: "", sunset: "",
  });
  const [builder, setBuilder] = useState<BuilderState>(emptyBuilder());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDefaults, setEditingDefaults] = useState(false);

  const b = builder;
  const setB = (patch: Partial<BuilderState>) => setBuilder((prev) => ({ ...prev, ...patch }));

  const switchScope = (scope: "category" | "item") => setB({ scope, targetId: "" });

  const targetOptions = b.scope === "category"
    ? categories.map((c) => ({ id: c, name: c }))
    : stream.items.map((i) => ({ id: i.id, name: i.name }));

  const usedTargets = new Set(
    (stream.overrides ?? []).filter((o) => o.id !== editingId).map((o) => o.targetId)
  );

  // Use module-level helper
  const describeRule = describeOverrideRule;

  const commitRule = () => {
    if (!b.targetId) return;
    const targetName = b.scope === "category"
      ? b.targetId
      : stream.items.find((i) => i.id === b.targetId)?.name ?? b.targetId;
    const season = b.seasonality as SeasonalityPreset | "";
    const ovr: GrowthOverride = {
      id: editingId ?? uid(),
      scope: b.scope, targetId: b.targetId, targetName,
      volumeGrowthPct:      b.volPct   !== "" ? parseFloat(b.volPct)   : null,
      annualPriceGrowthPct: b.pricePct !== "" ? parseFloat(b.pricePct) : null,
      seasonalityPreset:    season || null,
      seasonalityMultipliers: season === "custom"
        ? [...b.customMults]
        : season ? [...SEASONALITY_PRESETS[season].months] : null,
      launchMonth: b.launch !== "" ? Math.max(0, parseInt(b.launch, 10) - 1) : null,
      sunsetMonth: b.sunset !== "" ? Math.max(0, parseInt(b.sunset, 10) - 1) : null,
    };
    if (editingId) {
      onUpdate({ ...stream, overrides: (stream.overrides ?? []).map((o) => (o.id === editingId ? ovr : o)) });
    } else {
      onUpdate({ ...stream, overrides: [...(stream.overrides ?? []), ovr] });
    }
    setBuilder(emptyBuilder());
    setEditingId(null);
  };

  const startEdit = (ovr: GrowthOverride) => {
    setEditingId(ovr.id);
    setBuilder({
      scope:       ovr.scope,
      targetId:    ovr.targetId,
      volPct:      ovr.volumeGrowthPct      !== null ? String(ovr.volumeGrowthPct)      : "",
      pricePct:    ovr.annualPriceGrowthPct !== null ? String(ovr.annualPriceGrowthPct) : "",
      seasonality: ovr.seasonalityPreset ?? "",
      customMults: ovr.seasonalityMultipliers ?? (Array(12).fill(1) as number[]),
      launch:      ovr.launchMonth !== null ? String(ovr.launchMonth + 1) : "",
      sunset:      ovr.sunsetMonth !== null ? String(ovr.sunsetMonth + 1) : "",
    });
  };

  const cancelEdit = () => { setBuilder(emptyBuilder()); setEditingId(null); };

  const deleteRule = (id: string) => {
    onUpdate({ ...stream, overrides: (stream.overrides ?? []).filter((o) => o.id !== id) });
    if (editingId === id) cancelEdit();
  };

  const overrides = stream.overrides ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-xl mx-4 my-10 bg-white rounded-2xl shadow-2xl flex flex-col">

        {/* ── Header ── */}
        <div className="px-7 pt-7 pb-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Advanced Revenue Drivers</p>
              <h2 className="text-base font-bold text-slate-900 leading-tight">{stream.name}</h2>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed max-w-xs">
                Adjust how this stream grows and how specific items behave over the projection.
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 transition-colors mt-0.5 shrink-0">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="px-7 pb-7 space-y-7">

          {/* ─────── § 1  Base Assumptions ─────── */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Base Assumptions</p>
              <button onClick={() => setEditingDefaults(!editingDefaults)}
                className="text-[10px] font-bold text-cyan-600 hover:text-cyan-700 transition-colors">
                {editingDefaults ? "Collapse" : "Edit"}
              </button>
            </div>

            {!editingDefaults ? (
              /* Summary pill row */
              <div className="bg-slate-50 rounded-xl px-4 py-3">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                  <span className="text-slate-500">Growth <span className="font-bold text-slate-800 ml-1">+{stream.volumeGrowthPct ?? 0}%<span className="font-normal text-slate-400">/mo</span></span></span>
                  <span className="text-slate-500">Price <span className="font-bold text-slate-800 ml-1">+{stream.annualPriceGrowthPct ?? 0}%<span className="font-normal text-slate-400">/yr</span></span></span>
                  <span className="text-slate-500">Seasonality <span className="font-bold text-slate-800 ml-1">{SEASONALITY_PRESETS[stream.seasonalityPreset ?? "none"]?.label ?? "None"}</span></span>
                  <span className="text-slate-500">Scenario <span className="font-bold text-slate-800 ml-1 capitalize">{stream.scenario ?? "base"}</span></span>
                </div>
                <p className="text-[9px] text-slate-400 mt-2">Applied to all items unless overridden below.</p>
              </div>
            ) : (
              /* Editable defaults */
              <div className="space-y-4 pt-1">
                {/* Scenario */}
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Scenario</p>
                  <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg w-fit">
                    {(["conservative", "base", "growth"] as const).map((sc) => (
                      <button key={sc}
                        onClick={() => {
                          const p = GROWTH_PRESETS[sc];
                          onUpdate({ ...stream, scenario: sc, volumeGrowthPct: p.volPct, annualPriceGrowthPct: p.pricePct, monthlyGrowthPct: effectiveMonthlyGrowth(p.volPct, p.pricePct) });
                        }}
                        className={`text-[10px] font-bold px-3 py-1 rounded-md capitalize transition-all ${stream.scenario === sc ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>
                        {GROWTH_PRESETS[sc].label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Vol + Price */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Volume Growth</p>
                    <div className="flex items-center gap-1.5">
                      <input type="number" min={0} max={30} step={0.1} value={stream.volumeGrowthPct}
                        onChange={(e) => { const v = parseFloat(e.target.value) || 0; onUpdate({ ...stream, volumeGrowthPct: v, monthlyGrowthPct: effectiveMonthlyGrowth(v, stream.annualPriceGrowthPct ?? 0) }); }}
                        className="w-16 text-sm font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400" />
                      <span className="text-xs text-slate-400">% / mo</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Price Increase</p>
                    <div className="flex items-center gap-1.5">
                      <input type="number" min={0} max={50} step={0.5} value={stream.annualPriceGrowthPct}
                        onChange={(e) => { const v = parseFloat(e.target.value) || 0; onUpdate({ ...stream, annualPriceGrowthPct: v, monthlyGrowthPct: effectiveMonthlyGrowth(stream.volumeGrowthPct ?? 0, v) }); }}
                        className="w-16 text-sm font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400" />
                      <span className="text-xs text-slate-400">% / yr</span>
                    </div>
                  </div>
                </div>

                {/* Seasonality */}
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Seasonality</p>
                  <select
                    value={stream.seasonalityPreset ?? "none"}
                    onChange={(e) => { const p = e.target.value as SeasonalityPreset; onUpdate({ ...stream, seasonalityPreset: p, seasonalityMultipliers: [...SEASONALITY_PRESETS[p].months] }); }}
                    className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:border-cyan-400 w-full max-w-xs">
                    {(Object.keys(SEASONALITY_PRESETS) as SeasonalityPreset[]).map((p) => (
                      <option key={p} value={p}>{SEASONALITY_PRESETS[p].label} — {SEASONALITY_PRESETS[p].desc}</option>
                    ))}
                  </select>
                  {/* Bar chart */}
                  <div className="mt-2.5">
                    <div className="flex items-end gap-px" style={{ height: 40 }}>
                      {stream.seasonalityMultipliers.map((v, mi) => {
                        const maxV = Math.max(...stream.seasonalityMultipliers, 1);
                        const barH = Math.max((v / maxV) * 100, 5);
                        return (
                          <div key={mi} className="flex-1 flex flex-col justify-end" style={{ height: 40 }} title={`${months12[mi]}: ${v.toFixed(2)}×`}>
                            <div className="w-full rounded-t-sm transition-all duration-300"
                              style={{ height: `${barH}%`, background: v >= 1 ? "#0e7490" : "#cbd5e1", opacity: 0.85 }} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-px mt-0.5">
                      {["J","F","M","A","M","J","J","A","S","O","N","D"].map((m, mi) => (
                        <div key={mi} className="flex-1 text-center"><span className="text-[7px] text-slate-300">{m}</span></div>
                      ))}
                    </div>
                  </div>
                  {/* Custom sliders */}
                  {(stream.seasonalityPreset ?? "none") === "custom" && (
                    <div className="space-y-1.5 mt-2.5 p-3 bg-slate-50 rounded-xl">
                      {stream.seasonalityMultipliers.map((v, mi) => (
                        <div key={mi} className="flex items-center gap-2">
                          <span className="text-[9px] text-slate-400 w-7 text-right shrink-0">{months12[mi]}</span>
                          <input type="range" min={0} max={3} step={0.05} value={v}
                            onChange={(e) => { const m2 = [...stream.seasonalityMultipliers]; m2[mi] = parseFloat(e.target.value); onUpdate({ ...stream, seasonalityMultipliers: m2 }); }}
                            className="flex-1 h-1 appearance-none cursor-pointer rounded-full" style={{ accentColor: "#0e7490" }} />
                          <span className="text-[9px] font-bold text-slate-600 w-8 text-right shrink-0">{v.toFixed(2)}×</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ─────── § 2  Rule Composer ─────── */}
          <section>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              {editingId ? "Edit Rule" : "Create Override Rule"}
            </p>

            <div className="bg-slate-50 rounded-xl p-4 space-y-4">
              {/* Apply To row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-500 shrink-0">Apply to</span>
                <div className="flex items-center gap-0.5 bg-white border border-slate-200 p-0.5 rounded-lg">
                  {(["category", "item"] as const).map((sc) => (
                    <button key={sc} onClick={() => switchScope(sc)}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-md capitalize transition-all ${b.scope === sc ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-600"}`}>
                      {sc}
                    </button>
                  ))}
                </div>
                <select value={b.targetId} onChange={(e) => setB({ targetId: e.target.value })}
                  className="text-xs font-semibold border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:border-cyan-400">
                  <option value="">— select {b.scope} —</option>
                  {targetOptions.map((opt) => (
                    <option key={opt.id} value={opt.id} disabled={usedTargets.has(opt.id)}>
                      {opt.name}{usedTargets.has(opt.id) ? " (rule exists)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {b.targetId ? (
                <>
                  {/* Growth + Price */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Growth / mo</p>
                      <div className="flex items-center gap-1.5">
                        <input type="number" min={-10} max={30} step={0.1}
                          placeholder={`${stream.volumeGrowthPct ?? 0} (base)`}
                          value={b.volPct}
                          onChange={(e) => setB({ volPct: e.target.value })}
                          className="w-20 text-sm font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-400 placeholder:text-slate-300 placeholder:font-normal placeholder:text-[10px]" />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Price / yr</p>
                      <div className="flex items-center gap-1.5">
                        <input type="number" min={-10} max={50} step={0.5}
                          placeholder={`${stream.annualPriceGrowthPct ?? 0} (base)`}
                          value={b.pricePct}
                          onChange={(e) => setB({ pricePct: e.target.value })}
                          className="w-20 text-sm font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-400 placeholder:text-slate-300 placeholder:font-normal placeholder:text-[10px]" />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </div>
                  </div>

                  {/* Seasonality */}
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Seasonality</p>
                    <select value={b.seasonality}
                      onChange={(e) => {
                        const val = e.target.value as SeasonalityPreset | "";
                        const mults = val === "custom"
                          ? (Array(12).fill(1) as number[])
                          : val ? [...SEASONALITY_PRESETS[val].months] : (Array(12).fill(1) as number[]);
                        setB({ seasonality: val, customMults: mults });
                      }}
                      className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:border-cyan-400">
                      <option value="">— use base —</option>
                      {(Object.keys(SEASONALITY_PRESETS) as SeasonalityPreset[]).map((p) => (
                        <option key={p} value={p}>{SEASONALITY_PRESETS[p].label}</option>
                      ))}
                    </select>

                    {/* Bar preview — shown whenever a preset is selected */}
                    {b.seasonality && (() => {
                      const mults = b.seasonality === "custom" ? b.customMults : SEASONALITY_PRESETS[b.seasonality]?.months ?? Array(12).fill(1) as number[];
                      const maxV = Math.max(...mults, 1);
                      return (
                        <div className="mt-2">
                          <div className="flex items-end gap-px" style={{ height: 28 }}>
                            {mults.map((v, mi) => (
                              <div key={mi} className="flex-1 flex flex-col justify-end" style={{ height: 28 }}
                                title={`${months12[mi]}: ${v.toFixed(2)}×`}>
                                <div className="w-full rounded-t-sm transition-all duration-300"
                                  style={{ height: `${Math.max((v / maxV) * 100, 5)}%`, background: v >= 1 ? "#0e7490" : "#cbd5e1", opacity: 0.85 }} />
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-px mt-0.5">
                            {["J","F","M","A","M","J","J","A","S","O","N","D"].map((m, mi) => (
                              <div key={mi} className="flex-1 text-center">
                                <span className="text-[7px] text-slate-300">{m}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Lifecycle */}
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Lifecycle (months)</p>
                    <div className="flex items-center gap-1.5">
                      <input type="number" min={1} max={240} placeholder="start"
                        value={b.launch}
                        onChange={(e) => setB({ launch: e.target.value })}
                        className="w-16 text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:border-cyan-400 placeholder:text-slate-300" />
                      <span className="text-slate-300 text-xs">→</span>
                      <input type="number" min={1} max={240} placeholder="end"
                        value={b.sunset}
                        onChange={(e) => setB({ sunset: e.target.value })}
                        className="w-16 text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:border-cyan-400 placeholder:text-slate-300" />
                    </div>
                    <p className="text-[9px] text-slate-300 mt-1">Blank = always active</p>
                  </div>

                  {/* Custom seasonality sliders for the builder */}
                  {b.seasonality === "custom" && (
                    <div className="space-y-1.5 p-3 bg-white rounded-xl border border-slate-200">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Custom Monthly Pattern</p>
                      {b.customMults.map((v, mi) => (
                        <div key={mi} className="flex items-center gap-2">
                          <span className="text-[9px] text-slate-400 w-7 text-right shrink-0">{months12[mi]}</span>
                          <input type="range" min={0} max={20} step={0.1} value={v}
                            onChange={(e) => {
                              const m2 = [...b.customMults]; m2[mi] = parseFloat(e.target.value); setB({ customMults: m2 });
                            }}
                            className="flex-1 h-1 appearance-none cursor-pointer rounded-full" style={{ accentColor: "#0e7490" }} />
                          <span className="text-[9px] font-bold text-slate-600 w-8 text-right shrink-0">{v.toFixed(2)}×</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[10px] text-slate-400">Leave blank to use base assumptions.</p>
                    <div className="flex items-center gap-2">
                      {editingId && (
                        <button onClick={cancelEdit} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Cancel</button>
                      )}
                      <button onClick={commitRule}
                        className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white rounded-lg transition-all hover:opacity-90"
                        style={{ background: "#0e7490" }}>
                        <Check className="w-3.5 h-3.5" />
                        {editingId ? "Update Rule" : "Add Rule"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400 py-1">
                  {categories.length === 0 && stream.items.length === 0
                    ? "Add items to the stream first, then create overrides here."
                    : `Select a ${b.scope} above to configure the override.`}
                </p>
              )}
            </div>
          </section>

          {/* ─────── § 3  Active Rules ─────── */}
          {overrides.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Active Overrides</p>
                <span className="text-[9px] font-bold text-white bg-cyan-500 px-1.5 py-0.5 rounded-full">{overrides.length}</span>
              </div>

              <div className="space-y-1.5">
                {overrides.map((ovr) => (
                  <div key={ovr.id}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl transition-all ${
                      editingId === ovr.id ? "bg-cyan-50 ring-1 ring-cyan-200" : "bg-slate-50 hover:bg-slate-100"
                    }`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                        ovr.scope === "category" ? "bg-cyan-100 text-cyan-700" : "bg-violet-100 text-violet-700"
                      }`}>
                        {ovr.scope === "category" ? "Category" : "Item"}
                      </span>
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-800">{ovr.targetName}</span>
                        <span className="text-[10px] text-slate-400 ml-2 truncate">{describeRule(ovr)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-3">
                      <button onClick={() => startEdit(ovr)}
                        className={`p-1.5 rounded-lg transition-colors ${editingId === ovr.id ? "text-cyan-600 bg-cyan-100" : "text-slate-300 hover:text-slate-600 hover:bg-slate-200"}`}>
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button onClick={() => deleteRule(ovr.id)}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-7 py-4 border-t border-slate-100 flex justify-end">
          <button onClick={onClose}
            className="px-6 py-2 text-sm font-bold text-white rounded-xl transition-all hover:opacity-90"
            style={{ background: "#0e7490" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ ItemTable ══ */
function ItemTable({ stream, onUpdate, onApplySeasonalityToAll, fmt, currencySymbol }: { stream: RevenueStream; onUpdate: (s: RevenueStream) => void; onApplySeasonalityToAll?: (preset: SeasonalityPreset, mults: number[]) => void; fmt: (n: number) => string; currencySymbol: string }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

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
    <>
    {showAdvanced && (
      <AdvancedGrowthModal
        stream={stream}
        onUpdate={onUpdate}
        onClose={() => setShowAdvanced(false)}
      />
    )}
    <div className="space-y-3">
      {/* ── Growth Logic card ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Growth Logic</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Rates compound monthly and scale revenue across the projection.</p>
          </div>
          {/* Scenario selector */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
            {(["conservative", "base", "growth"] as const).map((sc) => (
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
        <p className="text-[10px] text-slate-400 italic">{stream.scenario !== "custom" ? GROWTH_PRESETS[stream.scenario].desc : "Custom growth inputs"}</p>

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
            <span className="text-[10px] font-bold" style={{ color: "#0e7490" }}>
              +{stream.monthlyGrowthPct.toFixed(2)}% / month
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${CONF_STYLE[stream.scenario !== "custom" ? GROWTH_PRESETS[stream.scenario].confidence : "medium"]}`}>
              {stream.scenario !== "custom" && GROWTH_PRESETS[stream.scenario].confidence === "high" ? "High" : stream.scenario !== "custom" && GROWTH_PRESETS[stream.scenario].confidence === "low" ? "Low" : "Medium"} Confidence
            </span>
            <span className="text-[9px] text-slate-300">Forecast reliability</span>
          </div>
        </div>

        {/* ── Seasonality (compact) ── */}
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Seasonality</p>
            <select
              value={stream.seasonalityPreset ?? "none"}
              onChange={(e) => {
                const preset = e.target.value as SeasonalityPreset;
                onUpdate({ ...stream, seasonalityPreset: preset, seasonalityMultipliers: [...SEASONALITY_PRESETS[preset].months] });
              }}
              className="text-[10px] border border-slate-200 rounded-lg px-2 py-1 text-slate-700 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/20">
              {(Object.keys(SEASONALITY_PRESETS) as SeasonalityPreset[]).map((p) => (
                <option key={p} value={p}>{SEASONALITY_PRESETS[p].label}</option>
              ))}
            </select>
          </div>

          {/* Bar preview — always visible */}
          <div>
            <div className="flex items-end gap-px" style={{ height: 32 }}>
              {stream.seasonalityMultipliers.map((v, mi) => {
                const maxV = Math.max(...stream.seasonalityMultipliers, 1);
                const barH = Math.max((v / maxV) * 100, 5);
                return (
                  <div key={mi} className="flex-1 flex flex-col justify-end" style={{ height: 32 }}
                    title={`${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][mi]}: ${v.toFixed(2)}×`}>
                    <div className="w-full rounded-t-sm transition-all duration-300"
                      style={{ height: `${barH}%`, background: v >= 1 ? "#0e7490" : "#cbd5e1", opacity: 0.85 }} />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-px mt-0.5">
              {["J","F","M","A","M","J","J","A","S","O","N","D"].map((m, mi) => (
                <div key={mi} className="flex-1 text-center">
                  <span className="text-[7px] text-slate-300 font-medium">{m}</span>
                </div>
              ))}
            </div>
          </div>

          {(stream.seasonalityPreset ?? "none") === "custom" ? (
            <div className="space-y-1.5 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Custom Monthly Multipliers</p>
                {onApplySeasonalityToAll && (
                  <button
                    onClick={() => onApplySeasonalityToAll("custom", stream.seasonalityMultipliers)}
                    className="flex items-center gap-1 text-[9px] font-bold text-cyan-600 hover:text-cyan-700 transition-colors">
                    <RefreshCw className="w-2.5 h-2.5" />
                    Apply to all streams
                  </button>
                )}
              </div>
              {stream.seasonalityMultipliers.map((v, mi) => (
                <div key={mi} className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-400 w-7 text-right shrink-0">
                    {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][mi]}
                  </span>
                  <input type="range" min={0} max={20} step={0.1} value={v}
                    onChange={(e) => {
                      const m2 = [...stream.seasonalityMultipliers];
                      m2[mi] = parseFloat(e.target.value);
                      onUpdate({ ...stream, seasonalityMultipliers: m2 });
                    }}
                    className="flex-1 h-1 appearance-none cursor-pointer rounded-full"
                    style={{ accentColor: "#0e7490" }} />
                  <span className="text-[9px] font-bold text-slate-600 w-10 text-right shrink-0">{v.toFixed(2)}×</span>
                </div>
              ))}
            </div>
          ) : (stream.seasonalityPreset ?? "none") !== "none" && (
            <p className="text-[10px] text-slate-400 italic leading-relaxed">
              {SEASONALITY_PRESETS[stream.seasonalityPreset ?? "none"]?.desc}
            </p>
          )}
        </div>

        {/* ── Expansion Events ── */}
        <div className="border-t border-slate-100 pt-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Expansion Events</p>
              <div className="group relative inline-block">
                <Info className="w-3 h-3 text-slate-300 cursor-help" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 text-[10px] text-slate-600 bg-white border border-slate-100 rounded-lg px-2.5 py-2 shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none z-20 leading-relaxed">
                  Model a future event that increases capacity from a specific month — e.g. new branch, new product category, or new distributor.
                </div>
              </div>
            </div>
            {/* Toggle */}
            <button
              role="switch"
              aria-checked={stream.expansionMonth !== null}
              onClick={() => onUpdate({ ...stream, expansionMonth: stream.expansionMonth !== null ? null : 12 })}
              className={`relative inline-flex w-10 h-[22px] rounded-full transition-colors duration-200 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                stream.expansionMonth !== null ? "bg-cyan-500" : "bg-slate-200"
              }`}>
              <span className={`absolute top-[3px] left-[3px] w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                stream.expansionMonth !== null ? "translate-x-[18px]" : "translate-x-0"
              }`} />
            </button>
          </div>

          {stream.expansionMonth !== null && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">Starting month</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={1} max={120}
                      value={(stream.expansionMonth ?? 12) + 1}
                      onChange={(e) => onUpdate({ ...stream, expansionMonth: Math.max(0, Number(e.target.value) - 1) })}
                      className="w-16 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400" />
                    <span className="text-[10px] text-slate-400">of projection</span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">Revenue boost</label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">+</span>
                    <input type="number" min={5} max={900} step={5}
                      value={Math.round(((stream.expansionMultiplier ?? 1.5) - 1) * 100)}
                      onChange={(e) => onUpdate({ ...stream, expansionMultiplier: 1 + Math.max(0.05, Number(e.target.value)) / 100 })}
                      className="w-16 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400" />
                    <span className="text-[10px] text-slate-400">%</span>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-emerald-600">
                Revenue jumps to <span className="font-bold">{Math.round((stream.expansionMultiplier ?? 1.5) * 100)}%</span> of its trend from month {(stream.expansionMonth ?? 12) + 1} onward.
              </p>
            </>
          )}
        </div>

        {/* Advanced Overrides premium card */}
        <div className="border-t border-slate-100 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-slate-700">Advanced Overrides</p>
              {(stream.overrides ?? []).length > 0 ? (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {(stream.overrides ?? []).length} active rule{(stream.overrides ?? []).length !== 1 ? "s" : ""}
                </p>
              ) : (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Configure item or category-specific growth, pricing, and seasonality rules.
                </p>
              )}
            </div>
            <button
              onClick={() => setShowAdvanced(true)}
              className="flex items-center gap-1.5 text-[10px] font-bold text-cyan-600 hover:text-cyan-700 border border-cyan-200 hover:border-cyan-300 bg-cyan-50 hover:bg-cyan-100 px-3 py-1.5 rounded-lg transition-all shrink-0">
              Item &amp; Category Overrides
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {/* Active rules list */}
          {(stream.overrides ?? []).length > 0 && (
            <ul className="mt-2.5 space-y-1.5">
              {(stream.overrides ?? []).map((ovr) => (
                <li key={ovr.id} className="flex items-start gap-2 text-[10px]">
                  <span className="mt-[3px] w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                  <span>
                    <span className="font-semibold text-slate-700">
                      {ovr.scope === "category" ? "Category: " : ""}{ovr.targetName}
                    </span>
                    <span className="text-slate-400 ml-1">→ {describeOverrideRule(ovr)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
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
                <th className="px-2 py-2.5 text-xs font-semibold text-slate-500 text-center">Season</th>
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
                      <td colSpan={5} className="px-3 py-1.5">
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
                <td colSpan={5} className="px-3 py-2.5 text-xs font-bold text-slate-700">Stream Total</td>
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
        className="flex items-center gap-2 text-xs font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 hover:bg-cyan-100 px-3 py-2 rounded-lg transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add Item
      </button>
    </div>
    </>
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

/* ═══════════════════════════════════════ ActualsChat ══ */
function ActualsChat({ stream, onActualsSaved }: {
  stream: RevenueStream;
  onActualsSaved: (streamId: string, actuals: ActualMonth[], msgs: ChatMessage[]) => Promise<void>;
}) {
  const [mode,        setMode]        = useState<"paste" | "chat">("paste");
  const [raw,         setRaw]         = useState("");
  const [msgs,        setMsgs]        = useState<ChatMessage[]>([]);
  const [input,       setInput]       = useState("");
  const [typing,      setTyping]      = useState(false);
  const [error,       setError]       = useState("");
  const [done,        setDone]        = useState(false);
  const [micActive,   setMicActive]   = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const chatInitRef     = useRef(false);
  const endRef          = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef  = useRef<any>(null);
  const cachedVoiceRef  = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) resolveVoice(cachedVoiceRef);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing]);

  // Initialise chat on demand — only when user switches to chat mode
  useEffect(() => {
    if (mode === "chat" && msgs.length === 0 && !typing && !chatInitRef.current) {
      chatInitRef.current = true;
      callActuals([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const callActuals = async (history: ChatMessage[]) => {
    setTyping(true); setError("");
    try {
      const res = await fetch("/api/actuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, streamName: stream.name }),
      });
      const data = await res.json() as { text?: string; error?: string };
      if (data.error) throw new Error(data.error);
      const text = data.text ?? "";
      const actuals = parseActuals(text);
      if (actuals) {
        const cleanText = text.slice(0, text.indexOf("[ACTUALS_DETECTED]")).trim() ||
          `I've captured ${actuals.length} months of actual revenue for ${stream.name}.`;
        const newMsgs = [...history, { role: "assistant" as const, content: cleanText }];
        setMsgs(newMsgs);
        setDone(true);
        onActualsSaved(stream.id, actuals, newMsgs).catch(
          (e) => console.error("[ActualsChat] save error:", e)
        );
      } else {
        setMsgs([...history, { role: "assistant" as const, content: text }]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setTyping(false); }
  };

  const processPaste = async () => {
    if (!raw.trim()) return;
    setTyping(true); setError("");
    const prompt = `Here is my monthly revenue data for "${stream.name}". Extract all months:\n\n${raw}`;
    const history: ChatMessage[] = [{ role: "user", content: prompt }];
    try {
      const res = await fetch("/api/actuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, streamName: stream.name }),
      });
      const data = await res.json() as { text?: string; error?: string };
      if (data.error) throw new Error(data.error);
      const text = data.text ?? "";
      const actuals = parseActuals(text);
      if (actuals) {
        setDone(true);
        onActualsSaved(stream.id, actuals, history).catch(
          (e) => console.error("[ActualsChat] save error:", e)
        );
      } else {
        setError("AI could not detect monthly revenue. Try one month per line — e.g. \"2025-01 | 45000\".");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setTyping(false); }
  };

  const send = () => {
    const text = input.trim();
    if (!text || typing) return;
    const updated = [...msgs, { role: "user" as const, content: text }];
    setMsgs(updated); setInput("");
    callActuals(updated);
  };

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

  const toggleMic = () => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (micActive) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setMicActive(false);
      sendRef.current();
      return;
    }
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true;
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
    rec.start(); recognitionRef.current = rec; setMicActive(true);
  };
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; });

  return (
    <div className="flex flex-col gap-3">

      {/* Mode tabs — hidden once done */}
      {!done && (
        <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
          {([
            { id: "paste" as const, label: "Paste Data",  icon: Clipboard    },
            { id: "chat"  as const, label: "AI Guided",   icon: BrainCircuit },
          ]).map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => { setMode(id); setError(""); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                mode === id
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}>
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Done banner */}
      {done && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <p className="text-xs font-semibold text-emerald-700">
            Actuals captured! Continue to Revenue Drivers below to define your pricing model.
          </p>
        </div>
      )}

      {/* ── Paste mode ── */}
      {mode === "paste" && !done && (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2">
            <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wide">How to paste actuals</p>
            <p className="text-[11px] text-emerald-700 leading-relaxed">
              Copy your monthly revenue from a spreadsheet, accounting report, or any source and paste below. The AI reads any format.
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-0.5">
              {[
                "2025-01 | 45,000",
                "Jan 2025 — 45 000",
                "January: $45,000",
                "45000 (Jan)",
              ].map((ex) => (
                <div key={ex} className="flex items-center gap-1.5">
                  <span className="text-emerald-400 text-[10px] flex-shrink-0">→</span>
                  <span className="text-[10px] text-emerald-800 font-mono">{ex}</span>
                </div>
              ))}
            </div>
          </div>

          <textarea
            rows={8}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={`Paste monthly revenue here — any format:\n\n2025-01 | 45,000\n2025-02 | 52,000\n2025-03 | 48,500\n\nOr copy directly from Excel / Google Sheets.`}
            className="w-full resize-none px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all placeholder:text-slate-400 font-mono leading-relaxed"
          />

          {raw.trim() && (
            <p className="text-[11px] text-slate-400 pl-1">
              {raw.trim().split("\n").filter(l => l.trim()).length} line{raw.trim().split("\n").filter(l => l.trim()).length !== 1 ? "s" : ""} ready to extract
            </p>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
          )}

          <button onClick={processPaste} disabled={!raw.trim() || typing}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#059669,#10b981)" }}>
            {typing ? (
              <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg> Extracting actuals…</>
            ) : (
              <><BrainCircuit className="w-4 h-4" /> Extract Actuals with AI</>
            )}
          </button>
        </div>
      )}

      {/* ── Chat mode ── */}
      {mode === "chat" && (
        <>
          <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3 overflow-y-auto" style={{ maxHeight: 280 }}>
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
                    style={{ background: "linear-gradient(135deg,#064e3b,#059669)" }}>
                    <BarChart3 className="w-3 h-3 text-white" />
                  </div>
                )}
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                  m.role === "user"
                    ? "text-white rounded-tr-sm"
                    : "bg-slate-50 border border-slate-100 text-slate-800 rounded-tl-sm"
                }`} style={m.role === "user" ? { background: "linear-gradient(135deg,#059669,#10b981)" } : {}}>
                  {cleanAI(m.content)}
                </div>
                {m.role === "assistant" && (
                  <button onClick={() => speakMsg(m.content, i)}
                    className={`ml-1.5 mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 self-start transition-all ${
                      speakingIdx === i ? "text-emerald-600 bg-emerald-50" : "text-slate-300 hover:text-emerald-500 hover:bg-slate-50"
                    }`}>
                    <Volume2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {typing && (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#064e3b,#059669)" }}>
                  <BarChart3 className="w-3 h-3 text-white" />
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
                <button onClick={() => callActuals(msgs)} className="ml-auto font-semibold underline">Retry</button>
              </div>
            )}
            <div ref={endRef} />
          </div>
          {!done && (
            <div className="flex items-end gap-2">
              <motion.button whileTap={{ scale: 0.95 }} onClick={toggleMic}
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
                  micActive
                    ? "bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse"
                    : "border border-slate-200 text-slate-400 hover:border-emerald-400 hover:text-emerald-600 bg-white"
                }`}>
                {micActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </motion.button>
              <textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                disabled={typing}
                placeholder={micActive ? "Listening… tap mic to stop & send" : "Enter your monthly revenue data… (Enter to send)"}
                className={`flex-1 resize-none px-4 py-2.5 border rounded-xl text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 transition-all placeholder:text-slate-300 disabled:opacity-60 ${
                  micActive ? "border-red-300 focus:border-red-400 focus:ring-red-400/20"
                            : "border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/20"
                }`} />
              <motion.button whileTap={{ scale: 0.95 }} onClick={send} disabled={!input.trim() || typing}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#059669,#10b981)" }}>
                <Send className="w-4 h-4" />
              </motion.button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════ UnifiedJourneyChat ══
   One continuous dialog: Intake → (Actuals if existing) → Drivers
   for every stream, in sequence. Parent receives callbacks for each
   detection event. No separate step changes needed.
══════════════════════════════════════════════════════════════ */
type JPhaseKind = "intake" | "actuals" | "drivers" | "expenses" | "bizprofile";
interface JPhase { kind: JPhaseKind; streamIdx?: number; }
type DItem =
  | { id: number; t: "msg"; role: "user" | "assistant"; content: string }
  | { id: number; t: "div"; text: string; color: "slate" | "emerald" | "cyan" };

function UnifiedJourneyChat({
  situation, appId, userId,
  onStreamsDetected, onActualsSaved, onItemsCollected,
  onForecastYears, onForecastStart, onComplete,
}: {
  situation:         string | null;
  appId:             string | null;
  userId:            string | null;
  onStreamsDetected:  (streams: RevenueStream[], ctx: string) => void;
  onActualsSaved:     (streamId: string, actuals: ActualMonth[], msgs: ChatMessage[]) => Promise<void>;
  onItemsCollected:   (streamId: string, items: StreamItem[], msgs: ChatMessage[]) => Promise<void>;
  onForecastYears:    (y: number) => void;
  onForecastStart:    (year: number, month: number) => void;
  onComplete:         () => void;
  // callbacks handled internally — expenses and bizprofile saved directly from component
}) {
  // ── Refs: phase state (avoid stale closures) ─────────────────────────────
  const queueRef     = useRef<JPhase[]>([{ kind: "intake" }]);
  const idxRef       = useRef(0);
  const streamsRef   = useRef<RevenueStream[]>([]);
  const phMsgsRef    = useRef<ChatMessage[]>([]);
  const intakeCtxRef = useRef("");
  const msgIdRef     = useRef(0);
  const sendRef      = useRef<() => void>(() => {});

  // ── Display state ─────────────────────────────────────────────────────────
  const [items,     setItems]     = useState<DItem[]>([]);
  const [typing,    setTyping]    = useState(false);
  const [error,     setError]     = useState("");
  const [input,     setInput]     = useState("");
  const [isDone,    setIsDone]    = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [speakIdx,  setSpeakIdx]  = useState<number | null>(null);
  const endRef         = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const voiceRef       = useRef<SpeechSynthesisVoice | null>(null);

  const nid     = () => ++msgIdRef.current;
  const pushMsg = (role: "user" | "assistant", content: string) =>
    setItems(prev => [...prev, { id: nid(), t: "msg", role, content }]);
  const pushDiv = (text: string, color: "slate" | "emerald" | "cyan") =>
    setItems(prev => [...prev, { id: nid(), t: "div", text, color }]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) resolveVoice(voiceRef);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [items, typing]);
  // Auto-start intake on mount
  useEffect(() => { runPhase([]); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Core dispatcher ───────────────────────────────────────────────────────
  async function runPhase(history: ChatMessage[]) {
    const phase = queueRef.current[idxRef.current];
    if (!phase) return;
    setTyping(true); setError("");
    try {
      if (phase.kind === "intake")     await doIntake(history);
      if (phase.kind === "actuals")    await doActuals(history, phase.streamIdx!);
      if (phase.kind === "drivers")    await doDrivers(history, phase.streamIdx!);
      if (phase.kind === "expenses")   await doExpenses(history);
      if (phase.kind === "bizprofile") await doBizProfile(history);
    } catch (e) { setError(e instanceof Error ? e.message : "Connection error"); }
    finally     { setTyping(false); }
  }

  // ── Intake ────────────────────────────────────────────────────────────────
  async function doIntake(history: ChatMessage[]) {
    const res  = await fetch("/api/intake", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, situation }),
    });
    const data = await res.json() as { text?: string; error?: string };
    if (data.error) throw new Error(data.error);
    const text     = data.text ?? "";
    const detected = parseStreams(text);
    if (detected) {
      const clean = text.slice(0, text.indexOf("[STREAMS_DETECTED]")).trim() ||
        `I've mapped ${detected.length} revenue stream${detected.length !== 1 ? "s" : ""}. Let me now collect the data for each one.`;
      pushMsg("assistant", clean);
      const allMsgs = [...history, { role: "assistant" as const, content: clean }];
      intakeCtxRef.current = allMsgs.map(m => `${m.role}: ${m.content}`).join("\n");

      // DB save — merge DB UUIDs back into local RevenueStream objects
      let saved: RevenueStream[] = detected;
      if (appId && userId) {
        try {
          const sb = createClient();
          const dbStreams = await saveStreams(sb, appId, userId, detected.map((s, i) => ({
            name: s.name, type: s.type, confidence: s.confidence,
            monthly_growth_pct: s.monthlyGrowthPct, sub_new_per_month: s.subNewPerMonth,
            sub_churn_pct: s.subChurnPct, rental_occupancy_pct: s.rentalOccupancyPct,
            driver_done: s.driverDone, position: i,
          })));
          // Apply real DB UUIDs to the local stream objects
          saved = detected.map((s, i) => ({ ...s, id: dbStreams[i]?.id ?? s.id }));
          const nm = detected.map(s => s.name).slice(0, 2).join(" & ")
            + (detected.length > 2 ? ` +${detected.length - 2}` : "");
          await saveIntakeConversation(sb, appId, userId, allMsgs, null, true);
          await updateApplicationFlags(sb, appId, { intake_done: true, name: nm });
        } catch (e) { console.error("[unified] intake save:", e); }
      }
      streamsRef.current = saved;
      onStreamsDetected(saved, intakeCtxRef.current);

      // Build queue: intake → [actuals? → drivers] per stream → expenses → bizprofile
      const q: JPhase[] = [{ kind: "intake" }];
      saved.forEach((_, i) => {
        if (situation === "existing") q.push({ kind: "actuals", streamIdx: i });
        q.push({ kind: "drivers", streamIdx: i });
      });
      q.push({ kind: "expenses" });
      q.push({ kind: "bizprofile" });
      queueRef.current = q;
      advance(q, 1, saved);
    } else {
      pushMsg("assistant", text);
      phMsgsRef.current = [...history, { role: "assistant" as const, content: text }];
    }
  }

  // ── Actuals ───────────────────────────────────────────────────────────────
  async function doActuals(history: ChatMessage[], si: number) {
    const stream = streamsRef.current[si];
    const res  = await fetch("/api/actuals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, streamName: stream.name }),
    });
    const data = await res.json() as { text?: string; error?: string };
    if (data.error) throw new Error(data.error);
    const text    = data.text ?? "";
    const actuals = parseActuals(text);
    if (actuals) {
      const clean = text.slice(0, text.indexOf("[ACTUALS_DETECTED]")).trim() ||
        `Actuals captured — ${actuals.length} months for ${stream.name}.`;
      pushMsg("assistant", clean);
      await onActualsSaved(stream.id, actuals, []).catch(e => console.error("[unified] actuals save:", e));
      advance(queueRef.current, idxRef.current + 1, streamsRef.current);
    } else {
      pushMsg("assistant", text);
      phMsgsRef.current = [...history, { role: "assistant" as const, content: text }];
    }
  }

  // ── Drivers ───────────────────────────────────────────────────────────────
  async function doDrivers(history: ChatMessage[], si: number) {
    const stream  = streamsRef.current[si];
    const queue   = queueRef.current;
    const isFirst = queue.findIndex(p => p.kind === "drivers") === idxRef.current;
    const res  = await fetch("/api/drivers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history,
        stream: { name: stream.name, type: stream.type },
        situation, isFirstStream: isFirst,
        intakeContext: intakeCtxRef.current,
      }),
    });
    const data  = await res.json() as { text?: string; error?: string };
    if (data.error) throw new Error(data.error);
    const text  = data.text ?? "";
    const itms  = parseItems(text);
    if (itms) {
      const clean = text.slice(0, text.indexOf("[ITEMS_DETECTED]")).trim() ||
        `${itms.length} item${itms.length !== 1 ? "s" : ""} captured for ${stream.name}.`;
      pushMsg("assistant", clean);
      const fy = parseForecastYears(text);
      const fs = parseForecastStart(text);
      if (fy) onForecastYears(fy);
      if (fs) onForecastStart(fs.year, fs.month);
      const msgs = [...history, { role: "assistant" as const, content: clean }];
      await onItemsCollected(stream.id, itms, msgs).catch(e => console.error("[unified] items save:", e));
      advance(queue, idxRef.current + 1, streamsRef.current);
    } else {
      pushMsg("assistant", text);
      phMsgsRef.current = [...history, { role: "assistant" as const, content: text }];
    }
  }

  // ── Expenses ──────────────────────────────────────────────────────────────
  async function doExpenses(history: ChatMessage[]) {
    const res  = await fetch("/api/expenses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, intakeContext: intakeCtxRef.current }),
    });
    const data = await res.json() as { text?: string; error?: string };
    if (data.error) throw new Error(data.error);
    const text = data.text ?? "";
    const tag  = "[EXPENSES_DETECTED]";
    const tagIdx = text.indexOf(tag);
    if (tagIdx !== -1) {
      const clean = text.slice(0, tagIdx).trim() || "Operating expenses captured.";
      pushMsg("assistant", clean);
      try {
        const jsonStr = text.slice(tagIdx + tag.length).trim();
        const expenses = JSON.parse(jsonStr) as { category: string; monthly_amount: number; note?: string }[];
        if (appId && userId) {
          const sb = createClient();
          await saveOperatingExpenses(sb, appId, userId, expenses);
        }
      } catch (e) { console.error("[unified] expenses parse/save:", e); }
      advance(queueRef.current, idxRef.current + 1, streamsRef.current);
    } else {
      pushMsg("assistant", text);
      phMsgsRef.current = [...history, { role: "assistant" as const, content: text }];
    }
  }

  // ── Business Profile ──────────────────────────────────────────────────────
  async function doBizProfile(history: ChatMessage[]) {
    const res  = await fetch("/api/bizprofile", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, situation, intakeContext: intakeCtxRef.current }),
    });
    const data = await res.json() as { text?: string; error?: string };
    if (data.error) throw new Error(data.error);
    const text = data.text ?? "";
    const tag  = "[BIZPROFILE_DETECTED]";
    const tagIdx = text.indexOf(tag);
    if (tagIdx !== -1) {
      const clean = text.slice(0, tagIdx).trim() || "Business profile captured.";
      pushMsg("assistant", clean);
      try {
        const jsonStr = text.slice(tagIdx + tag.length).trim();
        const profile = JSON.parse(jsonStr) as Omit<DbBusinessProfile, "id" | "application_id" | "user_id" | "created_at" | "updated_at">;
        if (appId && userId) {
          const sb = createClient();
          await saveBusinessProfile(sb, appId, userId, profile);
        }
      } catch (e) { console.error("[unified] bizprofile parse/save:", e); }
      // Done — all phases complete
      pushDiv("✓ All data collected — generating your financial forecast…", "emerald");
      setIsDone(true);
      setTimeout(onComplete, 900);
    } else {
      pushMsg("assistant", text);
      phMsgsRef.current = [...history, { role: "assistant" as const, content: text }];
    }
  }

  // ── Advance to next phase ─────────────────────────────────────────────────
  function advance(queue: JPhase[], nextIdx: number, streams: RevenueStream[]) {
    const next   = queue[nextIdx];
    const stream = next?.streamIdx !== undefined ? streams[next.streamIdx] : null;
    if (next?.kind === "actuals" && stream)
      pushDiv(`Historical actuals — ${stream.name}`, "emerald");
    else if (next?.kind === "drivers" && stream)
      pushDiv(`Revenue drivers — ${stream.name}`, "cyan");
    else if (next?.kind === "expenses")
      pushDiv("Operating expenses", "slate");
    else if (next?.kind === "bizprofile")
      pushDiv("Business profile & loan details", "slate");
    else if (!next) {
      // queue exhausted (should not happen — bizprofile is always last)
      pushDiv("✓ All data collected — generating your financial forecast…", "emerald");
      setIsDone(true);
      setTimeout(onComplete, 900);
      return;
    }
    idxRef.current    = nextIdx;
    phMsgsRef.current = [];
    setTimeout(() => runPhase([]), 500);
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = () => {
    const text = input.trim();
    if (!text || typing || isDone) return;
    pushMsg("user", text);
    const next = [...phMsgsRef.current, { role: "user" as const, content: text }];
    phMsgsRef.current = next;
    setInput("");
    runPhase(next);
  };
  useEffect(() => { sendRef.current = send; });

  // ── Speak ─────────────────────────────────────────────────────────────────
  const speakMsg = async (text: string, idx: number) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speakIdx === idx) { window.speechSynthesis.cancel(); setSpeakIdx(null); return; }
    window.speechSynthesis.cancel();
    const voice = await resolveVoice(voiceRef);
    const utt = new SpeechSynthesisUtterance(text);
    if (voice) utt.voice = voice;
    utt.lang = "en-US"; utt.rate = 1.0;
    utt.onend = () => setSpeakIdx(null); utt.onerror = () => setSpeakIdx(null);
    setSpeakIdx(idx); window.speechSynthesis.speak(utt);
  };

  // ── Mic ───────────────────────────────────────────────────────────────────
  const toggleMic = () => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (micActive) {
      recognitionRef.current?.stop(); recognitionRef.current = null;
      setMicActive(false); sendRef.current(); return;
    }
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++)
        if (e.results[i].isFinal) final += (e.results[i][0]?.transcript as string) ?? "";
      if (final) setInput(prev => prev ? prev.trimEnd() + " " + final.trim() : final.trim());
    };
    rec.onerror = () => { recognitionRef.current = null; setMicActive(false); };
    rec.onend   = () => { if (recognitionRef.current) { recognitionRef.current = null; setMicActive(false); } };
    rec.start(); recognitionRef.current = rec; setMicActive(true);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-3 bg-white rounded-2xl border border-slate-100 p-4"
        style={{ minHeight: 320, maxHeight: "calc(100vh - 320px)" }}>
        {items.map(item => {
          if (item.t === "div") return (
            <div key={item.id} className="flex items-center gap-2 py-1.5">
              <div className={`flex-1 h-px ${
                item.color === "emerald" ? "bg-emerald-100"
                : item.color === "cyan"    ? "bg-cyan-100"
                :                           "bg-slate-100"}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider whitespace-nowrap px-2 ${
                item.color === "emerald" ? "text-emerald-500"
                : item.color === "cyan"    ? "text-cyan-500"
                :                           "text-slate-400"}`}>
                {item.text}
              </span>
              <div className={`flex-1 h-px ${
                item.color === "emerald" ? "bg-emerald-100"
                : item.color === "cyan"    ? "bg-cyan-100"
                :                           "bg-slate-100"}`} />
            </div>
          );
          return (
            <div key={item.id} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
              {item.role === "assistant" && (
                <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
                  style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                  <BrainCircuit className="w-3.5 h-3.5 text-white" />
                </div>
              )}
              <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                item.role === "user"
                  ? "text-white rounded-tr-sm"
                  : "bg-white border border-slate-100 text-slate-800 rounded-tl-sm shadow-sm"
              }`} style={item.role === "user" ? { background: "linear-gradient(135deg,#0e7490,#0891b2)" } : {}}>
                {cleanAI(item.content)}
              </div>
              {item.role === "assistant" && (
                <button onClick={() => speakMsg(item.content, item.id)}
                  className={`ml-1.5 mt-1 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 self-start transition-all ${
                    speakIdx === item.id ? "text-cyan-600 bg-cyan-50" : "text-slate-300 hover:text-cyan-500 hover:bg-slate-50"
                  }`}>
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {typing && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
              <BrainCircuit className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-slate-300"
                    animate={{ y: [0,-4,0] }} transition={{ duration: 0.6, repeat: Infinity, delay: i*0.15 }} />
                ))}
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-center gap-2">
            <span>⚠ {error}</span>
            <button onClick={() => runPhase(phMsgsRef.current)} className="ml-auto font-semibold underline">Retry</button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      {!isDone && (
        <div className="flex items-end gap-2">
          <motion.button whileTap={{ scale: 0.95 }} onClick={toggleMic}
            className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all ${
              micActive
                ? "bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse"
                : "border border-slate-200 text-slate-400 hover:border-cyan-400 hover:text-cyan-600 bg-white"
            }`}>
            {micActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </motion.button>
          <textarea rows={2} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={typing}
            placeholder={micActive ? "Listening… tap mic to stop & send" : "Answer, or paste your data directly here…"}
            className={`flex-1 resize-none px-4 py-3 border rounded-2xl text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 transition-all placeholder:text-slate-300 disabled:opacity-60 ${
              micActive ? "border-red-300 focus:ring-red-400/20" : "border-slate-200 focus:border-cyan-500 focus:ring-cyan-500/20"
            }`} />
          <motion.button whileTap={{ scale: 0.95 }} onClick={send} disabled={!input.trim() || typing}
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-md disabled:opacity-40 flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
            <Send className="w-4 h-4" />
          </motion.button>
        </div>
      )}
      <p className="text-[11px] text-slate-300 text-center">Shift+Enter for new line · Enter to send · Or paste data directly</p>
    </div>
  );
}

/* ═══════════════════════════════════════ ImportPane ══ */
function ImportPane({ stream, onUpdate }: { stream: RevenueStream; onUpdate: (s: RevenueStream) => void }) {
  const [raw,     setRaw]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

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
        setError("AI could not detect items. Try re-formatting your data — each item on its own line works best.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">

      {/* How-to instructions */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">How to use this panel</p>
        <ol className="space-y-2.5">
          {[
            {
              step: "1",
              title: "Open your data source",
              body: "Open the spreadsheet, price list, or report where your product or sales data lives — Excel, Google Sheets, a CSV export, or any structured list.",
            },
            {
              step: "2",
              title: "Select and copy the rows",
              body: "Highlight the rows you want (Ctrl+C on Windows, Cmd+C on Mac). You don't need headers — raw rows are fine. The AI reads messy data.",
            },
            {
              step: "3",
              title: "Paste below",
              body: "Click inside the text box below and paste (Ctrl+V / Cmd+V). Then hit \"Extract & Clean with AI\" — the AI will identify every item, group them by category, and fill in volume and price.",
            },
          ].map(({ step, title, body }) => (
            <li key={step} className="flex gap-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 mt-0.5"
                style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                {step}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-700">{title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{body}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* What the AI can read */}
        <div className="border-t border-slate-200 pt-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">What the AI can read</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {[
              "Product name + price + quantity",
              "Invoice or receipt lines",
              "Google Sheets / Excel rows",
              "CSV or tab-separated exports",
              "POS or sales report exports",
              "Price lists or catalogues",
              "Any structured text format",
              "Column headers optional",
            ].map((t) => (
              <div key={t} className="flex items-start gap-1.5">
                <span className="text-emerald-500 text-[10px] mt-0.5 flex-shrink-0">✓</span>
                <span className="text-[11px] text-slate-600">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Paste area */}
      <textarea rows={7} value={raw} onChange={(e) => setRaw(e.target.value)}
        placeholder={`Paste your data here — examples of what works:\n\nInterior White 4L | 120 units/month | $18.50\nPrimer 20L, 45/mo, $32\nBrush Set — 80 per month @ $6\nRoofing Sheets: 200 sheets, $14 each\n\nOr paste a full spreadsheet block, invoice lines, or any list.`}
        className="w-full resize-none px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all placeholder:text-slate-400 font-mono leading-relaxed" />

      {raw.trim() && (
        <p className="text-[11px] text-slate-400 pl-1">
          {raw.trim().split("\n").filter(l => l.trim()).length} line{raw.trim().split("\n").filter(l => l.trim()).length !== 1 ? "s" : ""} ready to extract
        </p>
      )}

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>}

      <button onClick={processImport} disabled={!raw.trim() || loading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
        {loading ? (
          <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg> AI is extracting &amp; grouping items…</>
        ) : (
          <><BrainCircuit className="w-4 h-4" /> Extract &amp; Clean with AI</>
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
  onStartChange,
  currency,
  onEditDrivers,
  actuals,
}: {
  streams:          RevenueStream[];
  onUpdateStream:   (s: RevenueStream) => void;
  horizonYears:     number;
  onHorizonChange?: (years: number) => void;
  startYear:        number;
  startMonth:       number;
  onStartChange?:   (year: number, month: number) => void;
  currency:         string | null;
  onEditDrivers?:   () => void;
  actuals?:         ActualMonth[];   // historical revenue for "existing" businesses
}) {
  const fmt = makeFmt(currency);
  const [view,           setView]           = useState<"annual" | "monthly" | "sensitivity">("annual");
  const [selectedYear,   setSelectedYear]   = useState(1);
  const [expandedStreams, setExpandedStreams] = useState<Set<string>>(new Set());
  // -1 = rolling Year 1/2/… grouping (default); 0–11 = financial year ending that calendar month
  const [fyEndMonth, setFyEndMonth] = useState<number>(-1);

  // Inline driver editing in the assumptions table
  const [inlineEdit, setInlineEdit] = useState<{
    id: string; field: "vol" | "price" | "seas"; val: string;
  } | null>(null);
  const inlineSb = useRef(createClient()).current;

  /** Apply an inline edit: update local stream state + persist to DB immediately */
  const saveInlineEdit = useCallback((
    streamId: string,
    patch: { volumeGrowthPct?: number; annualPriceGrowthPct?: number; seasonalityPreset?: SeasonalityPreset; seasonalityMultipliers?: number[] },
  ) => {
    const stream = streams.find((s) => s.id === streamId);
    if (!stream) return;
    const newVol   = patch.volumeGrowthPct      ?? stream.volumeGrowthPct;
    const newPrice = patch.annualPriceGrowthPct  ?? stream.annualPriceGrowthPct;
    const monthly  = effectiveMonthlyGrowth(newVol, newPrice);
    onUpdateStream({ ...stream, ...patch, monthlyGrowthPct: monthly, scenario: "custom" as GrowthScenario });
    const dbPatch: Parameters<typeof updateStreamDb>[2] = {
      volume_growth_pct:       newVol,
      annual_price_growth_pct: newPrice,
      monthly_growth_pct:      monthly,
    };
    if (patch.seasonalityPreset      !== undefined) dbPatch.seasonality_preset      = patch.seasonalityPreset;
    if (patch.seasonalityMultipliers !== undefined) dbPatch.seasonality_multipliers = patch.seasonalityMultipliers;
    updateStreamDb(inlineSb, streamId, dbPatch).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streams, onUpdateStream, inlineSb]);

  // Saved-drivers snapshot — populated synchronously from the streams prop so the
  // button is visible on the very first render (no useEffect delay / "only after refresh").
  // Also updated whenever new custom streams appear after mount (e.g. engine finishes).
  type DriverSnap = { volumeGrowthPct: number; annualPriceGrowthPct: number; monthlyGrowthPct: number };

  const buildSnapshot = (src: RevenueStream[]): Map<string, DriverSnap> => {
    const map = new Map<string, DriverSnap>();
    // Use rate-based classification — s.scenario may lag behind engine-written DB rates
    src.filter(s => effectiveScenario(s.volumeGrowthPct, s.annualPriceGrowthPct) === "custom").forEach(s => {
      map.set(s.id, {
        volumeGrowthPct:      s.volumeGrowthPct      ?? 0,
        annualPriceGrowthPct: s.annualPriceGrowthPct ?? 0,
        monthlyGrowthPct:     s.monthlyGrowthPct,
      });
    });
    return map;
  };

  // Lazy initializer runs synchronously at mount — reads streams prop as-is.
  const [savedDriversSnapshot, setSavedDriversSnapshot] = useState<Map<string, DriverSnap>>(
    () => buildSnapshot(streams),
  );

  // Keep the snapshot up-to-date when streams change after mount (engine update, inline edit, etc.)
  useEffect(() => {
    const customStreams = streams.filter(s => effectiveScenario(s.volumeGrowthPct, s.annualPriceGrowthPct) === "custom");
    if (customStreams.length === 0) return;
    setSavedDriversSnapshot(prev => {
      const next = new Map(prev);
      customStreams.forEach(s => {
        next.set(s.id, {
          volumeGrowthPct:      s.volumeGrowthPct      ?? 0,
          annualPriceGrowthPct: s.annualPriceGrowthPct ?? 0,
          monthlyGrowthPct:     s.monthlyGrowthPct,
        });
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streams]);

  const restoreSavedDrivers = () => {
    streams.forEach(s => {
      const snap = savedDriversSnapshot.get(s.id);
      if (snap) {
        onUpdateStream({ ...s, ...snap, scenario: "custom" });
      }
    });
  };

  const MONTH_NAMES      = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const MONTH_NAMES_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const startDate = new Date(startYear, startMonth, 1);

  // Rolling: always exactly N×12 months (always complete).
  // FY mode: extend past N×12 so the last FY period ends on its natural month boundary.
  //   e.g. start=Oct, FY ends Dec, 3 years → 27 months (Oct 2026 – Dec 2028, 3 full FYs).
  const totalMths = (() => {
    if (fyEndMonth < 0) return horizonYears * 12;
    // Which FY does the very first projection month belong to?
    const fyYearFirst = startMonth <= fyEndMonth ? startYear : startYear + 1;
    // The N-th FY ends at fyEndMonth in (fyYearFirst + N - 1)
    const lastFyEndYear = fyYearFirst + horizonYears - 1;
    return Math.max((lastFyEndYear - startYear) * 12 + (fyEndMonth - startMonth) + 1, 1);
  })();

  const projection = projectRevenue(streams, totalMths, startDate);

  // Group into annual periods — rolling or by financial year
  const years = fyEndMonth < 0
    ? groupByYear(projection)
    : groupByFY(projection, fyEndMonth, startYear, startMonth);

  // Label helpers — "Year 1" vs "FY 2026"
  const yearLabel      = (y: typeof years[0]) => fyEndMonth >= 0 && "fyYear" in y ? `FY ${y.fyYear}` : `Year ${y.year}`;
  const yearLabelShort = (y: typeof years[0]) => fyEndMonth >= 0 && "fyYear" in y ? `FY${(y as {fyYear:number}).fyYear}` : `Yr ${y.year}`;
  const grandTotal = years.reduce((a, y) => a + y.total, 0);
  const totalMRR   = streams.reduce((a, s) => a + streamMRR(s), 0);
  const totalItems = streams.reduce((a, s) => a + s.items.length, 0);

  const cagr = years.length > 1 && (years[0]?.total ?? 0) > 0
    ? ((Math.pow(years[years.length - 1].total / years[0].total, 1 / (years.length - 1)) - 1) * 100)
    : null;

  // Dominant scenario — derived from RATES (effectiveScenario), not s.scenario.
  // s.scenario is set by the UI preset buttons and may lag behind engine-extracted rates
  // written to DB. effectiveScenario() classifies purely from vol/price which is always current.
  const scenarioCounts = streams.reduce((acc, s) => {
    const sc = effectiveScenario(s.volumeGrowthPct, s.annualPriceGrowthPct);
    acc[sc] = (acc[sc] ?? 0) + 1;
    return acc;
  }, {} as Partial<Record<GrowthScenario, number>>);
  const dominantScenario: GrowthScenario =
    (scenarioCounts["custom"] ?? 0) > 0
      ? "custom"
      : (scenarioCounts["growth"] ?? 0) > 0 && (scenarioCounts["growth"] ?? 0) >= (scenarioCounts["base"] ?? 0) && (scenarioCounts["growth"] ?? 0) >= (scenarioCounts["conservative"] ?? 0)
        ? "growth"
        : (scenarioCounts["base"] ?? 0) > 0 && (scenarioCounts["base"] ?? 0) >= (scenarioCounts["conservative"] ?? 0)
          ? "base"
          : "conservative";

  // Applying a global preset removes "custom" status — rates are overwritten with preset values
  const applyGlobalScenario = (sc: Exclude<GrowthScenario, "custom">) => {
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
            {(["conservative", "base", "growth"] as const).map((sc) => {
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
          {savedDriversSnapshot.size > 0 && (
            <button
              onClick={() => { if (dominantScenario !== "custom") restoreSavedDrivers(); }}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-all shrink-0 ${
                dominantScenario === "custom"
                  ? "bg-violet-500 text-white shadow-sm cursor-default"
                  : "bg-violet-50 text-violet-500 border border-violet-200 hover:bg-violet-100 cursor-pointer"
              }`}
            >
              Saved Drivers
            </button>
          )}
          <span className="text-[10px] text-slate-400 italic hidden sm:block">
            {dominantScenario === "custom" ? "Driver-defined rates · each stream" : `${GROWTH_PRESETS[dominantScenario].desc} · all streams`}
          </span>
        </div>
        {/* Row 2: Start date + horizon + view toggle */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-xs text-slate-500">Starting</span>
            {/* Month picker */}
            <select
              value={startMonth}
              onChange={(e) => onStartChange?.(startYear, Number(e.target.value))}
              className="text-xs font-semibold text-slate-700 bg-slate-100 border-0 rounded-md px-2 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-500 appearance-none pr-5"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 4px center" }}
            >
              {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            {/* Year picker */}
            <select
              value={startYear}
              onChange={(e) => onStartChange?.(Number(e.target.value), startMonth)}
              className="text-xs font-semibold text-slate-700 bg-slate-100 border-0 rounded-md px-2 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-500 appearance-none pr-5"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 4px center" }}
            >
              {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <span className="text-xs text-slate-300">·</span>
            <span className="text-xs text-slate-500">Horizon</span>
            <select
              value={horizonYears}
              onChange={(e) => onHorizonChange?.(Number(e.target.value))}
              className="text-xs font-semibold text-slate-700 bg-slate-100 border-0 rounded-md px-2 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-500 appearance-none pr-5"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 4px center" }}
            >
              {[1,2,3,4,5,6,7,8,9,10,12,15,20,25,30].map((y) => (
                <option key={y} value={y}>{y} {y === 1 ? "year" : "years"}</option>
              ))}
            </select>
            <span className="text-xs text-slate-300">·</span>
            <span className="text-xs text-slate-500">FY ends</span>
            <select
              value={fyEndMonth}
              onChange={(e) => { setFyEndMonth(Number(e.target.value)); setSelectedYear(1); }}
              className="text-xs font-semibold text-slate-700 bg-slate-100 border-0 rounded-md px-2 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-500 appearance-none pr-5"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 4px center" }}
            >
              <option value={-1}>Rolling (Yr 1, 2…)</option>
              {MONTH_NAMES.map((m, i) => (
                <option key={i} value={i}>{m}</option>
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
          { label: fyEndMonth >= 0 && "fyYear" in (years[0] ?? {}) ? `${yearLabel(years[0])} Revenue` : "First-Year Revenue",
            val: fmt(years[0]?.total ?? 0),
            sub: fyEndMonth >= 0 ? `${years[0]?.startLabel ?? ""} – ${years[0]?.endLabel ?? ""}` : "Months 1 – 12" },
          { label: fyEndMonth >= 0 && "fyYear" in (years[years.length-1] ?? {}) ? `${yearLabel(years[years.length-1])} Revenue` : "Final-Year Revenue",
            val: fmt(years[years.length - 1]?.total ?? 0),
            sub: fyEndMonth >= 0 ? `${years[years.length-1]?.startLabel ?? ""} – ${years[years.length-1]?.endLabel ?? ""}` : `Year ${horizonYears}` },
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
          { label: "Streams",    val: `${streams.length} stream${streams.length !== 1 ? "s" : ""}` },
          { label: "Items",      val: `${totalItems} item${totalItems !== 1 ? "s" : ""}` },
          { label: "Currency",   val: currency ?? "—" },
          { label: "Scenario",   val: dominantScenario === "custom" ? "Saved Drivers" : GROWTH_PRESETS[dominantScenario].label, highlight: dominantScenario === "growth" ? "emerald" : dominantScenario === "conservative" ? "amber" : dominantScenario === "custom" ? "violet" : "cyan" },
          { label: "FY Year End", val: fyEndMonth >= 0 ? `${MONTH_NAMES_FULL[fyEndMonth]} · ${MONTH_NAMES[(fyEndMonth + 1) % 12]} – ${MONTH_NAMES[fyEndMonth]}` : "Rolling" },
        ].map(({ label, val, highlight }, i) => (
          <div key={label} className={`flex items-center gap-1.5 ${i > 0 ? "sm:border-l sm:border-slate-200 sm:pl-5" : ""}`}>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</span>
            <span className={`text-[11px] font-bold ${highlight === "emerald" ? "text-emerald-600" : highlight === "amber" ? "text-amber-600" : highlight === "cyan" ? "text-cyan-700" : highlight === "violet" ? "text-violet-700" : "text-slate-700"}`}>{val}</span>
          </div>
        ))}
      </div>

      {/* ── Actuals + Forecast combined chart (existing business only) ── */}
      {actuals && actuals.length > 0 && (() => {
        // Build combined timeline: actuals (emerald) + forecast (cyan)
        // actuals sorted oldest→newest; forecast starts at startYear/startMonth
        const sortedActuals = [...actuals].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
        const forecastMonths = projection.slice(0, Math.min(projection.length, 24)); // cap at 24 for readability

        // For the combined chart, show up to 12 months of actuals + up to 12 months of forecast
        const showActuals  = sortedActuals.slice(-12);
        const showForecast = forecastMonths.slice(0, 12);

        const allValues = [
          ...showActuals.map((a) => a.total),
          ...showForecast.map((m) => m.total),
        ];
        const maxVal = Math.max(...allValues, 1);

        const totalActualsRev    = showActuals.reduce((a, m) => a + m.total, 0);
        const totalForecastRev   = showForecast.reduce((a, m) => a + m.total, 0);
        const avgActual          = showActuals.length > 0 ? totalActualsRev / showActuals.length : 0;
        const avgForecast        = showForecast.length > 0 ? totalForecastRev / showForecast.length : 0;
        const growthVsActual     = avgActual > 0 ? ((avgForecast - avgActual) / avgActual) * 100 : null;

        // Short month label from "YYYY-MM"
        const shortLabel = (ym: string) => {
          const [y, m] = ym.split("-").map(Number);
          return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(m - 1) % 12]} ${String(y).slice(2)}`;
        };

        return (
          <div className="bg-white rounded-2xl border border-slate-100 px-5 pt-4 pb-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Actuals + Forecast</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Historical revenue (emerald) → projected growth (cyan)</p>
              </div>
              <div className="flex items-center gap-3">
                {growthVsActual !== null && (
                  <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 border ${
                    growthVsActual >= 0
                      ? "bg-cyan-50 border-cyan-100"
                      : "bg-red-50 border-red-100"
                  }`}>
                    <TrendingUp className={`w-3 h-3 ${growthVsActual >= 0 ? "text-cyan-600" : "text-red-500"}`} />
                    <span className={`text-[10px] font-bold ${growthVsActual >= 0 ? "text-cyan-700" : "text-red-600"}`}>
                      {growthVsActual >= 0 ? "+" : ""}{growthVsActual.toFixed(1)}% vs actuals avg
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "#059669" }} />
                    <span className="text-[10px] text-slate-500">Actual</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "#0e7490" }} />
                    <span className="text-[10px] text-slate-500">Forecast</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Combined bar chart */}
            <div className="flex items-end gap-1" style={{ height: 80 }}>
              {/* Actuals bars */}
              {showActuals.map((a, i) => {
                const pct = maxVal > 0 ? (a.total / maxVal) * 100 : 4;
                return (
                  <div key={`a-${i}`} className="flex-1 h-full flex flex-col items-stretch min-w-0" title={`${shortLabel(a.yearMonth)}: ${fmt(a.total)}`}>
                    <div className="flex-1 flex items-end">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(pct, 3)}%` }}
                        transition={{ duration: 0.5, delay: i * 0.04, ease: EASE }}
                        className="w-full rounded-t"
                        style={{ background: "#059669", opacity: 0.85, minHeight: 4 }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Divider — "Today" */}
              <div className="w-px self-stretch bg-slate-300 relative flex-shrink-0 mx-0.5" style={{ minWidth: 1 }}>
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-slate-400 whitespace-nowrap">Now</span>
              </div>

              {/* Forecast bars */}
              {showForecast.map((m, i) => {
                const pct = maxVal > 0 ? (m.total / maxVal) * 100 : 4;
                return (
                  <div key={`f-${i}`} className="flex-1 h-full flex flex-col items-stretch min-w-0" title={`${m.yearMonth}: ${fmt(m.total)}`}>
                    <div className="flex-1 flex items-end">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(pct, 3)}%` }}
                        transition={{ duration: 0.5, delay: (showActuals.length + i) * 0.04, ease: EASE }}
                        className="w-full rounded-t"
                        style={{ background: "linear-gradient(180deg,#0891b2,#0e7490)", opacity: 0.82, minHeight: 4 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Axis labels — show only first, middle, divider, and last */}
            <div className="flex items-center gap-1 mt-1.5">
              {showActuals.length > 0 && (
                <>
                  <span className="text-[9px] text-slate-400 shrink-0">{shortLabel(showActuals[0].yearMonth)}</span>
                  <div className="flex-1" />
                  <span className="text-[9px] text-slate-400 shrink-0">{shortLabel(showActuals[showActuals.length - 1].yearMonth)}</span>
                </>
              )}
              <div className="w-px mx-1 self-stretch bg-transparent" />
              {showForecast.length > 0 && (
                <>
                  <span className="text-[9px] text-cyan-500 shrink-0">{showForecast[0].yearMonth}</span>
                  <div className="flex-1" />
                  <span className="text-[9px] text-cyan-500 shrink-0">{showForecast[showForecast.length - 1].yearMonth}</span>
                </>
              )}
            </div>

            {/* KPI summary row */}
            <div className="flex gap-4 mt-3 pt-3 border-t border-slate-100 flex-wrap">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Avg Monthly (Actual)</p>
                <p className="text-xs font-bold text-emerald-700">{fmt(avgActual)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Avg Monthly (Forecast)</p>
                <p className="text-xs font-bold text-cyan-700">{fmt(avgForecast)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Actuals Period</p>
                <p className="text-xs font-bold text-slate-700">{showActuals.length} months</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Actual Total</p>
                <p className="text-xs font-bold text-slate-700">{fmt(totalActualsRev)}</p>
              </div>
            </div>
          </div>
        );
      })()}

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
                      <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap">{yearLabelShort(y)}</span>
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

      {/* ── Assumptions Strip (read-only summary) ── */}
      {(() => {
        const allSame = streams.length > 0 && streams.every(
          (s) => (s.seasonalityPreset ?? "none") === (streams[0].seasonalityPreset ?? "none")
        );
        const seasonLabel = streams.length === 0
          ? "None"
          : allSame
            ? (SEASONALITY_PRESETS[streams[0].seasonalityPreset ?? "none"]?.label ?? "None")
            : "Mixed";
        const anyExpansion = streams.some((s) => s.expansionMonth !== null);
        // Average vol/price across streams (or first stream if only one)
        const avgVol   = streams.length ? streams.reduce((a, s) => a + (s.volumeGrowthPct ?? 0), 0) / streams.length : 0;
        const avgPrice = streams.length ? streams.reduce((a, s) => a + (s.annualPriceGrowthPct ?? 0), 0) / streams.length : 0;
        return (
          <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                dominantScenario === "conservative"
                  ? "bg-amber-100 text-amber-700"
                  : dominantScenario === "growth"
                    ? "bg-emerald-100 text-emerald-700"
                    : dominantScenario === "custom"
                      ? "bg-violet-100 text-violet-700"
                      : "bg-cyan-100 text-cyan-700"
              }`}>{dominantScenario === "custom" ? "Saved Drivers" : `${GROWTH_PRESETS[dominantScenario].label} Case`}</span>

              <span className="text-[10px] text-slate-400 hidden sm:inline">|</span>
              <span className="text-[10px] text-slate-500">
                Vol <span className="font-semibold text-slate-700">+{avgVol.toFixed(2)}%/mo</span>
              </span>
              <span className="text-[10px] text-slate-500">
                Price <span className="font-semibold text-slate-700">+{avgPrice.toFixed(1)}%/yr</span>
              </span>
              <span className="text-[10px] text-slate-500">
                Seasonality <span className="font-semibold text-slate-700">{seasonLabel}</span>
              </span>
              {anyExpansion && (
                <span className="text-[10px] text-emerald-600 font-semibold">+ Expansion</span>
              )}
              <span className="text-[10px] text-slate-400 hidden sm:inline">|</span>
              <span className="text-[10px] text-slate-500">
                Start <span className="font-semibold text-slate-700">{MONTH_NAMES[startMonth]} {startYear}</span>
              </span>
            </div>
            {onEditDrivers && (
              <button onClick={onEditDrivers}
                className="flex items-center gap-1.5 text-xs font-semibold text-cyan-700 bg-white border border-cyan-200 rounded-lg px-3 py-1.5 hover:bg-cyan-50 transition-colors shrink-0">
                <Edit3 className="w-3 h-3" /> Edit Drivers
              </button>
            )}
          </div>
        );
      })()}

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
                      {yearLabel(y)}<span className="block text-[9px] font-normal opacity-60">{y.startLabel} – {y.endLabel}</span>
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
                      {/* Item drilldown rows — read actual per-item revenue from projection */}
                      {isExpanded && s.items.map((it) => {
                        const getItemYearRev = (yr: typeof years[0]) =>
                          yr.months.reduce((sum, m) => {
                            const cat = m.byStream.find((b) => b.id === s.id)?.byCategory[it.category || "Other"];
                            return sum + (cat?.items.find((x) => x.id === it.id)?.rev ?? 0);
                          }, 0);
                        const itemGrand = years.reduce((sum, y) => sum + getItemYearRev(y), 0);
                        return (
                          <tr key={it.id} className="bg-slate-50/30 border-t border-slate-50">
                            <td className="pl-8 pr-3 py-2 text-[10px] text-slate-500 sticky left-0 bg-slate-50/30">
                              <span className="flex items-center gap-1.5">
                                <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                                {it.name}{it.category ? ` · ${it.category}` : ""}
                              </span>
                            </td>
                            {years.map((y, i) => (
                              <td key={i} className="px-3 py-2 text-right text-[10px] tabular-nums whitespace-nowrap text-slate-500">
                                {fmt(getItemYearRev(y))}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right text-[10px] tabular-nums text-slate-500 border-l border-slate-100">
                              {fmt(itemGrand)}
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
                {yearLabelShort(y)}
              </button>
            ))}
          </div>

          {selectedYearData && (
            <>
              <div className="px-4 py-2 flex items-center justify-between bg-slate-50/50">
                <p className="text-[10px] text-slate-400">
                  Monthly breakdown · {selectedYearData.months.length} months · {streams.length} revenue stream{streams.length !== 1 ? "s" : ""}
                </p>
                <p className="text-[10px] font-semibold text-slate-600">{yearLabel(selectedYearData)} total: <span style={{ color: "#0e7490" }}>{fmt(selectedYearData.total)}</span></p>
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
                        {selectedYearData ? yearLabelShort(selectedYearData) : `Yr ${selectedYear}`}
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
                          {/* Item drilldown rows — read actual per-item revenue from projection */}
                          {isExpanded && s.items.map((it) => {
                            const getItemMonthRev = (m: ProjMonth) => {
                              const cat = m.byStream.find((b) => b.id === s.id)?.byCategory[it.category || "Other"];
                              return cat?.items.find((x) => x.id === it.id)?.rev ?? 0;
                            };
                            const itemYearRev = selectedYearData.months.reduce((a, m) => a + getItemMonthRev(m), 0);
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
                                        {fmt(getItemMonthRev(m))}
                                      </td>
                                    ))}
                                    <td key={`${q.label}-itot`} className="px-3 py-1.5 text-right text-[10px] tabular-nums whitespace-nowrap text-slate-400 font-medium border-l border-slate-200 bg-slate-50/80">
                                      {fmt(q.months.reduce((a, m) => a + getItemMonthRev(m), 0))}
                                    </td>
                                  </>
                                ))}
                                <td className="px-3 py-1.5 text-right text-[10px] tabular-nums whitespace-nowrap text-slate-400 font-medium border-l border-slate-200">
                                  {fmt(itemYearRev)}
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
                  const adjYears = fyEndMonth < 0 ? groupByYear(adjProj) : groupByFY(adjProj, fyEndMonth, startYear, startMonth);
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

      {/* ── Model Assumptions & Forecast Summary ── */}
      {(() => {
        const endDate   = new Date(startYear, startMonth + horizonYears * 12 - 1, 1);
        const endLabel  = endDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        const startLabel = new Date(startYear, startMonth, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });

        // Per-stream projected totals for yr1 / final yr / total
        const streamTotals = streams.map((s) => ({
          ...s,
          projTotal: projection.reduce((a, m) => a + (m.byStream.find((b) => b.id === s.id)?.rev ?? 0), 0),
          yr1: years[0]?.months.reduce((a, m) => a + (m.byStream.find((b) => b.id === s.id)?.rev ?? 0), 0) ?? 0,
          yrN: years[years.length - 1]?.months.reduce((a, m) => a + (m.byStream.find((b) => b.id === s.id)?.rev ?? 0), 0) ?? 0,
        }));

        // Peak revenue month
        const peakMonth = projection.length > 0
          ? projection.reduce((mx, m) => m.total > mx.total ? m : mx, projection[0])
          : null;

        // First month where revenue ≥ 2× baseline
        const baseRev = projection[0]?.total ?? 0;
        const doublingMonth = baseRev > 0
          ? projection.find((m, idx) => idx > 0 && m.total >= baseRev * 2)
          : null;

        // Structural drivers
        const expansionStreams  = streams.filter((s) => s.expansionMonth !== null);
        const overrideStreams   = streams.filter((s) => (s.overrides ?? []).length > 0);
        const totalOverrides    = streams.reduce((a, s) => a + (s.overrides ?? []).length, 0);
        const customSeasonItems = streams.reduce((a, s) => a + s.items.filter((it) => it.seasonalityPreset).length, 0);
        const seasonalStreams   = streams.filter((s) => (s.seasonalityPreset ?? "none") !== "none");

        const Dot = ({ color }: { color: string }) => (
          <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 inline-block" style={{ background: color }} />
        );

        return (
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">

            {/* Header */}
            <div className="px-5 py-3.5" style={{ background: "#042f3d" }}>
              <p className="text-sm font-bold text-white uppercase tracking-wider">Model Assumptions &amp; Forecast Summary</p>
              <p className="text-xs text-slate-400 mt-0.5">All drivers, assumptions, and projected outcomes powering this model</p>
            </div>

            {/* ── Row 1: Parameters + Outlook ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
              <div className="px-5 py-4 space-y-2">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Forecast Parameters</p>
                {([
                  ["Period",    `${startLabel} → ${endLabel}`],
                  ["Horizon",   `${horizonYears} year${horizonYears !== 1 ? "s" : ""} · ${totalMths} months`],
                  ["Streams",   `${streams.length} revenue stream${streams.length !== 1 ? "s" : ""}`],
                  ["Items",     `${totalItems} revenue item${totalItems !== 1 ? "s" : ""}`],
                  ["Scenario",  dominantScenario === "custom" ? "Saved Drivers" : GROWTH_PRESETS[dominantScenario].label],
                  ["Currency",  currency ?? "—"],
                ] as [string, string][]).map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between gap-4">
                    <span className="text-[13px] text-slate-400">{label}</span>
                    <span className="text-[13px] font-semibold text-slate-700 text-right">{val}</span>
                  </div>
                ))}
              </div>
              <div className="px-5 py-4 space-y-2">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Growth Analytics</p>
                {(() => {
                  const baseRevM = projection[0]?.total ?? 0;
                  const doublingM = baseRevM > 0
                    ? projection.find((m, idx) => idx > 0 && m.total >= baseRevM * 2)
                    : null;
                  const yr1Total = years[0]?.total ?? 0;
                  const yrNTotal = years[years.length - 1]?.total ?? 0;
                  const finalVsYr1Pct = yr1Total > 0 ? Math.round((yrNTotal / yr1Total - 1) * 100) : null;
                  const rows: [string, string, string][] = [
                    ["CAGR", cagr !== null ? `${cagr >= 0 ? "+" : ""}${cagr.toFixed(1)}%` : "—", cagr !== null ? (cagr >= 0 ? "#059669" : "#e11d48") : ""],
                    ["Peak Month", peakMonth ? `${peakMonth.yearMonth} · ${fmt(peakMonth.total)}` : "—", ""],
                    ["Revenue Doubles", doublingM ? `${doublingM.yearMonth} (mo ${doublingM.index + 1})` : dominantScenario === "base" ? "Flat — no growth" : "Beyond horizon", doublingM ? "#059669" : "#94a3b8"],
                    ["Year 1 Avg/mo", fmt(Math.round(yr1Total / 12)), ""],
                    [`Yr ${horizonYears} vs Yr 1`, finalVsYr1Pct !== null ? `${finalVsYr1Pct >= 0 ? "+" : ""}${finalVsYr1Pct}%` : "—", finalVsYr1Pct !== null ? (finalVsYr1Pct >= 0 ? "#059669" : "#e11d48") : ""],
                  ];
                  return rows.map(([label, val, color]) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <span className="text-[13px] text-slate-400">{label}</span>
                      <span className="text-[13px] font-semibold text-right" style={{ color: color || "#1e293b" }}>{val}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* ── Row 2: Per-stream table ── */}
            <div className="border-t border-slate-100">
              <div className="px-5 py-2.5 bg-slate-50/60 flex items-center justify-between">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Stream Assumptions</p>
                <Link href="/dashboard/drivers" className="flex items-center gap-1 text-[11px] text-cyan-600 hover:text-cyan-800 font-medium transition-colors">
                  <Pencil size={11} /> Edit all drivers
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse" style={{ minWidth: 680 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {(["Stream","Scenario","Vol/mo ✎","Price/yr ✎","Eff. Rate","Seasonality ✎","Items","Mix %","Yr 1","Final Yr"] as const).map((h) => (
                        <th key={h} className={`px-3 py-2 text-xs font-bold whitespace-nowrap ${h === "Stream" ? "text-left text-slate-500" : h.includes("✎") ? "text-right text-cyan-600" : "text-right text-slate-500"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {streamTotals.map((s, si) => {
                      const pct    = grandTotal > 0 ? Math.round((s.projTotal / grandTotal) * 100) : 0;
                      const sCagr  = years.length > 1 && s.yr1 > 0 ? ((Math.pow(s.yrN / s.yr1, 1 / (years.length - 1)) - 1) * 100) : null;
                      const effSc  = effectiveScenario(s.volumeGrowthPct, s.annualPriceGrowthPct);
                      const scCol  = effSc === "growth" ? "#059669" : effSc === "conservative" ? "#b45309" : effSc === "custom" ? "#7c3aed" : "#0e7490";
                      const hasSeasOvr = (s.overrides ?? []).some((o) => o.seasonalityPreset);
                      const hasItemSeas = s.items.some((it) => it.seasonalityPreset);
                      return (
                        <tr key={s.id} className={si % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                          <td className="px-3 py-2.5 text-xs font-medium text-slate-700">
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: MIX_COLORS[si % MIX_COLORS.length] }} />
                              {s.name}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: scCol, background: `${scCol}18` }}>
                              {effSc === "custom" ? "Custom" : GROWTH_PRESETS[effSc as Exclude<GrowthScenario, "custom">].label}
                            </span>
                          </td>
                          {/* Vol/mo — inline editable */}
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                            {inlineEdit?.id === s.id && inlineEdit.field === "vol" ? (
                              <input
                                type="number" min={0} max={30} step={0.25}
                                value={inlineEdit.val}
                                autoFocus
                                onChange={(e) => setInlineEdit({ ...inlineEdit, val: e.target.value })}
                                onBlur={() => {
                                  const v = Math.max(0, Math.min(30, parseFloat(inlineEdit.val) || 0));
                                  saveInlineEdit(s.id, { volumeGrowthPct: v });
                                  setInlineEdit(null);
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setInlineEdit(null); }}
                                className="w-16 text-xs font-bold border border-cyan-400 rounded-md px-1.5 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-cyan-300 bg-cyan-50"
                              />
                            ) : (
                              <button
                                onClick={() => setInlineEdit({ id: s.id, field: "vol", val: String(s.volumeGrowthPct ?? 0) })}
                                className="text-slate-600 hover:text-cyan-600 hover:underline cursor-pointer transition-colors"
                                title="Click to edit"
                              >
                                {(s.volumeGrowthPct ?? 0) > 0 ? `+${s.volumeGrowthPct}%` : <span className="text-slate-300">+0%</span>}
                              </button>
                            )}
                          </td>
                          {/* Price/yr — inline editable */}
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                            {inlineEdit?.id === s.id && inlineEdit.field === "price" ? (
                              <input
                                type="number" min={0} max={50} step={0.5}
                                value={inlineEdit.val}
                                autoFocus
                                onChange={(e) => setInlineEdit({ ...inlineEdit, val: e.target.value })}
                                onBlur={() => {
                                  const v = Math.max(0, Math.min(50, parseFloat(inlineEdit.val) || 0));
                                  saveInlineEdit(s.id, { annualPriceGrowthPct: v });
                                  setInlineEdit(null);
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setInlineEdit(null); }}
                                className="w-16 text-xs font-bold border border-cyan-400 rounded-md px-1.5 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-cyan-300 bg-cyan-50"
                              />
                            ) : (
                              <button
                                onClick={() => setInlineEdit({ id: s.id, field: "price", val: String(s.annualPriceGrowthPct ?? 0) })}
                                className="text-slate-600 hover:text-cyan-600 hover:underline cursor-pointer transition-colors"
                                title="Click to edit"
                              >
                                {(s.annualPriceGrowthPct ?? 0) > 0 ? `+${s.annualPriceGrowthPct}%` : <span className="text-slate-300">+0%</span>}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums" style={{ color: s.monthlyGrowthPct > 0 ? "#059669" : "#64748b" }}>
                            {s.monthlyGrowthPct > 0 ? `+${s.monthlyGrowthPct.toFixed(2)}%/mo` : "Flat"}
                          </td>
                          {/* Seasonality — inline editable */}
                          <td className="px-3 py-2.5 text-right text-xs text-slate-500 relative">
                            {inlineEdit?.id === s.id && inlineEdit.field === "seas" ? (
                              <select
                                autoFocus
                                value={inlineEdit.val}
                                onChange={(e) => {
                                  const preset = e.target.value as SeasonalityPreset;
                                  const mults  = preset !== "custom" ? SEASONALITY_PRESETS[preset].months : s.seasonalityMultipliers;
                                  saveInlineEdit(s.id, { seasonalityPreset: preset, seasonalityMultipliers: mults });
                                  setInlineEdit(null);
                                }}
                                onBlur={() => setInlineEdit(null)}
                                className="text-xs border border-cyan-400 rounded-md px-1.5 py-0.5 focus:outline-none bg-white text-slate-700 max-w-[130px]"
                              >
                                {(Object.entries(SEASONALITY_PRESETS) as [SeasonalityPreset, { label: string }][]).map(([key, { label }]) => (
                                  <option key={key} value={key}>{label}</option>
                                ))}
                              </select>
                            ) : (
                              <button
                                onClick={() => setInlineEdit({ id: s.id, field: "seas", val: s.seasonalityPreset ?? "none" })}
                                className="hover:text-cyan-600 hover:underline cursor-pointer transition-colors"
                                title="Click to edit"
                              >
                                {SEASONALITY_PRESETS[s.seasonalityPreset ?? "none"]?.label ?? "None"}
                                {hasSeasOvr && <span className="text-[10px] text-cyan-500 ml-1">+ovr</span>}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">
                            {s.items.length}
                            {hasItemSeas && <span className="text-[10px] text-violet-500 ml-1">+S</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700 tabular-nums">{pct}%</td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{fmt(s.yr1)}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums">
                            <span style={{ color: s.yrN >= s.yr1 ? "#059669" : "#e11d48" }}>{fmt(s.yrN)}</span>
                            {sCagr !== null && (
                              <span className="text-[10px] text-slate-400 ml-1 font-normal">
                                {sCagr >= 0 ? "+" : ""}{sCagr.toFixed(0)}%
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Row 3: Structural Drivers + Milestones ── */}
            <div className="border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
              <div className="px-5 py-4">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Structural Drivers</p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2">
                    <Dot color="#0e7490" />
                    <span className="text-xs text-slate-600">
                      <span className="font-semibold">{totalItems} revenue items</span> across {streams.length} stream{streams.length !== 1 ? "s" : ""}
                    </span>
                  </li>
                  {expansionStreams.map((s) => (
                    <li key={s.id} className="flex items-start gap-2">
                      <Dot color="#059669" />
                      <span className="text-xs text-slate-600">
                        <span className="font-semibold">{s.name}</span> — expansion event from month {(s.expansionMonth ?? 0) + 1}{" "}
                        at +{Math.round(((s.expansionMultiplier ?? 1) - 1) * 100)}% capacity uplift
                      </span>
                    </li>
                  ))}
                  {totalOverrides > 0 && (
                    <li className="flex items-start gap-2">
                      <Dot color="#7c3aed" />
                      <span className="text-xs text-slate-600">
                        <span className="font-semibold">{totalOverrides} growth/seasonality override{totalOverrides !== 1 ? "s" : ""}</span>{" "}
                        across {overrideStreams.length} stream{overrideStreams.length !== 1 ? "s" : ""}
                      </span>
                    </li>
                  )}
                  {customSeasonItems > 0 && (
                    <li className="flex items-start gap-2">
                      <Dot color="#a78bfa" />
                      <span className="text-xs text-slate-600">
                        <span className="font-semibold">{customSeasonItems} item{customSeasonItems !== 1 ? "s" : ""}</span> with individual seasonality patterns
                      </span>
                    </li>
                  )}
                  {seasonalStreams.length > 0 && (
                    <li className="flex items-start gap-2">
                      <Dot color="#f59e0b" />
                      <span className="text-xs text-slate-600">
                        Seasonality on <span className="font-semibold">{seasonalStreams.length} stream{seasonalStreams.length !== 1 ? "s" : ""}</span>:{" "}
                        {seasonalStreams.map((s) => SEASONALITY_PRESETS[s.seasonalityPreset ?? "none"]?.label).join(", ")}
                      </span>
                    </li>
                  )}
                  {expansionStreams.length === 0 && totalOverrides === 0 && customSeasonItems === 0 && seasonalStreams.length === 0 && (
                    <li className="flex items-start gap-2">
                      <Dot color="#cbd5e1" />
                      <span className="text-xs text-slate-400">No structural overrides — pure volume × price model</span>
                    </li>
                  )}
                </ul>
              </div>
              <div className="px-5 py-4">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Key Milestones</p>
                <ul className="space-y-2">
                  {peakMonth && (
                    <li className="flex items-start gap-2">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-600">
                        <span className="font-semibold">Peak month:</span> {peakMonth.yearMonth} at {fmt(peakMonth.total)}/mo
                      </span>
                    </li>
                  )}
                  {doublingMonth ? (
                    <li className="flex items-start gap-2">
                      <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-600">
                        <span className="font-semibold">Revenue doubles</span> by {doublingMonth.yearMonth} (month {doublingMonth.index + 1})
                      </span>
                    </li>
                  ) : baseRev > 0 && dominantScenario === "base" && (
                    <li className="flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-400">Revenue stays flat — switch to Conservative or Growth to model upside</span>
                    </li>
                  )}
                  {cagr !== null && (
                    <li className="flex items-start gap-2">
                      <BarChart3 className="w-3.5 h-3.5 text-cyan-500 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-600">
                        <span className="font-semibold">CAGR {cagr >= 0 ? "+" : ""}{cagr.toFixed(1)}%</span> compounding over {horizonYears} year{horizonYears !== 1 ? "s" : ""}
                      </span>
                    </li>
                  )}
                  {years.length > 0 && years[0].total > 0 && (
                    <li className="flex items-start gap-2">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-600">
                        <span className="font-semibold">Year 1 avg:</span> {fmt(Math.round((years[0]?.total ?? 0) / 12))}/mo · {fmt(years[0]?.total ?? 0)} total
                      </span>
                    </li>
                  )}
                  {years.length > 1 && (years[0]?.total ?? 0) > 0 && (
                    <li className="flex items-start gap-2">
                      <ScrollText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-600">
                        <span className="font-semibold">Final year</span> is{" "}
                        {Math.abs(Math.round(((years[years.length - 1]?.total ?? 0) / (years[0]?.total ?? 1) - 1) * 100))}%{" "}
                        {(years[years.length - 1]?.total ?? 0) >= (years[0]?.total ?? 0) ? "above" : "below"} Year 1
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            </div>

            {/* ── Footer: model quality note ── */}
            <div className="border-t border-slate-100 px-5 py-3 bg-slate-50/50 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-slate-400 leading-relaxed">
                Projections are based on manually entered estimates. Actual outcomes depend on execution, market conditions, and input accuracy.
              </p>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-600 shrink-0 whitespace-nowrap">
                Medium Confidence
              </span>
            </div>

          </div>
        );
      })()}

    </div>
  );
}

/* ═══════════════════════════════════════ ApplyPage ══ */
function ApplyPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetAppId = searchParams.get("id");       // open a specific application
  const forceNew    = searchParams.get("new") === "1"; // always create a fresh one
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

  // Progress bar: 0=Setup, 1=Revenue Model (steps 0-2), 2=Forecast (step 3)
  const displayStep = !situationDone ? 0 : step <= 2 ? 1 : 2;

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
  const [streams,          setStreams]          = useState<RevenueStream[]>([]);
  const [streamIdx,        setStreamIdx]        = useState(0);
  // Per-stream mode memory: streamId → DriverMode. Absent = defaults to "chat".
  const [driverModes,      setDriverModes]      = useState<Record<string, DriverMode>>({});
  const [showStreamPicker, setShowStreamPicker] = useState(false);
  const [newStreamName,    setNewStreamName]    = useState("");

  // Actuals — keyed by stream ID; only populated for "existing" businesses
  const [actualsByStream,      setActualsByStream]      = useState<Record<string, ActualMonth[]>>({});
  // Tracks which streams have completed their actuals collection phase
  const [actualsPhaseByStream, setActualsPhaseByStream] = useState<Record<string, boolean>>({});

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
        // Growth — prefer decomposed columns (migration-008); fall back to combined rate for old records
        volumeGrowthPct:      s.volume_growth_pct       != null ? Number(s.volume_growth_pct)       : Number(s.monthly_growth_pct),
        annualPriceGrowthPct: s.annual_price_growth_pct != null ? Number(s.annual_price_growth_pct) : 0,
        monthlyGrowthPct:     Number(s.monthly_growth_pct),
        // Scenario: match a named preset only if exact; anything else → "custom"
        // (custom = engine-extracted rates, shown as-is, never overwritten by preset buttons)
        scenario: (() => {
          const volPct   = s.volume_growth_pct       != null ? Number(s.volume_growth_pct)       : Number(s.monthly_growth_pct);
          const pricePct = s.annual_price_growth_pct != null ? Number(s.annual_price_growth_pct) : 0;
          const r = effectiveMonthlyGrowth(volPct, pricePct);
          const cRate = effectiveMonthlyGrowth(GROWTH_PRESETS.conservative.volPct, GROWTH_PRESETS.conservative.pricePct);
          const gRate = effectiveMonthlyGrowth(GROWTH_PRESETS.growth.volPct,       GROWTH_PRESETS.growth.pricePct);
          if (r === 0)                          return "base"         as GrowthScenario;
          if (Math.abs(r - cRate) < 0.05)      return "conservative" as GrowthScenario;
          if (Math.abs(r - gRate) < 0.1)       return "growth"       as GrowthScenario;
          return "custom" as GrowthScenario;   // engine-defined custom rate
        })(),
        subNewPerMonth:      Number(s.sub_new_per_month),
        subChurnPct:         Number(s.sub_churn_pct),
        rentalOccupancyPct:  Number(s.rental_occupancy_pct),
        seasonalityPreset:      (s.seasonality_preset ?? "none") as SeasonalityPreset,
        seasonalityMultipliers: (s.seasonality_multipliers as number[] | null)
          ?? SEASONALITY_PRESETS[(s.seasonality_preset ?? "none") as SeasonalityPreset]?.months
          ?? Array(12).fill(1) as number[],
        expansionMonth:         null,
        expansionMultiplier:    1.5,
        overrides:              [],
        driverDone:          s.driver_done,
        items: (state.itemsByStream[s.id] ?? []).map((it) => ({
          id:                it.id,
          name:              it.name,
          category:          it.category,
          volume:            Number(it.volume),
          price:             Number(it.price),
          costPrice:         it.cost_price != null ? Number(it.cost_price) : undefined,
          unit:              it.unit,
          note:              it.note ?? undefined,
          seasonalityPreset: (it.seasonality_preset as SeasonalityPreset | null) ?? undefined,
        })),
        driverMessages: ((state.driverConversations.find((c) => c.stream_id === s.id)?.messages) ?? []) as ChatMessage[],
      }));
      setStreams(restored);
      // Mark already-done streams so the auto-advance effect never fires for them
      autoAdvancedRef.current = new Set(restored.filter((s) => s.driverDone).map((s) => s.id));

      // Restore actuals (existing business only)
      const restoredActuals: Record<string, ActualMonth[]> = {};
      const restoredActualsPhase: Record<string, boolean>  = {};
      for (const [streamId, rows] of Object.entries(state.actualsByStream ?? {})) {
        restoredActuals[streamId] = rows.map((r) => ({ yearMonth: r.year_month, total: Number(r.revenue) }));
        restoredActualsPhase[streamId] = true;  // actuals collected → show drivers phase
      }
      setActualsByStream(restoredActuals);
      setActualsPhaseByStream(restoredActualsPhase);

      if (state.forecastConfig) {
        setForecastHorizon(state.forecastConfig.horizon_years);
        setForecastStartYear(state.forecastConfig.start_year);
        setForecastStartMonth(state.forecastConfig.start_month);
      }

      // ── Determine which step to restore ────────────────────────────────────
      // wizard_step in DB mirrors the React `step` value (0=Revenue Engine,
      // 1=confirm structure, 2=revenue drivers, 3=forecast).
      //
      // wizard_step === 0 means the user was mid-Revenue-Engine conversation.
      // The engine saves streams to DB during that flow, so we must NOT
      // floor to step 1 just because streams exist — restore step 0 and let
      // the engine's own localStorage session handle the conversation replay.
      const ws = app.wizard_step ?? 0;

      if (ws === 0) {
        // wizard_step=0 means the engine was mid-conversation.
        // BUT if drivers_done=true (all streams confirmed), the engine finished and
        // wizard_step just hadn't synced yet — jump straight to forecast.
        if (app.drivers_done && restored.length > 0) {
          setDir(1);
          setStep(3);
        } else {
          setSituationDone(true); // ensure the engine renders
          setStep(0);
        }
        return;
      }

      const targetStep = Math.min(ws, 3);
      setDir(1);
      setStep(targetStep);

      // For Revenue Data: resume at the first stream that still needs items
      if (targetStep === 2) {
        const firstPending = restored.findIndex((s) => !s.driverDone);
        setStreamIdx(firstPending >= 0 ? firstPending : 0);
        setDriverModes({});
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
            .maybeSingle();
          if (error || !data) {
            // Fallback: load/create the latest draft
            app = await getOrCreateApplication(sb, user.id);
          } else {
            app = data as DbApplication;
          }
        } else if (forceNew) {
          // User explicitly chose "New Project" — always insert a fresh record
          const { data, error } = await sb
            .from("applications")
            .insert({ user_id: user.id })
            .select()
            .single();
          if (error || !data) throw new Error(error?.message ?? "Failed to create application");
          app = data as DbApplication;
          // Replace URL so a page refresh opens this app by ID, not re-creates
          router.replace(`/dashboard/apply?id=${app.id}`);
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

  // ── Called by ActualsChat when [ACTUALS_DETECTED] fires (existing biz only) ──
  const handleActualsSaved = useCallback(async (
    streamId: string,
    actualsData: ActualMonth[],
    _msgs: ChatMessage[],
  ) => {
    // Update local state
    setActualsByStream((prev) => ({ ...prev, [streamId]: actualsData }));
    setActualsPhaseByStream((prev) => ({ ...prev, [streamId]: true }));
    // Persist to DB
    if (appId && userId && isDbId(streamId)) {
      try {
        const sb = createClient();
        await saveActuals(sb, appId, streamId, userId, actualsData.map((a) => ({
          yearMonth: a.yearMonth, revenue: a.total,
        })));
      } catch (e) {
        console.error("[apply] actuals save error:", e);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, userId]);

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
        unit: it.unit, note: it.note ?? undefined,
        seasonalityPreset: it.seasonalityPreset, position: pos,
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

  // ── Called by UnifiedJourneyChat when [ITEMS_DETECTED] fires ────────────────
  const handleUnifiedItemsCollected = useCallback(async (
    streamId: string,
    items: StreamItem[],
    msgs: ChatMessage[],
  ) => {
    // Update local state
    setStreams(prev => prev.map(s =>
      s.id === streamId ? { ...s, items: [...s.items, ...items], driverDone: true } : s
    ));
    // Persist to DB
    if (!appId || !userId || !isDbId(streamId)) return;
    try {
      const sb = createClient();
      await saveStreamItems(sb, streamId, userId, items.map((it, pos) => ({
        name: it.name, category: it.category,
        volume: it.volume, price: it.price, costPrice: it.costPrice,
        unit: it.unit, note: it.note ?? undefined,
        seasonalityPreset: it.seasonalityPreset, position: pos,
      })));
      if (msgs.length > 0)
        await saveDriverConversation(sb, appId, userId, streamId, msgs, null, true);
      setStreams(prev => {
        const updated = prev.map(s => s.id === streamId ? { ...s, driverDone: true } : s);
        if (updated.every(s => s.driverDone || s.items.length > 0))
          updateApplicationFlags(sb, appId, { drivers_done: true }).catch(console.error);
        return updated;
      });
    } catch (e) { console.error("[apply] unified items save:", e); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, userId]);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const currentStream   = streams[streamIdx];
  const allStreamsReady = streams.length > 0 && streams.every((s) => s.driverDone || s.items.length > 0);

  // Count distinct types for summary
  const detectedTypes = [...new Set(streams.map((s) => s.type))];

  // Tracks stream IDs that have already triggered auto-advance this session.
  // Pre-populated with already-done streams on restore so navigating back to a
  // completed stream never bounces the user away involuntarily.
  const autoAdvancedRef = useRef<Set<string>>(new Set());

  // Auto-advance to next stream when the AI *freshly* finishes collecting items.
  // Only fires once per stream (ID tracked in autoAdvancedRef).
  const currentDone = streams[streamIdx]?.driverDone ?? false;
  useEffect(() => {
    if (step !== 2 || !currentDone || streamIdx >= streams.length - 1) return;
    const id = streams[streamIdx]?.id;
    if (!id || autoAdvancedRef.current.has(id)) return; // already advanced past this stream
    const t = setTimeout(() => {
      autoAdvancedRef.current.add(id);
      setStreamIdx((prev) => Math.min(prev + 1, streams.length - 1));
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
            {["Setup", "Revenue Model", "Forecast"].map((label, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${displayStep >= i ? "text-cyan-700" : "text-slate-400"}`}>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: displayStep >= i ? "#0e7490" : "#e2e8f0", color: displayStep >= i ? "#fff" : "#94a3b8" }}>
                    {displayStep > i
                      ? <Check className="w-3 h-3" />
                      : displayStep === i
                        ? <div className="w-2 h-2 rounded-full bg-white" />
                        : <span>{i + 1}</span>}
                  </div>
                  <span className="hidden sm:block">{label}</span>
                </div>
                {i < 2 && <div className={`w-6 sm:w-10 h-px ${displayStep > i ? "bg-cyan-600" : "bg-slate-200"}`} />}
              </div>
            ))}
          </div>
        </div>
        {/* Editable project name — always visible once user has started */}
        <div className="flex-shrink-0 hidden sm:block">
          <EditableName value={appName} onChange={setAppName} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:py-10">
        <div className="w-full max-w-6xl mx-auto">
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

            {/* ══ STEP 0: Unified Revenue Collection Journey ══ */}
            {situationDone && step === 0 && (
              <motion.div key="revenue-engine" custom={dir} variants={slide} initial="enter" animate="center" exit="exit">
                <div className="mb-3 flex items-center gap-2">
                  <button
                    onClick={() => { setSituationDone(false); setNameDone(true); setStreams([]); }}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
                    <ArrowLeft className="w-3 h-3" /> Change context
                  </button>
                </div>
                <RevenueEngine
                  situation={situation}
                  appId={appId}
                  userId={userId}
                  currency={currency}
                  onStreamsDetected={(detected) => {
                    setStreams(prev => {
                      // Same-length re-call = UUID sync OR stream-completion update.
                      // Merge IDs + growth + seasonality from engine; preserve local overrides.
                      if (prev.length === detected.length && detected.length > 0) {
                        return prev.map((s, i) => {
                          const d = detected[i];
                          return {
                            ...s,
                            id: d.id,
                            // Pull in growth numbers if the engine now has them
                            ...(d.growth ? {
                              volumeGrowthPct:     d.growth.monthlyVolumePct,
                              annualPriceGrowthPct: d.growth.annualPricePct,
                              monthlyGrowthPct:    d.growth.monthlyVolumePct + d.growth.annualPricePct / 12,
                            } : {}),
                            // Pull in seasonality if the engine now has it
                            ...(d.seasonality ? {
                              seasonalityPreset:      d.seasonality.preset as SeasonalityPreset,
                              seasonalityMultipliers: d.seasonality.multipliers,
                            } : {}),
                            driverDone: d.status === "completed" ? true : s.driverDone,
                          };
                        });
                      }
                      // Fresh detection — build full RevenueStream objects
                      return detected.map(ws => ({
                        id: ws.id, name: ws.name, type: ws.type, confidence: ws.confidence,
                        items: ws.items.map(it => ({
                          id: it.id, name: it.name, category: it.category,
                          volume: it.volume, price: it.price, costPrice: it.costPrice,
                          unit: it.unit, note: it.note,
                        })),
                        scenario: "base" as const,
                        volumeGrowthPct: ws.growth?.monthlyVolumePct ?? 0,
                        annualPriceGrowthPct: ws.growth?.annualPricePct ?? 0,
                        monthlyGrowthPct: (ws.growth?.monthlyVolumePct ?? 0) + (ws.growth?.annualPricePct ?? 0) / 12,
                        subNewPerMonth: 0, subChurnPct: 0, rentalOccupancyPct: 100,
                        seasonalityPreset: (ws.seasonality?.preset ?? "none") as SeasonalityPreset,
                        seasonalityMultipliers: ws.seasonality?.multipliers ?? Array(12).fill(1),
                        expansionMonth: null, expansionMultiplier: 1.5,
                        overrides: [], driverMessages: [], driverDone: ws.status === "completed",
                      }));
                    });
                  }}
                  onItemsSaved={(streamId, streamName, items) => {
                    const mapped = items.map(it => ({
                      id: it.id, name: it.name, category: it.category,
                      volume: it.volume, price: it.price, costPrice: it.costPrice,
                      unit: it.unit, note: it.note,
                    }));
                    setStreams(prev => {
                      // Primary: match by real DB UUID (after onStreamsDetected UUID sync)
                      const byId = prev.map(s =>
                        s.id === streamId ? { ...s, items: mapped, driverDone: true } : s
                      );
                      if (byId.some((s, i) => s !== prev[i])) return byId;
                      // Fallback: match by name in case UUID sync hasn't landed yet
                      return prev.map(s =>
                        s.name === streamName ? { ...s, items: mapped, driverDone: true } : s
                      );
                    });
                    /* Belt-and-suspenders DB save from the page.
                       The page's `streams` state already has real UUIDs (from onStreamsDetected
                       UUID sync which fires before the driver chat even starts), and the page
                       creates a fresh Supabase client — no stale-closure risk. */
                    const realId = (streams.find(s => s.id === streamId) ?? streams.find(s => s.name === streamName))?.id;
                    if (realId && !realId.startsWith("local-") && appId && userId) {
                      const sbPage = createClient();
                      saveStreamItems(sbPage, realId, userId, items.map(it => ({
                        name: it.name, category: it.category ?? "General",
                        volume: it.volume, price: it.price,
                        costPrice: it.costPrice, unit: it.unit, note: it.note,
                      }))).catch(e => console.error("[page] saveStreamItems:", e));
                    }
                  }}
                  onForecastYears={setForecastHorizon}
                  onForecastStart={(y, m) => { setForecastStartYear(y); setForecastStartMonth(m); }}
                  onComplete={() => go(3)}
                />
              </motion.div>
            )}


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
                              setStreamIdx(0); setDriverModes({}); go(2);
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

              // Per-stream mode derived from map (defaults to "chat" when absent)
              const driverMode = driverModes[currentStream.id] ?? "chat";
              const setDriverMode = (m: DriverMode) =>
                setDriverModes((p) => ({ ...p, [currentStream.id]: m }));

              return (
                <>
                {/* ── Stream selector ── */}
                <div className="mb-4 space-y-2.5">
                      {/* Header row */}
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {streams.length > 1 ? "Select a stream to configure" : "Revenue stream"}
                        </p>
                        <div className="flex items-center gap-2">
                          {streams.length > 1 && (
                            <span className="text-[10px] font-semibold text-slate-400">
                              {streams.filter(s => s.driverDone || s.items.length > 0).length}/{streams.length} done
                            </span>
                          )}
                          {streams.some(s => streamMRR(s) > 0) && (
                            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                              {fmt(streams.reduce((a, s) => a + streamMRR(s), 0))}/mo
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Stream pills — wrap naturally */}
                      <div className="flex flex-wrap gap-2">
                        {streams.map((s, i) => {
                          const sMeta = STREAM_META[s.type];
                          const SIcon = sMeta.icon;
                          const done   = s.driverDone || s.items.length > 0;
                          const active = i === streamIdx;
                          return (
                            <button key={s.id}
                              onClick={() => { setStreamIdx(i); setShowStreamPicker(false); }}
                              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all ${
                                active
                                  ? "bg-cyan-600 text-white border-cyan-600 shadow-md shadow-cyan-100"
                                  : done
                                    ? "bg-white text-emerald-700 border-emerald-300 hover:border-emerald-500 hover:bg-emerald-50"
                                    : "bg-white text-slate-600 border-slate-200 hover:border-cyan-300 hover:text-cyan-700 hover:bg-cyan-50"
                              }`}>
                              <SIcon className="w-3.5 h-3.5 flex-shrink-0"
                                style={{ color: active ? "white" : done ? "#059669" : sMeta.color }} />
                              <span className="truncate max-w-[180px]">{s.name}</span>
                              {done && !active && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                              )}
                            </button>
                          );
                        })}

                        {/* Add Stream button — inline with pills */}
                        <button
                          onClick={() => setShowStreamPicker((v) => !v)}
                          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-dashed transition-all ${
                            showStreamPicker
                              ? "border-cyan-400 text-cyan-600 bg-cyan-50"
                              : "border-slate-300 text-slate-400 hover:border-cyan-400 hover:text-cyan-600 hover:bg-slate-50"
                          }`}>
                          <Plus className="w-4 h-4" /> Add Revenue Stream
                        </button>
                      </div>
                      {/* Inline stream type picker */}
                      {showStreamPicker && (
                        <div className="bg-white border border-cyan-100 rounded-xl p-3 shadow-md space-y-2.5">
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Stream name (optional)</p>
                            <input
                              type="text"
                              value={newStreamName}
                              onChange={(e) => setNewStreamName(e.target.value)}
                              placeholder="e.g. Online Sales, Consulting, Rentals…"
                              className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-700 placeholder-slate-300 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-200"
                            />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Choose stream type</p>
                            <div className="flex flex-wrap gap-1.5">
                              {(["product","service","subscription","rental","contract","marketplace","custom"] as StreamType[]).map((t) => {
                                const M = STREAM_META[t]; const TIcon = M.icon;
                                return (
                                  <button key={t}
                                    onClick={async () => {
                                      const name = newStreamName.trim() || M.label;
                                      const ns = makeStream(name, t, "low");
                                      const newIdx = streams.length;
                                      // Optimistically add to UI first
                                      setStreams((p) => [...p, ns]);
                                      setStreamIdx(newIdx);
                                      setNewStreamName("");
                                      setShowStreamPicker(false);
                                      // Save to DB to get a real ID, then patch local state
                                      if (appId && userId) {
                                        try {
                                          const sb = createClient();
                                          const allStreams = [...streams, ns];
                                          const savedS = await saveStreams(sb, appId, userId,
                                            allStreams.map((s, i) => ({
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
                                          allStreams.forEach((s, i) => {
                                            const db = savedS[i];
                                            if (db && s.id !== db.id) idMap[s.id] = db.id;
                                          });
                                          if (Object.keys(idMap).length > 0) {
                                            setStreams((prev) => prev.map((s) => ({ ...s, id: idMap[s.id] ?? s.id })));
                                          }
                                        } catch (e) {
                                          console.error("[Add Stream] save failed:", e);
                                        }
                                      }
                                    }}
                                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:border-cyan-400 hover:text-cyan-600 text-slate-600 transition-all">
                                    <TIcon className="w-3 h-3" style={{ color: M.color }} /> {M.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                <motion.div key={`drivers-${currentStream.id}`} custom={dir} variants={slide} initial="enter" animate="center" exit="exit">
                  <div className="mb-4">
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

                      {/* ── Actuals phase (existing business only) ── */}
                      {situation === "existing" && !actualsPhaseByStream[currentStream.id] && (
                        <div className="space-y-3">
                          {/* Actuals phase header */}
                          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                            <BarChart3 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                            <div>
                              <p className="text-xs font-bold text-emerald-800">Step 1 of 2 — Historical Actuals</p>
                              <p className="text-[11px] text-emerald-600">Enter your actual monthly revenue for {currentStream.name}. The AI will guide you.</p>
                            </div>
                          </div>
                          <ActualsChat
                            stream={currentStream}
                            onActualsSaved={handleActualsSaved}
                          />
                          {/* Show "Skip to Drivers" if user already has items */}
                          {currentStream.items.length > 0 && (
                            <button
                              onClick={() => setActualsPhaseByStream((p) => ({ ...p, [currentStream.id]: true }))}
                              className="text-xs text-slate-400 underline hover:text-slate-600 transition-colors w-full text-center">
                              Skip actuals — go straight to Revenue Drivers
                            </button>
                          )}
                        </div>
                      )}

                      {/* ── Actuals done banner + drivers heading (existing business) ── */}
                      {situation === "existing" && actualsPhaseByStream[currentStream.id] && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                              <div>
                                <p className="text-xs font-bold text-emerald-800">Actuals captured</p>
                                <p className="text-[10px] text-emerald-600">
                                  {(actualsByStream[currentStream.id] ?? []).length} months · {fmt((actualsByStream[currentStream.id] ?? []).reduce((a, m) => a + m.total, 0))} total
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => setActualsPhaseByStream((p) => ({ ...p, [currentStream.id]: false }))}
                              className="text-[10px] text-emerald-600 hover:text-emerald-800 underline transition-colors">
                              Edit actuals
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-500 px-1">
                            <span className="font-semibold">Step 2 of 2 — Revenue Drivers</span> — enter the items, volumes, and prices that form the projection baseline.
                          </p>
                        </div>
                      )}

                      {/* Mode tabs + driver inputs — only shown when not in actuals phase */}
                      {(situation !== "existing" || actualsPhaseByStream[currentStream.id]) && (<>
                      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                        {([
                          { id: "chat"   as DriverMode, label: "AI Guided",      icon: BrainCircuit },
                          { id: "import" as DriverMode, label: "Paste Data",     icon: Clipboard },
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
                          <ItemTable
                            stream={currentStream}
                            onUpdate={updateStream}
                            onApplySeasonalityToAll={(preset, mults) =>
                              setStreams((prev) => prev.map((s) => ({
                                ...s,
                                seasonalityPreset:      preset,
                                seasonalityMultipliers: [...mults],
                              })))
                            }
                            fmt={fmt}
                            currencySymbol={getCurrencySymbol(currency)}
                          />
                        </div>
                      )}

                      {/* Navigation */}
                      <div className="flex gap-3 pt-1">
                        <button
                          onClick={() => {
                            if (streamIdx > 0) { setStreamIdx(streamIdx - 1); }
                            else { go(1); }
                          }}
                          className="flex items-center gap-2 px-5 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                          <ArrowLeft className="w-4 h-4" /> Back
                        </button>

                        {streamIdx < streams.length - 1 ? (
                          <button onClick={() => { setStreamIdx(streamIdx + 1); }}
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
                                  const savedS = await saveStreams(sb, appId, userId,
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
                                  // Resolve any temp IDs → real DB UUIDs
                                  const idMap: Record<string, string> = {};
                                  streams.forEach((s, i) => {
                                    const db = savedS[i];
                                    if (db && s.id !== db.id) idMap[s.id] = db.id;
                                  });
                                  let resolvedStreams = streams;
                                  if (Object.keys(idMap).length > 0) {
                                    resolvedStreams = streams.map((s) => ({ ...s, id: idMap[s.id] ?? s.id }));
                                    setStreams(resolvedStreams);
                                  }
                                  // Save items for every stream that has them
                                  for (const s of resolvedStreams) {
                                    if (isDbId(s.id) && s.items.length > 0) {
                                      await saveStreamItems(sb, s.id, userId, s.items.map((it, pos) => ({
                                        id: isDbId(it.id) ? it.id : undefined,
                                        name: it.name, category: it.category ?? "",
                                        volume: it.volume, price: it.price,
                                        unit: it.unit ?? "", note: it.note ?? "",
                                        seasonality_preset: it.seasonalityPreset ?? null,
                                        position: pos,
                                      })));
                                    }
                                  }
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
                              : <>Generate Revenue Projection <ArrowRight className="w-4 h-4" /></>
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
                      </>)} {/* end: (situation !== "existing" || actualsPhaseByStream) */}
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
                </>
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
                  onStartChange={(y, m) => { setForecastStartYear(y); setForecastStartMonth(m); }}
                  currency={currency}
                  onEditDrivers={() => go(2)}
                  actuals={situation === "existing" && Object.keys(actualsByStream).length > 0
                    ? (() => {
                        // Aggregate all streams' actuals by month
                        const byMonth: Record<string, number> = {};
                        for (const rows of Object.values(actualsByStream)) {
                          for (const r of rows) {
                            byMonth[r.yearMonth] = (byMonth[r.yearMonth] ?? 0) + r.total;
                          }
                        }
                        return Object.entries(byMonth)
                          .sort((a, b) => a[0].localeCompare(b[0]))
                          .map(([yearMonth, total]) => ({ yearMonth, total }));
                      })()
                    : undefined}
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
                            if (local && db) {
                              // Persist seasonality (007) + growth decomposition (008).
                              // saveStreams only writes base columns, so we use a separate call.
                              updateStreamDb(sb, db.id, {
                                seasonality_preset:      local.seasonalityPreset ?? "none",
                                seasonality_multipliers: local.seasonalityMultipliers ?? null,
                                volume_growth_pct:       local.volumeGrowthPct,
                                annual_price_growth_pct: local.annualPriceGrowthPct,
                              }).catch(e => console.error("[save&continue] growth+seasonality:", e));

                              if (local.items?.length) {
                                await saveStreamItems(sb, db.id, userId, local.items.map((it, pos) => ({
                                  name: it.name, category: it.category,
                                  volume: it.volume, price: it.price,
                                  costPrice: it.costPrice,           // ← was missing
                                  unit: it.unit, note: it.note,
                                  seasonalityPreset: it.seasonalityPreset, position: pos,
                                })));
                              }
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
