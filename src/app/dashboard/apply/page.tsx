"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  getOrCreateApplication, saveStreams, saveStreamItems,
  saveIntakeConversation, saveDriverConversation,
  loadApplicationState, updateApplicationFlags,
  type DbApplication, type ApplicationState,
} from "@/lib/supabase/revenue";
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

/* ═══════════════════════════════════════ situations ══ */
const SITUATIONS = [
  {
    id: "existing",
    icon: Store,
    title: "Existing Business",
    desc: "My business is already operating",
    color: "#059669", bg: "#f0fdf4",
  },
  {
    id: "new_business",
    icon: Rocket,
    title: "Starting a New Business",
    desc: "Launching a new company, product, or brand",
    color: "#0e7490", bg: "#f0f9ff",
  },
  {
    id: "expansion",
    icon: TrendingUp,
    title: "Expansion / Growth",
    desc: "Adding locations, products, or capacity to an existing business",
    color: "#7c3aed", bg: "#faf5ff",
  },
  {
    id: "working_capital",
    icon: Banknote,
    title: "Working Capital",
    desc: "Short-term funding for operations, inventory, or a busy season",
    color: "#b45309", bg: "#fffbeb",
  },
  {
    id: "asset_purchase",
    icon: Wrench,
    title: "Asset Purchase",
    desc: "Buying equipment, vehicles, or machinery",
    color: "#0f766e", bg: "#f0fdfa",
  },
  {
    id: "turnaround",
    icon: RefreshCcw,
    title: "Turnaround / Recovery",
    desc: "Revenue has declined — need restructuring or a cash injection",
    color: "#e11d48", bg: "#fff1f2",
  },
] as const;

type SituationId = typeof SITUATIONS[number]["id"];

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
  monthlyGrowthPct: number;
  subNewPerMonth: number;    // subscription: new subscribers per month
  subChurnPct: number;       // subscription: monthly churn %
  rentalOccupancyPct: number; // rental: % of units occupied
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

const COL_LABELS: Record<StreamType, { vol: string; price: string; rev: string }> = {
  product:      { vol: "Units/mo",       price: "Unit Price",     rev: "Monthly Rev"   },
  service:      { vol: "Clients/mo",     price: "Avg Fee",        rev: "Monthly Rev"   },
  subscription: { vol: "Subscribers",    price: "Monthly Fee",    rev: "MRR"           },
  rental:       { vol: "Units",          price: "Rate/mo",        rev: "Potential Rev" },
  marketplace:  { vol: "GMV/mo",         price: "Commission %",   rev: "Net Commission"},
  contract:     { vol: "Contracts",      price: "Monthly Value",  rev: "Monthly Rev"   },
  custom:       { vol: "Volume",         price: "Price",          rev: "Monthly Rev"   },
};

const HORIZONS = [
  { label: "1 yr",   years: 1  },
  { label: "3 yrs",  years: 3  },
  { label: "5 yrs",  years: 5  },
  { label: "10 yrs", years: 10 },
  { label: "30 yrs", years: 30 },
];

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
  return {
    id: uid(), name, type, confidence, items: [],
    monthlyGrowthPct: 2, subNewPerMonth: 0, subChurnPct: 0, rentalOccupancyPct: 100,
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

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

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

      if (s.type === "subscription") {
        // Churn model: subscribers_t = subscribers_{t-1} + new - churn
        if (i > 0) {
          const churn = Math.round(subTotals[s.id] * (s.subChurnPct ?? 0) / 100);
          subTotals[s.id] = Math.max(0, subTotals[s.id] + (s.subNewPerMonth ?? 0) - churn);
        }
        const initial = Math.max(1, s.items.reduce((a, it) => a + it.volume, 0));
        const subFactor = subTotals[s.id] / initial;
        s.items.forEach((it) => addItem(it.name, it.category, Math.round(it.volume * it.price * subFactor)));

      } else if (s.type === "rental") {
        // Revenue = units × rate × occupancy%
        const occ = (s.rentalOccupancyPct ?? 100) / 100;
        const factor = Math.pow(1 + s.monthlyGrowthPct / 100, i);
        s.items.forEach((it) => addItem(it.name, it.category, Math.round(it.volume * it.price * occ * factor)));

      } else if (s.type === "marketplace") {
        // Revenue = GMV × commission%
        const factor = Math.pow(1 + s.monthlyGrowthPct / 100, i);
        s.items.forEach((it) => addItem(it.name, it.category, Math.round(it.volume * (it.price / 100) * factor)));

      } else {
        // product, service, contract, custom → units × price
        const factor = Math.pow(1 + s.monthlyGrowthPct / 100, i);
        s.items.forEach((it) => addItem(it.name, it.category, Math.round(it.volume * it.price * factor)));
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
  const map = new Map<number, ProjMonth[]>();
  months.forEach((m) => { if (!map.has(m.year)) map.set(m.year, []); map.get(m.year)!.push(m); });
  return Array.from(map.entries()).map(([year, ms]) => ({
    year, months: ms, total: ms.reduce((a, b) => a + b.total, 0),
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
  item, type, onChange, onDelete,
}: { item: StreamItem; type: StreamType; onChange: (i: StreamItem) => void; onDelete: () => void }) {
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
          <span className="text-xs text-slate-300">{type === "marketplace" ? "%" : "$"}</span>
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
function ItemTable({ stream, onUpdate }: { stream: RevenueStream; onUpdate: (s: RevenueStream) => void }) {
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
      {/* Growth slider (hidden for subscription — churn model controls growth) */}
      {stream.type !== "subscription" && (
        <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
          <span className="text-xs font-medium text-slate-500 flex-shrink-0">Monthly growth</span>
          <input type="range" min={0} max={20} step={0.5} value={stream.monthlyGrowthPct}
            onChange={(e) => onUpdate({ ...stream, monthlyGrowthPct: Number(e.target.value) })}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer" style={{ accentColor: "#0e7490" }} />
          <span className="text-xs font-bold w-10 text-right flex-shrink-0" style={{ color: "#0e7490" }}>
            +{stream.monthlyGrowthPct}%
          </span>
        </div>
      )}

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
function DriverChat({ stream, onUpdate, situation, isFirstStream, onForecastYears, onForecastStart, intakeContext }: {
  stream: RevenueStream;
  onUpdate: (s: RevenueStream) => void;
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
        onUpdate({ ...stream, driverMessages: newMsgs, items: [...stream.items, ...items], driverDone: true });
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
              {m.content}
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
function RevenueMix({ streams, months }: { streams: RevenueStream[]; months: ProjMonth[] }) {
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
  horizonYears, setHorizonYears,
  startYear,    setStartYear,
  startMonth,   setStartMonth,
}: {
  streams:          RevenueStream[];
  horizonYears:     number;
  setHorizonYears:  (n: number) => void;
  startYear:        number;
  setStartYear:     (n: number) => void;
  startMonth:       number;
  setStartMonth:    (n: number) => void;
}) {
  const now = new Date();
  const [view,         setView]         = useState<"annual" | "monthly">("annual");
  const [selectedYear, setSelectedYear] = useState(startYear);

  const startDate  = new Date(startYear, startMonth, 1);
  const totalMths  = horizonYears * 12;
  const projection = projectRevenue(streams, totalMths, startDate);
  const years      = groupByYear(projection);
  const grandTotal = years.reduce((a, y) => a + y.total, 0);
  const totalMRR   = streams.reduce((a, s) => a + streamMRR(s), 0);

  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const QTR = ["Q1","Q1","Q1","Q2","Q2","Q2","Q3","Q3","Q3","Q4","Q4","Q4"];

  // ── Cell helpers ──────────────────────────────────────────────────────────
  const TH = ({ children, cls = "" }: { children: React.ReactNode; cls?: string }) => (
    <th className={`px-3 py-2 text-right text-[11px] font-bold whitespace-nowrap ${cls}`}>{children}</th>
  );
  const TD = ({ children, cls = "", style }: { children: React.ReactNode; cls?: string; style?: React.CSSProperties }) => (
    <td className={`px-3 py-2 text-right text-[11px] tabular-nums whitespace-nowrap ${cls}`} style={style}>{children}</td>
  );
  const LabelCell = ({ children, indent = false }: { children: React.ReactNode; indent?: boolean }) => (
    <td className={`px-3 py-2 text-[11px] font-medium whitespace-nowrap sticky left-0 bg-inherit ${indent ? "pl-7 text-slate-500 font-normal" : "text-slate-800 font-semibold"}`}>
      {children}
    </td>
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

      {/* ── Config bar ── */}
      <div className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500">Start</span>
            <select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}
              className="text-xs border border-slate-200 rounded-md px-2 py-1 text-slate-700 focus:border-cyan-500 focus:outline-none bg-white">
              {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={startYear} onChange={(e) => setStartYear(Number(e.target.value))}
              className="text-xs border border-slate-200 rounded-md px-2 py-1 text-slate-700 focus:border-cyan-500 focus:outline-none bg-white">
              {Array.from({ length: 10 }, (_, i) => now.getFullYear() + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-slate-500 mr-0.5">Horizon</span>
            {HORIZONS.map(({ label, years: y }) => (
              <button key={y} onClick={() => setHorizonYears(y)}
                className={`text-xs font-semibold px-2 py-1 rounded-md border transition-all ${
                  horizonYears === y ? "text-white border-transparent" : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`} style={horizonYears === y ? { background: "#0e7490" } : {}}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {/* View toggle */}
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          {(["annual", "monthly"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-all capitalize ${
                view === v ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"
              }`}>{v}</button>
          ))}
        </div>
      </div>

      {/* ── KPI summary row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Monthly baseline",        val: fmt(totalMRR),                              sub: "MRR estimate" },
          { label: `${horizonYears}-yr total`, val: fmt(grandTotal),                            sub: "Cumulative revenue" },
          { label: "Year 1 revenue",           val: fmt(years[0]?.total ?? 0),                  sub: "First 12 months" },
          { label: `Year ${horizonYears}`,     val: fmt(years[years.length - 1]?.total ?? 0),   sub: "Final year" },
        ].map(({ label, val, sub }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 px-4 py-3">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{label}</p>
            <p className="text-sm font-bold text-slate-900">{val}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* ══ ANNUAL VIEW — multi-year P&L style ══ */}
      {view === "annual" && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">Revenue Statement</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Annual projection · {streams.length} stream{streams.length !== 1 ? "s" : ""}</p>
            </div>
            <span className="text-[10px] text-slate-400 font-medium">Amounts in {fmt(1).replace("1", "").trim() || "$"}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              {/* Header */}
              <thead>
                <tr style={{ background: "#042f3d" }}>
                  <th className="px-3 py-3 text-left text-[11px] font-bold text-white sticky left-0 min-w-[180px]" style={{ background: "#042f3d" }}>
                    Revenue Stream
                  </th>
                  {years.map((y, i) => (
                    <TH key={y.year} cls="text-white">
                      FY {y.year}{horizonYears > 1 ? <span className="block text-[9px] font-normal opacity-60">Year {i + 1}</span> : null}
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

                {/* One row per stream */}
                {streams.map((s, si) => {
                  const streamColor = MIX_COLORS[si % MIX_COLORS.length];
                  const yearTotals  = years.map((y) => streamYearTotal(s.id, y));
                  const streamGrand = yearTotals.reduce((a, v) => a + v, 0);
                  const cagr = years.length > 1 && yearTotals[0] > 0
                    ? ((Math.pow(yearTotals[yearTotals.length - 1] / yearTotals[0], 1 / (years.length - 1)) - 1) * 100)
                    : null;
                  return (
                    <tr key={s.id} className={si % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <td className="px-3 py-2.5 text-[11px] sticky left-0 bg-inherit">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: streamColor }} />
                          <span className="font-medium text-slate-800">{s.name}</span>
                        </div>
                      </td>
                      {yearTotals.map((v, i) => <TD key={i}>{fmt(v)}</TD>)}
                      <TD cls="font-semibold border-l border-slate-100">{fmt(streamGrand)}</TD>
                      {years.length > 1 && (
                        <TD cls={cagr !== null ? (cagr >= 0 ? "text-emerald-600" : "text-red-500") : ""}>
                          {cagr !== null ? `${cagr >= 0 ? "+" : ""}${cagr.toFixed(1)}%` : "—"}
                        </TD>
                      )}
                    </tr>
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
                FY {y.year}
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
                        FY {selectedYear}
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

                    {/* Stream rows */}
                    {streams.map((s, si) => {
                      const streamColor = MIX_COLORS[si % MIX_COLORS.length];
                      const yearTotal   = streamYearTotal(s.id, selectedYearData);
                      return (
                        <tr key={s.id} className={si % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                          <td className="px-3 py-2 text-[11px] sticky left-0 bg-inherit">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: streamColor }} />
                              <span className="font-medium text-slate-800">{s.name}</span>
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

      {/* ── Confidence note ── */}
      <div className="flex items-start gap-3 rounded-xl px-4 py-3 bg-amber-50 border border-amber-100">
        <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700">
          <span className="font-semibold">Projection confidence: Medium</span> — based on your inputs.
          Connect bank records or import verified sales data to reach High confidence.
        </p>
      </div>

      {/* ── Financial statements CTA ── */}
      <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(135deg,#0a1628,#0f2a4a)" }}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(14,116,144,0.3)" }}>
            <BarChart3 className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Ready to build your Financial Statements</p>
            <p className="text-xs text-slate-400 mt-0.5">Your revenue model feeds into P&amp;L, Cash Flow, Balance Sheet, and Loan Readiness score.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {["P&L Statement", "Cash Flow", "Balance Sheet", "Loan Readiness"].map((label) => (
            <div key={label} className="py-2 px-3 rounded-lg text-xs font-semibold text-slate-300 border border-white/10 text-center" title="Coming soon">
              {label}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-3 text-center">Financial modelling — coming next · Save your progress to continue</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ ApplyPage ══ */
export default function ApplyPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [dir,  setDir]  = useState(1);

  // Situation detection (pre-gate)
  const [situation,     setSituation]     = useState<SituationId | null>(null);
  const [situationDone, setSituationDone] = useState(false);

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
  const isSavingRef  = useRef(false);   // guard against save → setState → save loops
  const intakeSaveTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const streamSaveTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
  // Returns true if wizard_step needs to be reset in DB (streams missing)
  function restoreFromDb(app: DbApplication, state: ApplicationState): boolean {
    if (app.name) setAppName(app.name);
    if (app.situation) setSituation(app.situation as SituationId);

    const intake = state.intakeConversation;
    if (intake?.messages?.length) {
      setMessages(intake.messages as ChatMessage[]);
      if (intake.is_complete) setSituationDone(true);
    }

    if (state.streams.length > 0) {
      const restored: RevenueStream[] = state.streams.map((s) => ({
        id:                  s.id,
        name:                s.name,
        type:                s.type as StreamType,
        confidence:          s.confidence as Confidence,
        monthlyGrowthPct:    Number(s.monthly_growth_pct),
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

      // Jump to the furthest step the user reached (capped at step 3 = forecast)
      const targetStep = Math.min(app.wizard_step ?? 0, 3);
      if (targetStep > 0) { setDir(1); setStep(targetStep); }
      return false; // no DB reset needed
    }

    // ── No streams in DB (race condition from earlier session) ────────────────
    // Stay at step 0 (intake chat). If the user has conversation history,
    // flag that we should re-run stream detection so they don't start over.
    if (intake?.messages?.length && intake.is_complete) {
      setNeedsRedetection(true);
    }
    // Tell the caller to reset wizard_step in DB so the cycle doesn't repeat
    return app.wizard_step > 0;
  }

  // ── On mount: get/create application, restore if progress exists ─────────────
  useEffect(() => {
    (async () => {
      setIsRestoring(true);
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) { setIsRestoring(false); return; }
        setUserId(user.id);
        const app = await getOrCreateApplication(sb, user.id);
        setAppId(app.id);
        // Restore if there is any saved progress
        if (app.wizard_step > 0 || app.intake_done) {
          const state = await loadApplicationState(sb, app.id);
          const needsReset = restoreFromDb(app, state);
          // If streams were missing, reset wizard_step so next visit starts fresh
          if (needsReset) {
            await updateApplicationFlags(sb, app.id, { wizard_step: 0 });
          }
        }
      } catch (e) {
        console.error("[apply] restore error", e);
      } finally {
        setIsRestoring(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-save: situation ────────────────────────────────────────────────────
  useEffect(() => {
    if (!appId || !situation) return;
    const sb = createClient();
    updateApplicationFlags(sb, appId, { situation }).catch(console.error);
  }, [situation, appId]);

  // ── Auto-save: wizard step ──────────────────────────────────────────────────
  useEffect(() => {
    if (!appId) return;
    const sb = createClient();
    updateApplicationFlags(sb, appId, { wizard_step: step }).catch(console.error);
  }, [step, appId]);

  // ── Auto-save: project name ─────────────────────────────────────────────────
  useEffect(() => {
    if (!appId || appName === "New Application") return;
    const sb = createClient();
    updateApplicationFlags(sb, appId, { name: appName }).catch(console.error);
  }, [appName, appId]);

  // ── Auto-save: intake messages (debounced 800 ms) ───────────────────────────
  useEffect(() => {
    if (!appId || !userId || messages.length === 0) return;
    clearTimeout(intakeSaveTimer.current);
    const isComplete = streams.length > 0;
    intakeSaveTimer.current = setTimeout(async () => {
      try {
        const sb = createClient();
        await saveIntakeConversation(sb, appId, userId, messages, null, isComplete);
        if (isComplete) {
          await updateApplicationFlags(sb, appId, { intake_done: true });
        }
      } catch (e) { console.error("[apply] intake save error", e); }
    }, 800);
    return () => clearTimeout(intakeSaveTimer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, streams.length, appId, userId]);

  // ── Auto-save: streams + items + driver messages (debounced 1.2 s) ──────────
  useEffect(() => {
    if (!appId || !userId || streams.length === 0 || isSavingRef.current) return;
    clearTimeout(streamSaveTimer.current);
    streamSaveTimer.current = setTimeout(async () => {
      isSavingRef.current = true;
      try {
        const sb = createClient();
        // Save streams — strip local IDs so DB generates UUIDs for new ones
        const savedStreams = await saveStreams(sb, appId, userId,
          streams.map((s, i) => ({
            id:                   isDbId(s.id) ? s.id : undefined,
            name:                 s.name,
            type:                 s.type,
            confidence:           s.confidence,
            monthly_growth_pct:   s.monthlyGrowthPct,
            sub_new_per_month:    s.subNewPerMonth,
            sub_churn_pct:        s.subChurnPct,
            rental_occupancy_pct: s.rentalOccupancyPct,
            driver_done:          s.driverDone,
            position:             i,
          }))
        );

        // If any streams got new DB IDs, update local state
        const idMap: Record<string, string> = {};
        streams.forEach((s, i) => {
          const db = savedStreams[i];
          if (db && s.id !== db.id) idMap[s.id] = db.id;
        });
        if (Object.keys(idMap).length > 0) {
          setStreams((prev) => prev.map((s) => ({ ...s, id: idMap[s.id] ?? s.id })));
        }

        // Save items + driver conversations per stream (use DB IDs)
        for (let i = 0; i < savedStreams.length; i++) {
          const local = streams[i];
          const db    = savedStreams[i];
          if (!local || !db) continue;

          if (local.items.length > 0) {
            await saveStreamItems(sb, db.id, userId, local.items.map((it, pos) => ({
              name: it.name, category: it.category,
              volume: it.volume, price: it.price,
              unit: it.unit, note: it.note, position: pos,
            })));
          }
          if (local.driverMessages.length > 0) {
            await saveDriverConversation(sb, appId, userId, db.id, local.driverMessages, null, local.driverDone);
          }
        }

        const allDone = streams.every((s) => s.driverDone || s.items.length > 0);
        if (allDone) {
          await updateApplicationFlags(sb, appId, { drivers_done: true });
        }
      } catch (e) {
        console.error("[apply] streams save error", e);
      } finally {
        isSavingRef.current = false;
      }
    }, 1200);
    return () => clearTimeout(streamSaveTimer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streams, appId, userId]);

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
        const clean = text.slice(0, text.indexOf("[STREAMS_DETECTED]")).trim() ||
          `Great — I've identified ${detected.length} income source${detected.length !== 1 ? "s" : ""}. Let me show you what I found.`;
        setMessages((prev) => [...prev, { role: "assistant", content: clean }]);
        setStreams(detected);

        // ── Immediately persist streams + name to DB (fire-and-forget) ──────────
        // The debounced auto-save might not fire before the user leaves the page.
        // This guarantees streams are in DB right when they're detected.
        if (appId && userId) {
          (async () => {
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
              // Auto-name: "StreamA & StreamB +N more"
              const parts = detected.map((s) => s.name).slice(0, 2);
              const extra = detected.length > 2 ? ` +${detected.length - 2} more` : "";
              const autoName = parts.join(" & ") + extra;
              setAppName(autoName);
              await updateApplicationFlags(sb, appId, { intake_done: true, name: autoName });
            } catch (e) {
              console.error("[apply] immediate stream save:", e);
            }
          })();
        }

        setTimeout(() => go(1), 900);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: text }]);
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

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const currentStream   = streams[streamIdx];
  const allStreamsReady = streams.length > 0 && streams.every((s) => s.driverDone || s.items.length > 0);

  // Count distinct types for summary
  const detectedTypes = [...new Set(streams.map((s) => s.type))];

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
            {["Situation", "Business Mapping", "Confirm Structure", "Revenue Data", "Forecast"].map((label, i) => (
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
        {/* Editable project name — shown once streams are detected */}
        {streams.length > 0 && (
          <div className="flex-shrink-0 hidden sm:block">
            <EditableName value={appName} onChange={setAppName} />
          </div>
        )}
      </div>

      <div className="flex-1 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait" custom={dir}>

            {/* ══ SITUATION SELECTION ══ */}
            {!situationDone && (
              <motion.div key="situation" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.38, ease: EASE }}
                className="space-y-6">

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#0e7490" }}>
                    Step 1 of 5
                  </p>
                  <h2 className="text-2xl font-bold text-slate-900">What is your current situation?</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    This helps us tailor the right financial model and questions for your business.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SITUATIONS.map(({ id, icon: Icon, title, desc, color, bg }) => {
                    const selected = situation === id;
                    return (
                      <motion.button key={id} onClick={() => setSituation(id)}
                        whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
                        className={`text-left p-4 rounded-2xl border-2 transition-all ${
                          selected
                            ? "border-cyan-500 shadow-md"
                            : "border-slate-100 hover:border-slate-200 bg-white"
                        }`}
                        style={selected ? { background: bg, borderColor: color } : {}}>
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ background: selected ? "white" : bg }}>
                            <Icon className="w-4 h-4" style={{ color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 mb-0.5">{title}</p>
                            <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                          </div>
                          {selected && (
                            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                              style={{ background: color }}>
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>

                <div className="flex gap-3">
                  <Link href="/dashboard"
                    className="flex items-center gap-2 px-5 py-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </Link>
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    disabled={!situation}
                    onClick={() => { setSituationDone(true); }}
                    className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                    Begin Business Mapping <ArrowRight className="w-4 h-4" />
                  </motion.button>
                </div>
              </motion.div>
            )}

            {/* ══ STEP 0: AI Intake Chat ══ */}
            {situationDone && step === 0 && (
              <motion.div key="intake" custom={dir} variants={slide} initial="enter" animate="center" exit="exit"
                className="flex flex-col" style={{ height: "calc(100vh - 180px)", maxHeight: 620 }}>
                <button
                  onClick={() => { setSituationDone(false); setMessages([]); setStreams([]); }}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors mb-3 self-start">
                  <ArrowLeft className="w-3 h-3" /> Change situation
                </button>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                    <BrainCircuit className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Mentorvix AI · Business Mapping Session</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <p className="text-xs text-slate-400">Online</p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-2">
                  {messages.map((m, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      {m.role === "assistant" && (
                        <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
                          style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                          <BrainCircuit className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                      <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                        m.role === "user"
                          ? "text-white rounded-tr-sm"
                          : "bg-white border border-slate-100 text-slate-800 rounded-tl-sm shadow-sm"
                      }`} style={m.role === "user" ? { background: "linear-gradient(135deg,#0e7490,#0891b2)" } : {}}>
                        {m.content}
                      </div>
                      {/* Speaker button — only on AI messages */}
                      {m.role === "assistant" && (
                        <button
                          onClick={() => speakMessage(m.content, i)}
                          title={speakingIdx === i ? "Stop" : "Read aloud"}
                          className={`ml-1.5 mt-1 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-all self-start ${
                            speakingIdx === i
                              ? "text-cyan-600 bg-cyan-50"
                              : "text-slate-300 hover:text-cyan-500 hover:bg-slate-50"
                          }`}>
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
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
                          {[0, 1, 2].map((i) => (
                            <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-slate-300"
                              animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }} />
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
                <div className="mt-3 flex items-end gap-2">
                  {/* Mic button */}
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    onClick={toggleMic}
                    title={micActive ? "Stop & send" : "Speak your answer"}
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
                    placeholder={micActive ? "Listening…" : "Type or speak your answer… (Enter to send)"}
                    className={`flex-1 resize-none px-4 py-3 border rounded-2xl text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 transition-all placeholder:text-slate-300 disabled:opacity-60 ${
                      micActive
                        ? "border-red-300 focus:border-red-400 focus:ring-red-400/20"
                        : "border-slate-200 focus:border-cyan-500 focus:ring-cyan-500/20"
                    }`} />

                  {/* Send button */}
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={sendIntake}
                    disabled={!input.trim() || aiTyping}
                    className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-md disabled:opacity-40 flex-shrink-0"
                    style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                    <Send className="w-4 h-4" />
                  </motion.button>
                </div>
                <p className="text-xs text-slate-300 text-center mt-2">Shift+Enter for new line · Enter to send</p>
              </motion.div>
            )}

            {/* ══ STEP 1: Stream Review ══ */}
            {step === 1 && (
              <motion.div key="review" custom={dir} variants={slide} initial="enter" animate="center" exit="exit" className="space-y-5">
                {/* Detection summary */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">AI Detection Complete</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    {streams.length} income source{streams.length !== 1 ? "s" : ""} detected
                  </h2>
                  <p className="text-slate-500 text-sm mt-1">
                    {detectedTypes.length} revenue model{detectedTypes.length !== 1 ? "s" : ""}:{" "}
                    {detectedTypes.map((t) => STREAM_META[t].label).join(" · ")}
                  </p>
                </div>

                {/* Stream cards */}
                <div className="space-y-2">
                  {streams.map((s, i) => {
                    const Meta = STREAM_META[s.type]; const Icon = Meta.icon;
                    return (
                      <motion.div key={s.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.07, ease: EASE }}
                        className="bg-white rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-3 p-4">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ background: Meta.bg }}>
                            <Icon className="w-4 h-4" style={{ color: Meta.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <EditableName value={s.name} onChange={(name) => updateStream({ ...s, name })} />
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {/* Type selector */}
                              <select value={s.type}
                                onChange={(e) => updateStream({ ...s, type: e.target.value as StreamType })}
                                className="text-xs text-slate-500 border border-slate-100 rounded-md px-1.5 py-0.5 bg-transparent focus:border-cyan-400 focus:outline-none cursor-pointer">
                                {Object.entries(STREAM_META).map(([k, v]) => (
                                  <option key={k} value={k}>{v.label}</option>
                                ))}
                              </select>
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full border ${CONF_STYLE[s.confidence]}`}>
                                {s.confidence === "high" ? "High" : s.confidence === "medium" ? "Medium" : "Low"} confidence
                              </span>
                            </div>
                          </div>
                          {deleteConfirmId === s.id ? (
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-xs text-red-500 font-medium whitespace-nowrap">Remove?</span>
                              <button
                                onClick={() => {
                                  setStreams((prev) => prev.filter((x) => x.id !== s.id));
                                  setDeleteConfirmId(null);
                                }}
                                className="text-xs font-semibold px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
                                Yes
                              </button>
                              <button onClick={() => setDeleteConfirmId(null)}
                                className="text-xs font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                                No
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteConfirmId(s.id)}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <div className="px-4 pb-3 ml-12">
                          <p className="text-xs text-slate-400">{Meta.desc}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const s = makeStream("New Revenue Stream", "custom", "low");
                      setStreams((p) => [...p, s]);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-200 text-sm font-medium text-slate-500 hover:border-cyan-400 hover:text-cyan-600 transition-colors">
                    <Plus className="w-4 h-4" /> Add stream manually
                  </button>
                  <button onClick={() => { setMessages([]); setStreams([]); go(0); }}
                    className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-500 hover:bg-slate-50 transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" /> Re-chat
                  </button>
                </div>

                <button onClick={() => { setStreamIdx(0); setDriverMode("chat"); go(2); }}
                  disabled={streams.length === 0}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                  Build Item-Level Revenue Data <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* ══ STEP 2: Per-Stream Driver Collection ══ */}
            {step === 2 && currentStream && (
              <motion.div key={`drivers-${currentStream.id}`} custom={dir} variants={slide} initial="enter" animate="center" exit="exit"
                className="space-y-4">

                {/* Stream progress dots */}
                <div className="flex items-center gap-2">
                  {streams.map((s, i) => {
                    const done = s.driverDone || s.items.length > 0;
                    return (
                      <button key={s.id} onClick={() => setStreamIdx(i)}
                        title={s.name}
                        className={`h-2 rounded-full transition-all ${i === streamIdx ? "w-6" : "w-2"} ${done ? "bg-emerald-500" : i === streamIdx ? "bg-cyan-600" : "bg-slate-200"}`} />
                    );
                  })}
                  <span className="text-xs text-slate-400 ml-1">
                    Stream {streamIdx + 1} of {streams.length}: <span className="font-medium text-slate-600">{currentStream.name}</span>
                  </span>
                </div>

                {/* Stream header */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: STREAM_META[currentStream.type].bg }}>
                    {(() => {
                      const Icon = STREAM_META[currentStream.type].icon;
                      return <Icon className="w-5 h-5" style={{ color: STREAM_META[currentStream.type].color }} />;
                    })()}
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-bold text-slate-900">{currentStream.name}</h2>
                    <p className="text-xs text-slate-500">
                      {STREAM_META[currentStream.type].label} · {STREAM_META[currentStream.type].desc}
                    </p>
                  </div>
                  {(currentStream.driverDone || currentStream.items.length > 0) && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {currentStream.items.length} items
                    </span>
                  )}
                </div>

                {/* Mode selector */}
                <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                  {([
                    { id: "chat"   as DriverMode, label: "AI Chat",        icon: BrainCircuit },
                    { id: "import" as DriverMode, label: "Import / Paste", icon: Upload },
                    { id: "manual" as DriverMode, label: "Manual",         icon: Pencil },
                  ]).map(({ id, label, icon: Icon }) => (
                    <button key={id} onClick={() => setDriverMode(id)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                        driverMode === id ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      }`}>
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>

                {/* Mode content */}
                {driverMode === "chat"   && <DriverChat
                  stream={currentStream}
                  onUpdate={updateStream}
                  situation={situation}
                  isFirstStream={streamIdx === 0}
                  onForecastYears={setForecastHorizon}
                  onForecastStart={(y, m) => { setForecastStartYear(y); setForecastStartMonth(m); }}
                  intakeContext={messages.map((m) => `${m.role === "user" ? "Client" : "AI"}: ${m.content}`).join("\n")}
                />}
                {driverMode === "import" && <ImportPane   stream={currentStream} onUpdate={updateStream} />}
                {driverMode === "manual" && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
                    Add items manually using the table below. Fill in name, category, volume and price.
                  </div>
                )}

                {/* Item table */}
                {currentStream.items.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Revenue Items — edit inline
                    </p>
                    <ItemTable stream={currentStream} onUpdate={updateStream} />
                  </div>
                )}

                {/* Add first item when no items yet in manual mode */}
                {driverMode === "manual" && currentStream.items.length === 0 && (
                  <ItemTable stream={currentStream} onUpdate={updateStream} />
                )}

                {/* Navigation */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      if (streamIdx > 0) {
                        setStreamIdx(streamIdx - 1);
                        setDriverMode("chat");
                      } else {
                        // Going back to review — clear driver messages for this stream so it restarts if re-entered
                        updateStream({ ...currentStream, driverMessages: [], items: [], driverDone: false });
                        go(1);
                      }
                    }}
                    className="flex items-center gap-2 px-5 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                  {streamIdx < streams.length - 1 ? (
                    <button onClick={() => { setStreamIdx(streamIdx + 1); setDriverMode("chat"); }}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20"
                      style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                      Next: {streams[streamIdx + 1]?.name} <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      disabled={!allStreamsReady}
                      onClick={async () => {
                        // Force-save all streams + items before entering forecast
                        // (debounced auto-save might not have fired yet)
                        if (appId && userId) {
                          try {
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
                            for (let i = 0; i < savedStreams.length; i++) {
                              const local = streams[i]; const db = savedStreams[i];
                              if (!local || !db) continue;
                              if (local.items.length > 0) {
                                await saveStreamItems(sb, db.id, userId, local.items.map((it, pos) => ({
                                  name: it.name, category: it.category, volume: it.volume, price: it.price,
                                  unit: it.unit, note: it.note, position: pos,
                                })));
                              }
                            }
                            await updateApplicationFlags(sb, appId, { drivers_done: true });
                          } catch (e) { console.error("[apply] pre-forecast save:", e); }
                        }
                        go(3);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-40"
                      style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                      <BarChart3 className="w-4 h-4" /> Generate Revenue Forecast
                    </button>
                  )}
                </div>
              </motion.div>
            )}

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
                  <h2 className="text-2xl font-bold text-slate-900">Multi-Year Revenue Projection</h2>
                  <p className="text-slate-500 text-sm mt-1">
                    {streams.length} stream{streams.length !== 1 ? "s" : ""} · item-level · by category · month by month
                  </p>
                </div>

                <ForecastView
                  streams={streams}
                  horizonYears={forecastHorizon}     setHorizonYears={setForecastHorizon}
                  startYear={forecastStartYear}      setStartYear={setForecastStartYear}
                  startMonth={forecastStartMonth}    setStartMonth={setForecastStartMonth}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button onClick={() => go(2)}
                    className="flex items-center justify-center gap-2 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Adjust Numbers
                  </button>
                  <button onClick={async () => {
                    const projection = projectRevenue(streams, 36, new Date());
                    // Save to localStorage immediately
                    const localData = { streams, projection };
                    localStorage.setItem("mvx_revenue_model", JSON.stringify(localData));

                    // Persist to Supabase in background
                    try {
                      const supabase = createClient();
                      const { data: { user } } = await supabase.auth.getUser();
                      if (user) {
                        const app = await getOrCreateApplication(supabase, user.id);
                        const savedStreams = await saveStreams(
                          supabase, app.id, user.id,
                          streams.map((s, i) => ({
                            name: s.name, type: s.type, confidence: s.confidence,
                            monthly_growth_pct: s.monthlyGrowthPct,
                            sub_new_per_month: s.subNewPerMonth,
                            sub_churn_pct: s.subChurnPct,
                            rental_occupancy_pct: s.rentalOccupancyPct,
                            driver_done: s.driverDone,
                            position: i,
                          })),
                        );
                        // Save items for each stream (match by position)
                        for (let idx = 0; idx < savedStreams.length; idx++) {
                          const localStream = streams[idx];
                          if (localStream?.items?.length) {
                            await saveStreamItems(
                              supabase, savedStreams[idx].id, user.id,
                              localStream.items.map((it, pos) => ({
                                name: it.name, category: it.category,
                                volume: it.volume, price: it.price,
                                unit: it.unit, note: it.note, position: pos,
                              })),
                            );
                          }
                        }
                        // Re-save with applicationId so dashboard can delete from DB
                        localStorage.setItem("mvx_revenue_model", JSON.stringify({
                          ...localData, applicationId: app.id,
                        }));
                      }
                    } catch (e) {
                      console.error("[apply] Supabase save error:", e);
                      // Non-blocking — local save already happened
                    }

                    router.push("/dashboard");
                  }}
                    className="flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20"
                    style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                    Save &amp; Continue Application <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
