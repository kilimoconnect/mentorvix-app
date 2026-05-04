"use client";

import React, {
  useState, useEffect, useRef, useCallback,
} from "react";
import { Mic, MicOff, Send as SendIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  saveStreams, saveStreamItems,
  saveIntakeConversation, saveDriverConversation,
  updateApplicationFlags,
} from "@/lib/supabase/revenue";
import { makeFmt } from "@/lib/utils/currency";
import {
  BarChart, Bar, Cell, XAxis, YAxis, ReferenceLine,
  ResponsiveContainer, Tooltip,
} from "recharts";

/* ─────────────────────────────────── types ── */

type StreamType = "product" | "service" | "subscription" | "rental" | "marketplace" | "contract" | "custom";
type Confidence = "high" | "medium" | "low";
type ChatMsg = { role: "user" | "assistant"; content: string };

interface DetectedStream { name: string; type: StreamType; confidence: Confidence; }

interface ParsedItem {
  id: string; name: string; category: string;
  volume: number; price: number; costPrice?: number; unit: string; note?: string;
}

interface GrowthProfile {
  trend: "growing" | "stable" | "fluctuating";
  monthlyVolumePct: number;
  annualPricePct: number;
}

type SeasonalityPreset =
  | "none"
  | "q4_peak" | "q1_slow" | "summer_peak" | "end_of_year" | "construction"
  | "wet_season" | "harvest" | "school_term" | "tourism_high" | "ramadan" | "back_to_school" | "mid_year_slow" | "agri_planting"
  | "custom";

interface SeasonalityProfile {
  variation: "none" | "mild" | "strong";
  preset: SeasonalityPreset;
  multipliers: number[];
}

interface WorkingStream {
  id: string;
  name: string;
  type: StreamType;
  confidence: Confidence;
  items: ParsedItem[];
  growth: GrowthProfile | null;
  seasonality: SeasonalityProfile | null;
  status: "pending" | "in_progress" | "completed";
}

type StreamPhase =
  | "intro" | "complexity" | "collect_chat" | "collect_paste"
  | "confirm_items" | "growth" | "confirm_growth"
  | "seasonality" | "confirm_seasonality" | "stream_summary";

type EnginePhase =
  | "detecting"
  | "confirm_streams"
  | { kind: "stream"; idx: number; phase: StreamPhase }
  | "confirm_model"
  | "done";

type CardData =
  | { type: "confirm_streams"; streams: DetectedStream[] }
  | { type: "complexity" }
  | { type: "paste_data"; streamName: string }
  | { type: "confirm_items"; items: ParsedItem[] }
  | { type: "growth" }
  | { type: "confirm_growth"; profile: GrowthProfile }
  | { type: "seasonality"; streamType: StreamType }
  | { type: "confirm_seasonality"; profile: SeasonalityProfile }
  | { type: "stream_summary"; stream: WorkingStream }
  | { type: "confirm_model"; streams: WorkingStream[] };

type FeedItemInput =
  | { kind: "ai"; text: string }
  | { kind: "user"; text: string }
  | { kind: "typing" }
  | { kind: "divider"; text: string; color: "slate" | "cyan" | "emerald" | "violet" }
  | { kind: "card"; resolved: boolean; resolvedLabel?: string; card: CardData };

type FeedItem = FeedItemInput & { id: number };

/* ─────────────────────────────────── props ── */

interface RevenueEngineProps {
  situation:         string | null;
  appId:             string | null;
  userId:            string | null;
  currency:          string | null;
  onStreamsDetected:  (streams: WorkingStream[]) => void;
  onItemsSaved:      (streamId: string, streamName: string, items: ParsedItem[]) => void;
  onForecastYears:   (y: number) => void;
  onForecastStart:   (year: number, month: number) => void;
  onComplete:        () => void;
}

/* ─────────────────────────────────── constants ── */

const SEASONALITY_PRESETS: Record<SeasonalityPreset, { label: string; multipliers: number[] }> = {
  none:          { label: "No seasonal variation",  multipliers: Array(12).fill(1) },
  // ── Original 5 ──
  q4_peak:       { label: "Q4 Retail Peak",         multipliers: [0.82,0.80,0.90,0.92,0.95,0.98,0.95,0.92,1.00,1.05,1.20,1.51] },
  q1_slow:       { label: "Q1 Slow Start",          multipliers: [0.75,0.78,0.95,1.05,1.10,1.12,1.12,1.08,1.02,1.02,1.00,1.01] },
  summer_peak:   { label: "Summer Peak",            multipliers: [0.80,0.82,0.90,1.00,1.08,1.20,1.28,1.22,1.10,0.98,0.90,0.72] },
  end_of_year:   { label: "Year-End Corporate",     multipliers: [0.88,0.88,0.92,0.95,1.00,1.00,0.92,0.95,1.05,1.10,1.18,1.17] },
  construction:  { label: "Dry Season Peak",        multipliers: [1.15,1.18,1.20,1.10,1.05,0.85,0.80,0.82,0.90,1.00,1.05,0.90] },
  // ── New patterns ──
  wet_season:    { label: "Wet Season Slowdown",    multipliers: [1.10,1.05,1.00,0.90,0.75,0.65,0.60,0.65,0.80,1.00,1.10,1.15] },  // dry months peak, rainy months slow
  harvest:       { label: "Harvest Season",         multipliers: [0.85,0.82,0.90,0.95,1.00,0.95,0.90,0.95,1.05,1.25,1.35,1.03] },  // Oct–Nov harvest spike
  school_term:   { label: "School Term Peak",       multipliers: [1.00,1.05,1.10,1.05,1.05,0.70,0.65,0.70,1.20,1.25,1.15,0.80] },  // holidays dip, term peaks
  tourism_high:  { label: "Tourism High Season",    multipliers: [1.30,1.25,1.15,1.05,0.90,0.80,0.85,0.90,0.95,1.00,1.10,1.35] },  // Jan + Dec peak
  ramadan:       { label: "Ramadan / Eid Surge",    multipliers: [0.95,0.95,1.50,1.60,1.20,0.90,0.85,0.88,0.90,0.92,0.95,1.40] },  // Mar–Apr surge, Dec festive
  back_to_school:{ label: "Back-to-School Spike",   multipliers: [1.10,1.05,0.95,0.92,0.90,0.80,0.80,1.45,1.35,1.10,0.92,0.72] },  // Aug–Sep spike
  mid_year_slow: { label: "Mid-Year Slowdown",      multipliers: [1.10,1.05,1.02,0.95,0.85,0.75,0.72,0.78,0.95,1.10,1.15,1.18] },  // Jun–Aug trough
  agri_planting: { label: "Agri Planting Cycle",    multipliers: [0.80,0.82,1.10,1.30,1.20,0.90,0.75,0.80,0.85,1.00,1.05,0.93] },  // Mar–May planting spend
  custom:        { label: "Custom",                 multipliers: Array(12).fill(1) },
};

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const STREAM_META: Record<StreamType, { label: string; color: string; bg: string }> = {
  product:      { label: "Product Sales",            color: "#0e7490", bg: "#f0f9ff" },
  service:      { label: "Service / Project",        color: "#7c3aed", bg: "#faf5ff" },
  subscription: { label: "Subscription / MRR",       color: "#059669", bg: "#f0fdf4" },
  rental:       { label: "Rental / Lease",           color: "#b45309", bg: "#fffbeb" },
  marketplace:  { label: "Marketplace / Commission", color: "#e11d48", bg: "#fff1f2" },
  contract:     { label: "Contract / B2B Deal",      color: "#0f766e", bg: "#f0fdfa" },
  custom:       { label: "Custom / Processing",      color: "#6366f1", bg: "#eef2ff" },
};

/* ─────────────────────────────────── parse helpers ── */

function parseStreams(text: string): DetectedStream[] | null {
  const idx = text.indexOf("[STREAMS_DETECTED]");
  if (idx === -1) return null;
  try {
    const jsonStr = text.slice(idx + "[STREAMS_DETECTED]".length).trim();
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) return parsed as DetectedStream[];
  } catch { /* fall through */ }
  return null;
}

function parseItems(text: string): ParsedItem[] | null {
  const idx = text.indexOf("[ITEMS_DETECTED]");
  if (idx === -1) return null;
  try {
    let jsonStr = text.slice(idx + "[ITEMS_DETECTED]".length).trim();
    // Strip trailing detection tags so JSON.parse doesn't choke
    const nextTag = jsonStr.search(/\[FORECAST_YEARS\]|\[FORECAST_START\]/);
    if (nextTag !== -1) jsonStr = jsonStr.slice(0, nextTag).trim();
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return (parsed as ParsedItem[]).map((it, i) => ({
        ...it,
        id: it.id ?? `item-${i}-${Date.now()}`,
      }));
    }
  } catch { /* fall through */ }
  return null;
}

function parseForecastYears(text: string): number | null {
  const match = text.match(/\[FORECAST_YEARS:(\d+)\]/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return isNaN(n) ? null : n;
}

function parseForecastStart(text: string): { year: number; month: number } | null {
  const match = text.match(/\[FORECAST_START:(\d{4})-(\d{1,2})\]/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (isNaN(year) || isNaN(month)) return null;
  return { year, month };
}

/* ─────────────────────────────────── session persistence ── */
interface SavedSession {
  feed: FeedItem[];
  streams: WorkingStream[];
  phase: EnginePhase;
  intakeMsgs: ChatMsg[];
  driverMsgs: ChatMsg[];
  intakeCtx: string;
  pendingItems: ParsedItem[];
  pendingGrowth: GrowthProfile | null;
  pendingSeasonality: SeasonalityProfile | null;
  inputVal: string;
  savedAt: number;
}

function inputLockForPhase(phase: EnginePhase): boolean {
  if (phase === "done" || phase === "confirm_streams" || phase === "confirm_model") return true;
  if (typeof phase === "object" && phase.kind === "stream") {
    const sp = phase.phase;
    return sp !== "collect_chat" && sp !== "collect_paste";
  }
  return false; /* detecting — input is active for intake chat */
}

/* ─────────────────────────────────── tabular paste parser ── */
/**
 * Fast client-side parser for structured tabular data (tab, pipe, comma).
 * Handles any column order by reading the header row keywords.
 * Returns null if the input doesn't look like a table (fall through to AI).
 */
function parseTabularData(raw: string): ParsedItem[] | null {
  const lines = raw.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;

  // Detect separator: prefer tab, then pipe, then comma
  const firstLine = lines[0];
  const sep = firstLine.includes("\t") ? "\t"
    : firstLine.includes("|") ? "|"
    : firstLine.includes(",") ? ","
    : null;
  if (!sep) return null;

  const headers = firstLine.split(sep).map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));

  // Map header keywords → column indices
  const nameIdx  = headers.findIndex(h => /name|product|item|service|description|desc/.test(h));
  const volIdx   = headers.findIndex(h => /vol|unit|qty|quant|amount|count|sales/.test(h));
  const priceIdx = headers.findIndex(h => /price|sell|rate|rev|value/.test(h));
  const costIdx  = headers.findIndex(h => /cost|cogs|buy|purchase|wholesale/.test(h));

  // Need at least a name column and a price column in the header
  if (nameIdx === -1 || priceIdx === -1) return null;

  const items: ParsedItem[] = [];
  let counter = 0;

  for (const line of lines.slice(1)) {
    const parts = line.split(sep).map(p => p.trim().replace(/,/g, ""));
    const name = parts[nameIdx];
    if (!name) continue;

    const price  = parseFloat(parts[priceIdx] ?? "");
    const volume = volIdx  !== -1 ? parseFloat(parts[volIdx]  ?? "") : NaN;
    const cost   = costIdx !== -1 ? parseFloat(parts[costIdx] ?? "") : NaN;

    if (!name || isNaN(price)) continue;

    items.push({
      id:        `paste-${++counter}`,
      name,
      category:  "General",
      volume:    isNaN(volume) ? 1 : volume,
      price,
      costPrice: isNaN(cost) ? undefined : cost,
      unit:      "unit",
    });
  }

  return items.length > 0 ? items : null;
}

/* ─────────────────────────────────── uid helper ── */
let _uid = 0;
function uid() { return ++_uid; }

/* ─────────────────────────────────── sub-components (cards) ── */

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3 bg-slate-50 rounded-2xl w-fit max-w-[85%]">
      {[0,1,2].map(i => (
        <span
          key={i}
          className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

interface ResolvedChipProps { label: string; }
function ResolvedChip({ label }: ResolvedChipProps) {
  return (
    <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-sm font-medium">
      <span>✓</span> {label}
    </span>
  );
}

/* ── ConfirmStreamsCard ── */
interface ConfirmStreamsCardProps {
  streams: DetectedStream[];
  onConfirm: (streams: DetectedStream[]) => void;
  onEdit: () => void;
}
function ConfirmStreamsCard({ streams, onConfirm, onEdit }: ConfirmStreamsCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
      {/* header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-5 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <p className="text-xs font-bold uppercase tracking-widest text-slate-300">Confirm Before Continuing</p>
          </div>
          <p className="text-white font-bold text-base">Revenue Streams Detected</p>
        </div>
        <span className="bg-white/10 text-white text-xs font-bold px-2.5 py-1 rounded-full">
          {streams.length} stream{streams.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* stream list */}
      <div className="divide-y divide-slate-50">
        {streams.map((s, i) => {
          const meta = STREAM_META[s.type];
          return (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
              <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[11px] font-bold"
                style={{ background: meta.bg, color: meta.color }}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                <p className="text-[11px] text-slate-400" style={{ color: meta.color }}>{meta.label}</p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                s.confidence === "high"   ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                s.confidence === "medium" ? "bg-amber-50 text-amber-600 border border-amber-100" :
                                            "bg-rose-50 text-rose-600 border border-rose-100"
              }`}>
                {s.confidence} confidence
              </span>
            </div>
          );
        })}
      </div>

      {/* footer */}
      <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
        <p className="text-[11px] text-slate-400">These streams will be set up one at a time</p>
        <div className="flex gap-2.5">
          <button onClick={onEdit}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white transition-all">
            Edit
          </button>
          <button onClick={() => onConfirm(streams)}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-200 transition-all flex items-center gap-2">
            Confirm Streams →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── ComplexityCard ── */
interface ComplexityCardProps {
  onSelect: (choice: "under20" | "20to100" | "more100") => void;
}
function ComplexityCard({ onSelect }: ComplexityCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <p className="text-slate-700 text-sm font-medium mb-4">How many products/items are in this stream?</p>
      <div className="flex flex-wrap gap-3">
        {(["under20","20to100","more100"] as const).map(v => (
          <button
            key={v}
            onClick={() => onSelect(v)}
            className="px-4 py-2 border border-cyan-300 text-cyan-700 rounded-full text-sm font-medium hover:bg-cyan-50 transition-colors"
          >
            {v === "under20" ? "Under 20" : v === "20to100" ? "20–100" : "More than 100"}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── PasteDataCard ── */
interface PasteDataCardProps {
  streamName: string;
  onExtract: (text: string) => void;
}
function PasteDataCard({ streamName, onExtract }: PasteDataCardProps) {
  const [text, setText] = useState("");
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

      {/* header */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-slate-800">Paste Your Products</h3>
          <span className="text-[11px] text-slate-400 truncate max-w-[55%] text-right">{streamName}</span>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          One product per line. Use any format that feels natural — the AI will extract the data.
        </p>
      </div>

      {/* format strip */}
      <div className="px-5 pt-3 pb-2">
        <div className="flex items-center gap-1.5 font-mono text-[11px] bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 select-none">
          <span className="font-bold text-cyan-700">Product name</span>
          <span className="text-slate-300">·</span>
          <span className="font-semibold text-slate-600">monthly qty</span>
          <span className="text-slate-300">·</span>
          <span className="font-semibold text-slate-600">selling price</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-400 italic">cost (optional)</span>
        </div>
      </div>

      {/* examples — two accepted styles */}
      <div className="px-5 pb-3">
        <p className="text-[10px] uppercase tracking-widest text-slate-300 mb-1.5 font-semibold">Accepted formats</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Columns (pipe or tab)</p>
            <div className="font-mono text-[11px] text-slate-500 space-y-0.5 leading-relaxed">
              <p>Item A &nbsp;| 50 | 25,000 | 18,000</p>
              <p>Item B &nbsp;| 30 | 18,000</p>
              <p>Item C &nbsp;| 20 | 45,000 | 32,000</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Commas or free text</p>
            <div className="font-mono text-[11px] text-slate-500 space-y-0.5 leading-relaxed">
              <p>Item A, 50 units, 25000</p>
              <p>Item B — 30/mo at 18,000</p>
              <p>50 bags of Item C at 45k</p>
            </div>
          </div>
        </div>
      </div>

      {/* textarea */}
      <div className="px-5 pb-3">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={7}
          className="w-full border border-slate-200 rounded-xl px-3 py-3 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-300 resize-none"
          placeholder={"Type or paste your products here…\nEstimates are fine — round numbers work."}
        />
      </div>

      {/* footer */}
      <div className="px-5 pb-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-400 leading-snug">
          Works with Excel copy-paste, Google Sheets,<br/>
          or anything you type in your own words.
        </p>
        <button
          onClick={() => { if (text.trim()) onExtract(text.trim()); }}
          disabled={!text.trim()}
          className="flex-shrink-0 px-5 py-2 bg-cyan-600 text-white rounded-xl text-sm font-bold hover:bg-cyan-700 transition-colors disabled:opacity-40 shadow-sm shadow-cyan-200"
        >
          Extract →
        </button>
      </div>
    </div>
  );
}

/* ── ConfirmItemsCard ── */
interface ConfirmItemsCardProps {
  items: ParsedItem[];
  currency: string | null;
  onConfirm: () => void;
  onEdit: () => void;
}
function ConfirmItemsCard({ items, currency, onConfirm, onEdit }: ConfirmItemsCardProps) {
  const totalMonthlyRev = items.reduce((s, it) => s + it.volume * it.price, 0);
  const fmt = makeFmt(currency);
  const hasCost = items.some(it => it.costPrice != null);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
      {/* header */}
      <div className="bg-gradient-to-r from-red-50 to-orange-50 border-b border-red-100 px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <p className="text-sm font-bold text-slate-800">Confirm Detected Items</p>
          <span className="px-2 py-0.5 bg-white border border-slate-200 rounded-full text-[11px] font-semibold text-slate-600">
            {items.length} item{items.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Est. Monthly Revenue</p>
          <p className="text-sm font-bold text-emerald-700">{fmt(totalMonthlyRev)}</p>
        </div>
      </div>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left py-2 px-4 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Product / Item</th>
              <th className="text-right py-2 px-3 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Monthly Volume</th>
              <th className="text-left py-2 px-3 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Unit</th>
              <th className="text-right py-2 px-3 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Selling Price</th>
              {hasCost && <th className="text-right py-2 px-3 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Cost Price</th>}
              <th className="text-right py-2 px-4 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Monthly Rev.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id} className={`border-b border-slate-50 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"} hover:bg-cyan-50/40 transition-colors`}>
                <td className="py-2.5 px-4 font-semibold text-slate-800">{it.name}
                  {it.category && it.category !== "General" && (
                    <span className="ml-1.5 text-[10px] font-normal text-slate-400">{it.category}</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right text-slate-700 font-medium">{it.volume.toLocaleString()}</td>
                <td className="py-2.5 px-3 text-slate-500">{it.unit}</td>
                <td className="py-2.5 px-3 text-right text-slate-700">{it.price.toLocaleString()}</td>
                {hasCost && <td className="py-2.5 px-3 text-right text-slate-500">{it.costPrice != null ? it.costPrice.toLocaleString() : <span className="text-slate-300">—</span>}</td>}
                <td className="py-2.5 px-4 text-right font-semibold text-emerald-700">{fmt(it.volume * it.price)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-emerald-50 border-t border-emerald-100">
              <td colSpan={hasCost ? 5 : 4} className="py-2.5 px-4 text-xs font-semibold text-slate-600 uppercase tracking-wide">Total Monthly Revenue</td>
              <td className="py-2.5 px-4 text-right font-bold text-emerald-700 text-sm">{fmt(totalMonthlyRev)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* footer actions */}
      <div className="px-5 py-4 flex items-center justify-between bg-white border-t border-slate-100">
        <p className="text-[11px] text-slate-400">Review the table above — edit if anything looks wrong before confirming</p>
        <div className="flex gap-2.5">
          <button onClick={onEdit}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-all">
            Edit
          </button>
          <button onClick={onConfirm}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-200 transition-all">
            Confirm &amp; Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── GrowthCard ── */
interface GrowthCardProps {
  onConfirm: (profile: GrowthProfile) => void;
}
function GrowthCard({ onConfirm }: GrowthCardProps) {
  const [trend, setTrend] = useState<GrowthProfile["trend"] | null>(null);
  const [monthlyVol, setMonthlyVol] = useState("");
  const [annualPrice, setAnnualPrice] = useState("");

  function handleTrend(t: GrowthProfile["trend"]) {
    setTrend(t);
    if (t === "growing")    { setMonthlyVol("2.0"); setAnnualPrice("5.0"); }
    if (t === "stable")     { setMonthlyVol("0");   setAnnualPrice("0"); }
    if (t === "fluctuating"){ setMonthlyVol("1.0"); setAnnualPrice("3.0"); }
  }

  function handleConfirm() {
    if (!trend) return;
    onConfirm({
      trend,
      monthlyVolumePct: parseFloat(monthlyVol) || 0,
      annualPricePct:   parseFloat(annualPrice) || 0,
    });
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <p className="text-slate-700 text-sm font-medium mb-4">How are sales performing for this stream?</p>
      <div className="flex flex-wrap gap-3 mb-5">
        {([
          { v: "growing" as const,     label: "📈 Growing" },
          { v: "stable" as const,      label: "➡ Stable" },
          { v: "fluctuating" as const, label: "〜 Fluctuating" },
        ]).map(opt => (
          <button
            key={opt.v}
            onClick={() => handleTrend(opt.v)}
            className={`px-4 py-2 border rounded-full text-sm font-medium transition-colors ${
              trend === opt.v
                ? "bg-cyan-600 border-cyan-600 text-white"
                : "border-cyan-300 text-cyan-700 hover:bg-cyan-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {trend && trend !== "stable" && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Monthly volume growth %</label>
            <input
              type="number"
              value={monthlyVol}
              onChange={e => setMonthlyVol(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Annual price growth %</label>
            <input
              type="number"
              value={annualPrice}
              onChange={e => setAnnualPrice(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </div>
        </div>
      )}
      {trend && (
        <button
          onClick={handleConfirm}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          Confirm Growth
        </button>
      )}
    </div>
  );
}

/* ── ConfirmGrowthCard ── */
interface ConfirmGrowthCardProps {
  profile: GrowthProfile;
  onConfirm: () => void;
  onAdjust: () => void;
}
function ConfirmGrowthCard({ profile, onConfirm, onAdjust }: ConfirmGrowthCardProps) {
  const effectiveCombined = ((1 + profile.monthlyVolumePct / 100) ** 12 - 1) * 100 + profile.annualPricePct;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 border-l-4 border-l-red-400">
      <h3 className="font-semibold text-slate-800 mb-4">Growth Profile</h3>
      <dl className="grid grid-cols-2 gap-y-2 text-sm mb-5">
        <dt className="text-slate-500">Trend</dt>
        <dd className="text-slate-800 font-medium capitalize">{profile.trend}</dd>
        <dt className="text-slate-500">Monthly volume growth</dt>
        <dd className="text-slate-800 font-medium">{profile.monthlyVolumePct}%</dd>
        <dt className="text-slate-500">Annual price growth</dt>
        <dd className="text-slate-800 font-medium">{profile.annualPricePct}%</dd>
        <dt className="text-slate-500">Effective combined rate</dt>
        <dd className="text-slate-800 font-medium">{effectiveCombined.toFixed(1)}% / yr</dd>
      </dl>
      <div className="flex gap-3">
        <button onClick={onConfirm} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">Confirm</button>
        <button onClick={onAdjust} className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Adjust</button>
      </div>
    </div>
  );
}

/* ── SeasonalityChart ── shared between SeasonalityCard and ConfirmSeasonalityCard */
function SeasonalityChart({ multipliers, height = 110 }: { multipliers: number[]; height?: number }) {
  const data = multipliers.map((v, i) => ({
    month: MONTHS_SHORT[i],
    pct:   Math.round(v * 100),
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }} barCategoryGap="20%">
        <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 500]} tick={{ fontSize: 9, fill: "#cbd5e1" }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} tickCount={5} />
        <Tooltip
          formatter={(v) => [`${v}%`, "Index"]}
          contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0", padding: "4px 10px" }}
          cursor={{ fill: "#f1f5f9" }}
        />
        <ReferenceLine y={100} stroke="#e2e8f0" strokeDasharray="4 2" />
        <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.pct >= 100 ? "#0891b2" : "#f59e0b"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── SeasonalityCard ── */
interface SeasonalityCardProps {
  streamType: StreamType;
  onConfirm: (profile: SeasonalityProfile) => void;
}
function SeasonalityCard({ onConfirm }: SeasonalityCardProps) {
  const [variation, setVariation] = useState<SeasonalityProfile["variation"] | null>(null);
  const [preset, setPreset]       = useState<SeasonalityPreset>("q4_peak");
  /* custom multipliers — 12 months, default 1.0 */
  const [custom, setCustom] = useState<number[]>(Array(12).fill(1));

  const presetOptions: Array<{ value: SeasonalityPreset; label: string }> = [
    { value: "q4_peak",        label: "Q4 Retail Peak" },
    { value: "q1_slow",        label: "Q1 Slow Start" },
    { value: "summer_peak",    label: "Summer Peak" },
    { value: "end_of_year",    label: "Year-End Corporate" },
    { value: "construction",   label: "Dry Season Peak" },
    { value: "wet_season",     label: "Wet Season Slowdown" },
    { value: "harvest",        label: "Harvest Season" },
    { value: "school_term",    label: "School Term Peak" },
    { value: "tourism_high",   label: "Tourism High Season" },
    { value: "ramadan",        label: "Ramadan / Eid Surge" },
    { value: "back_to_school", label: "Back-to-School Spike" },
    { value: "mid_year_slow",  label: "Mid-Year Slowdown" },
    { value: "agri_planting",  label: "Agri Planting Cycle" },
    { value: "custom",         label: "Custom ✏️" },
  ];

  const activeMultipliers = preset === "custom" ? custom : SEASONALITY_PRESETS[preset].multipliers;

  function handleConfirm() {
    if (!variation) return;
    const effectivePreset: SeasonalityPreset = variation === "none" ? "none" : preset;
    const mults = effectivePreset === "none" ? Array(12).fill(1)
      : effectivePreset === "custom" ? custom
      : SEASONALITY_PRESETS[effectivePreset].multipliers;
    onConfirm({ variation, preset: effectivePreset, multipliers: mults });
  }

  function setMonthMultiplier(monthIdx: number, value: number) {
    setCustom(prev => prev.map((v, i) => i === monthIdx ? value : v));
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <p className="text-sm font-semibold text-slate-800">Does revenue vary by month?</p>
        <p className="text-xs text-slate-400 mt-0.5">Select the variation level, then pick or draw your pattern.</p>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Variation level */}
        <div className="flex flex-wrap gap-2">
          {([
            { v: "none"   as const, label: "No variation" },
            { v: "mild"   as const, label: "Mild" },
            { v: "strong" as const, label: "Strong" },
          ]).map(opt => (
            <button
              key={opt.v}
              onClick={() => setVariation(opt.v)}
              className={`px-4 py-1.5 border rounded-full text-sm font-medium transition-all ${
                variation === opt.v
                  ? "bg-cyan-600 border-cyan-600 text-white shadow-sm"
                  : "border-slate-200 text-slate-600 hover:border-cyan-300 hover:bg-cyan-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Pattern selector — only when variation is not none */}
        {variation && variation !== "none" && (
          <>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Seasonality Pattern</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {presetOptions.map(o => (
                  <button
                    key={o.value}
                    onClick={() => setPreset(o.value)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-left ${
                      preset === o.value
                        ? "bg-cyan-600 border-cyan-600 text-white"
                        : "border-slate-200 text-slate-600 hover:border-cyan-300 hover:bg-slate-50"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chart preview */}
            <div className="bg-slate-50 rounded-xl px-3 pt-3 pb-1 border border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {preset === "custom" ? "Your Custom Pattern" : SEASONALITY_PRESETS[preset].label}
                </p>
                <p className="text-[10px] text-slate-400">Blue = above baseline · Amber = below</p>
              </div>
              <SeasonalityChart multipliers={activeMultipliers} height={100} />
            </div>

            {/* Custom month sliders */}
            {preset === "custom" && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Set each month — 1.0 = baseline, 2.0 = double, 5.0 = 5× peak
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {/* Left col: Jan–Jun (0–5) | Right col: Jul–Dec (6–11) */}
                  {[0,1,2,3,4,5].map((i) => (
                    <React.Fragment key={i}>
                      {/* Left: month i */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-500 w-7 flex-shrink-0">{MONTHS_SHORT[i]}</span>
                        <input
                          type="range"
                          min={0} max={5} step={0.1}
                          value={custom[i]}
                          onChange={e => setMonthMultiplier(i, parseFloat(e.target.value))}
                          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                          style={{ accentColor: custom[i] >= 1 ? "#0891b2" : "#f59e0b" }}
                        />
                        <span className="text-[11px] font-mono font-bold w-8 text-right flex-shrink-0"
                          style={{ color: custom[i] >= 1 ? "#0891b2" : "#f59e0b" }}>
                          {custom[i].toFixed(1)}
                        </span>
                      </div>
                      {/* Right: month i+6 */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-500 w-7 flex-shrink-0">{MONTHS_SHORT[i + 6]}</span>
                        <input
                          type="range"
                          min={0} max={5} step={0.1}
                          value={custom[i + 6]}
                          onChange={e => setMonthMultiplier(i + 6, parseFloat(e.target.value))}
                          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                          style={{ accentColor: custom[i + 6] >= 1 ? "#0891b2" : "#f59e0b" }}
                        />
                        <span className="text-[11px] font-mono font-bold w-8 text-right flex-shrink-0"
                          style={{ color: custom[i + 6] >= 1 ? "#0891b2" : "#f59e0b" }}>
                          {custom[i + 6].toFixed(1)}
                        </span>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {variation && (
        <div className="px-5 pb-4">
          <button
            onClick={handleConfirm}
            className="w-full py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors shadow-sm shadow-emerald-200"
          >
            Confirm Seasonality →
          </button>
        </div>
      )}
    </div>
  );
}

/* ── ConfirmSeasonalityCard ── */
interface ConfirmSeasonalityCardProps {
  profile: SeasonalityProfile;
  onConfirm: () => void;
  onEdit: () => void;
}
function ConfirmSeasonalityCard({ profile, onConfirm, onEdit }: ConfirmSeasonalityCardProps) {
  const presetLabel = profile.preset === "custom" ? "Custom Pattern"
    : (SEASONALITY_PRESETS[profile.preset]?.label ?? profile.preset);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
      {/* header */}
      <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-violet-100 px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-violet-500" />
          <p className="text-sm font-bold text-slate-800">Seasonality Confirmed</p>
        </div>
        <span className="text-[11px] font-semibold text-violet-700 bg-white border border-violet-100 px-2 py-0.5 rounded-full capitalize">
          {presetLabel}
        </span>
      </div>

      {/* chart */}
      {profile.variation !== "none" && (
        <div className="px-5 pt-4 pb-2 bg-slate-50">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Monthly Revenue Index</p>
          <SeasonalityChart multipliers={profile.multipliers} height={90} />
          <p className="text-[10px] text-slate-400 text-right mt-1">Blue = above baseline · Amber = below baseline</p>
        </div>
      )}

      {/* summary row */}
      <div className="px-5 py-3 flex items-center gap-4 text-xs text-slate-600 border-t border-slate-100">
        <span className="capitalize"><span className="font-semibold">Variation:</span> {profile.variation}</span>
        {profile.variation !== "none" && (() => {
          const max = Math.max(...profile.multipliers);
          const min = Math.min(...profile.multipliers);
          const peakMonth = MONTHS_SHORT[profile.multipliers.indexOf(max)];
          const slowMonth = MONTHS_SHORT[profile.multipliers.indexOf(min)];
          return (
            <>
              <span><span className="font-semibold text-cyan-700">Peak:</span> {peakMonth} ({Math.round(max*100)}%)</span>
              <span><span className="font-semibold text-amber-600">Slow:</span> {slowMonth} ({Math.round(min*100)}%)</span>
            </>
          );
        })()}
      </div>

      {/* footer */}
      <div className="px-5 pb-4 flex gap-2.5 border-t border-slate-100 pt-3">
        <button onClick={onEdit}
          className="px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-all">
          Edit
        </button>
        <button onClick={onConfirm}
          className="flex-1 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-200 transition-all">
          Confirm Seasonality →
        </button>
      </div>
    </div>
  );
}

/* ── StreamSummaryCard ── */
interface StreamSummaryCardProps {
  stream: WorkingStream;
  currency: string | null;
  onConfirm: () => void;
  onEdit: () => void;
}
function StreamSummaryCard({ stream, currency, onConfirm, onEdit }: StreamSummaryCardProps) {
  const fmt = makeFmt(currency);
  const monthlyRevenue = stream.items.reduce((sum, it) => sum + it.volume * it.price, 0);
  const seasonPreset = stream.seasonality ? SEASONALITY_PRESETS[stream.seasonality.preset]?.label : "None";
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 border-l-4 border-l-emerald-400">
      <div className="flex items-center gap-2 mb-4">
        <span>✓</span>
        <h3 className="font-semibold text-slate-800">Stream Complete: {stream.name}</h3>
      </div>
      <dl className="grid grid-cols-2 gap-y-2 text-sm mb-5">
        <dt className="text-slate-500">Items</dt>
        <dd className="text-slate-800 font-medium">{stream.items.length}</dd>
        <dt className="text-slate-500">Monthly Revenue</dt>
        <dd className="text-slate-800 font-medium">{fmt(monthlyRevenue)}</dd>
        <dt className="text-slate-500">Growth</dt>
        <dd className="text-slate-800 font-medium capitalize">{stream.growth?.trend ?? "—"}</dd>
        <dt className="text-slate-500">Seasonality</dt>
        <dd className="text-slate-800 font-medium">{seasonPreset}</dd>
      </dl>
      <div className="flex gap-3">
        <button onClick={onConfirm} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">Confirm Stream</button>
        <button onClick={onEdit} className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Edit</button>
      </div>
    </div>
  );
}

/* ── ConfirmModelCard ── */
interface ConfirmModelCardProps {
  streams: WorkingStream[];
  currency: string | null;
  onConfirm: () => void;
  onEdit: () => void;
}
function ConfirmModelCard({ streams, currency, onConfirm, onEdit }: ConfirmModelCardProps) {
  const fmt = makeFmt(currency);
  const totalRevenue = streams.reduce(
    (sum, s) => sum + s.items.reduce((ss, it) => ss + it.volume * it.price, 0), 0
  );
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 border-l-4 border-l-blue-400">
      <div className="flex items-center gap-2 mb-4">
        <span>🔴</span>
        <h3 className="font-semibold text-slate-800">Revenue Model Ready</h3>
      </div>
      <div className="overflow-x-auto mb-5">
        <table className="w-full text-xs text-slate-600">
          <thead>
            <tr className="border-b border-slate-100">
              {["Stream","Items","Monthly Revenue"].map(h => (
                <th key={h} className="text-left py-1.5 px-2 font-medium text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {streams.map(s => {
              const rev = s.items.reduce((sum, it) => sum + it.volume * it.price, 0);
              return (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 px-2 font-medium">{s.name}</td>
                  <td className="py-1.5 px-2">{s.items.length}</td>
                  <td className="py-1.5 px-2">{fmt(rev)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200">
              <td className="py-2 px-2 font-semibold text-slate-700" colSpan={2}>Total Monthly Revenue</td>
              <td className="py-2 px-2 font-semibold text-slate-800">{fmt(totalRevenue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex gap-3">
        <button onClick={onConfirm} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
          Confirm &amp; View Forecast
        </button>
        <button onClick={onEdit} className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Edit Model</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────── progress panel ── */
interface ProgressPanelProps { streams: WorkingStream[]; }
function ProgressPanel({ streams }: ProgressPanelProps) {
  const completed = streams.filter(s => s.status === "completed").length;
  const pct = streams.length > 0 ? Math.round((completed / streams.length) * 100) : 0;
  return (
    <div className="w-56 flex-shrink-0">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sticky top-4">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Revenue Streams</h4>
        <ul className="space-y-3 mb-5">
          {streams.length === 0 && (
            <li className="text-xs text-slate-400 italic">Detecting streams…</li>
          )}
          {streams.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <span className={
                s.status === "completed" ? "text-emerald-600 font-bold" :
                s.status === "in_progress" ? "text-cyan-600" :
                "text-slate-300"
              }>
                {s.status === "completed" ? "✓" : s.status === "in_progress" ? "⏳" : "○"}
              </span>
              <span className={`truncate ${
                s.status === "completed" ? "text-slate-600" :
                s.status === "in_progress" ? "text-slate-800 font-medium" :
                "text-slate-400"
              }`}>
                {s.name}
              </span>
            </li>
          ))}
        </ul>
        {streams.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500">Progress</span>
              <span className="text-xs font-medium text-slate-700">{pct}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5">
              <div
                className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────── feed renderer ── */
interface FeedRendererProps {
  feed: FeedItem[];
  currency: string | null;
  onCardAction: (id: number, action: string, payload?: unknown) => void;
}
function FeedRenderer({ feed, currency, onCardAction }: FeedRendererProps) {
  return (
    <>
      {feed.map(item => {
        if (item.kind === "ai") {
          return (
            <div key={item.id} className="flex justify-start">
              <div className="max-w-[85%] bg-slate-50 rounded-2xl px-4 py-3 text-sm text-slate-700 leading-relaxed">
                {item.text}
              </div>
            </div>
          );
        }
        if (item.kind === "user") {
          return (
            <div key={item.id} className="flex justify-end">
              <div className="max-w-[75%] bg-cyan-600 text-white rounded-2xl px-4 py-3 text-sm leading-relaxed">
                {item.text}
              </div>
            </div>
          );
        }
        if (item.kind === "typing") {
          return (
            <div key={item.id} className="flex justify-start">
              <TypingDots />
            </div>
          );
        }
        if (item.kind === "divider") {
          const colors: Record<typeof item.color, string> = {
            slate:   "bg-slate-100 text-slate-600 border-slate-200",
            cyan:    "bg-cyan-50 text-cyan-700 border-cyan-200",
            emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
            violet:  "bg-violet-50 text-violet-700 border-violet-200",
          };
          return (
            <div key={item.id} className={`flex items-center gap-3 px-4 py-2 rounded-xl border text-xs font-semibold uppercase tracking-wide ${colors[item.color]}`}>
              <span className="flex-1 h-px bg-current opacity-20" />
              {item.text}
              <span className="flex-1 h-px bg-current opacity-20" />
            </div>
          );
        }
        if (item.kind === "card") {
          if (item.resolved) {
            return (
              <div key={item.id} className="flex justify-start">
                <ResolvedChip label={item.resolvedLabel ?? "Confirmed"} />
              </div>
            );
          }
          const { card } = item;
          if (card.type === "confirm_streams") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ConfirmStreamsCard
                  streams={card.streams}
                  onConfirm={s => onCardAction(item.id, "confirm_streams", s)}
                  onEdit={() => onCardAction(item.id, "edit_streams")}
                />
              </div>
            );
          }
          if (card.type === "complexity") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ComplexityCard onSelect={choice => onCardAction(item.id, "complexity", choice)} />
              </div>
            );
          }
          if (card.type === "paste_data") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <PasteDataCard
                  streamName={card.streamName}
                  onExtract={text => onCardAction(item.id, "paste_extract", text)}
                />
              </div>
            );
          }
          if (card.type === "confirm_items") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ConfirmItemsCard
                  items={card.items}
                  currency={currency}
                  onConfirm={() => onCardAction(item.id, "confirm_items")}
                  onEdit={() => onCardAction(item.id, "edit_items")}
                />
              </div>
            );
          }
          if (card.type === "growth") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <GrowthCard onConfirm={profile => onCardAction(item.id, "confirm_growth_profile", profile)} />
              </div>
            );
          }
          if (card.type === "confirm_growth") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ConfirmGrowthCard
                  profile={card.profile}
                  onConfirm={() => onCardAction(item.id, "confirm_growth")}
                  onAdjust={() => onCardAction(item.id, "adjust_growth")}
                />
              </div>
            );
          }
          if (card.type === "seasonality") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <SeasonalityCard
                  streamType={card.streamType}
                  onConfirm={profile => onCardAction(item.id, "confirm_seasonality_profile", profile)}
                />
              </div>
            );
          }
          if (card.type === "confirm_seasonality") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ConfirmSeasonalityCard
                  profile={card.profile}
                  onConfirm={() => onCardAction(item.id, "confirm_seasonality")}
                  onEdit={() => onCardAction(item.id, "edit_seasonality")}
                />
              </div>
            );
          }
          if (card.type === "stream_summary") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <StreamSummaryCard
                  stream={card.stream}
                  currency={currency}
                  onConfirm={() => onCardAction(item.id, "confirm_stream_summary")}
                  onEdit={() => onCardAction(item.id, "edit_stream_summary")}
                />
              </div>
            );
          }
          if (card.type === "confirm_model") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ConfirmModelCard
                  streams={card.streams}
                  currency={currency}
                  onConfirm={() => onCardAction(item.id, "confirm_model")}
                  onEdit={() => onCardAction(item.id, "edit_model")}
                />
              </div>
            );
          }
        }
        return null;
      })}
    </>
  );
}

/* ─────────────────────────────────── main engine ── */

export function RevenueEngine({
  situation,
  appId,
  userId,
  currency,
  onStreamsDetected,
  onItemsSaved,
  onForecastYears,
  onForecastStart,
  onComplete,
}: RevenueEngineProps) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [streams, setStreams] = useState<WorkingStream[]>([]);
  const [inputVal, setInputVal] = useState("");
  const [inputLocked, setInputLocked] = useState(false);

  /* refs to avoid stale closures */
  const phaseRef     = useRef<EnginePhase>("detecting");
  const streamsRef   = useRef<WorkingStream[]>([]);
  const intakeMsgsRef  = useRef<ChatMsg[]>([]);
  const driverMsgsRef  = useRef<ChatMsg[]>([]);
  const intakeCtxRef   = useRef<string>("");
  /* pending item buffer for current stream */
  const pendingItemsRef = useRef<ParsedItem[]>([]);
  /* pending growth buffer */
  const pendingGrowthRef = useRef<GrowthProfile | null>(null);
  /* pending seasonality buffer */
  const pendingSeasonalityRef = useRef<SeasonalityProfile | null>(null);

  const feedEndRef = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const sb = createClient();

  /* ── session persistence ── */
  const STORAGE_KEY = appId ? `mentorvix-engine-${appId}` : null;
  /* mirror inputVal in a ref so beforeunload can read the latest value */
  const inputValRef = useRef(inputVal);
  useEffect(() => { inputValRef.current = inputVal; }, [inputVal]);

  const saveSession = useCallback((feedSnap: FeedItem[]) => {
    if (!STORAGE_KEY) return;
    try {
      const session: SavedSession = {
        feed: feedSnap,
        streams: streamsRef.current,
        phase: phaseRef.current,
        intakeMsgs: intakeMsgsRef.current,
        driverMsgs: driverMsgsRef.current,
        intakeCtx: intakeCtxRef.current,
        pendingItems: pendingItemsRef.current,
        pendingGrowth: pendingGrowthRef.current,
        pendingSeasonality: pendingSeasonalityRef.current,
        inputVal: inputValRef.current,
        savedAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch { /* storage quota or SSR */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [STORAGE_KEY]);

  /* auto-save on every feed update */
  useEffect(() => {
    if (feed.length > 0) saveSession(feed);
  }, [feed, saveSession]);

  /* also capture in-flight inputVal on page unload (covers mid-type refresh) */
  useEffect(() => {
    if (!STORAGE_KEY) return;
    const onUnload = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SavedSession;
          parsed.inputVal = inputValRef.current;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
      } catch { /* ignore */ }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [STORAGE_KEY]);

  /* ── helpers ── */
  const addFeedItem = useCallback((item: FeedItemInput) => {
    const id = uid();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setFeed(prev => [...prev, { ...item, id } as any]);
    return id;
  }, []);

  const resolveCard = useCallback((id: number, label: string) => {
    setFeed(prev => prev.map(item =>
      item.id === id && item.kind === "card"
        ? { ...item, resolved: true, resolvedLabel: label }
        : item
    ));
  }, []);

  const removeTyping = useCallback((id: number) => {
    setFeed(prev => prev.filter(item => item.id !== id));
  }, []);

  /* sync streamsRef and notify parent */
  function setStreamsSync(updater: (prev: WorkingStream[]) => WorkingStream[]) {
    setStreams(prev => {
      const next = updater(prev);
      streamsRef.current = next;
      return next;
    });
  }

  /* auto scroll */
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed]);

  /* ── phase helpers ── */
  function currentStreamIdx(): number | null {
    const p = phaseRef.current;
    if (typeof p === "object" && p.kind === "stream") return p.idx;
    return null;
  }

  function currentStreamPhase(): StreamPhase | null {
    const p = phaseRef.current;
    if (typeof p === "object" && p.kind === "stream") return p.phase;
    return null;
  }

  function setPhase(phase: EnginePhase) {
    phaseRef.current = phase;
  }

  /* ── input active check ── */
  function isInputActive(): boolean {
    const p = phaseRef.current;
    if (p === "detecting") return true;
    if (typeof p === "object" && p.kind === "stream" && p.phase === "collect_chat") return true;
    return false;
  }

  /* ── API: intake ── */
  async function callIntake(msgs: ChatMsg[]): Promise<string> {
    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, situation }),
    });
    if (!res.ok) throw new Error(`Intake API error ${res.status}`);
    const data = await res.json() as { text?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.text ?? "";
  }

  /* ── API: drivers ── */
  async function callDrivers(msgs: ChatMsg[], streamIdx: number): Promise<string> {
    const s = streamsRef.current[streamIdx];
    const res = await fetch("/api/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: msgs,
        stream: { name: s.name, type: s.type },
        situation,
        isFirstStream: streamIdx === 0,
        intakeContext: intakeCtxRef.current,
      }),
    });
    if (!res.ok) throw new Error(`Drivers API error ${res.status}`);
    const data = await res.json() as { text?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.text ?? "";
  }

  /* ── save streams to DB ── */
  async function dbSaveStreams(detected: DetectedStream[]): Promise<void> {
    if (!appId || !userId) return;
    try {
      const rows = detected.map((d, i) => ({
        name: d.name, type: d.type, confidence: d.confidence,
        monthly_growth_pct: 0, sub_new_per_month: 0, sub_churn_pct: 0,
        rental_occupancy_pct: 0, driver_done: false, position: i,
      }));
      const saved = await saveStreams(sb, appId, userId, rows);
      /* Build updated streams with real UUIDs from the current ref snapshot */
      const updated = streamsRef.current.map((ws, i) => ({
        ...ws,
        id: saved[i]?.id ?? ws.id,
      }));
      /* Update engine state (pure — no side effects inside updater) */
      setStreamsSync(() => updated);
      /* CRITICAL: tell the page about real UUIDs OUTSIDE the state updater.
         The page's onStreamsDetected detects a same-length re-call and only
         updates IDs, preserving any items already set by onItemsSaved. */
      onStreamsDetected(updated);
    } catch (e) {
      console.error("saveStreams error", e);
    }
  }

  /* ── save items to DB ── */
  async function dbSaveItems(streamId: string, streamName: string, items: ParsedItem[]): Promise<void> {
    if (!userId) return;
    try {
      await saveStreamItems(sb, streamId, userId, items.map(it => ({
        name: it.name, category: it.category, volume: it.volume,
        price: it.price, costPrice: it.costPrice, unit: it.unit, note: it.note,
      })));
      onItemsSaved(streamId, streamName, items);
    } catch (e) {
      console.error("saveStreamItems error", e);
    }
  }

  /* ── stream phase advancement ── */
  async function advanceStreamPhase(idx: number, phase: StreamPhase) {
    setPhase({ kind: "stream", idx, phase });
    const s = streamsRef.current[idx];

    if (phase === "intro") {
      addFeedItem({ kind: "divider", text: s.name, color: "violet" });
      addFeedItem({ kind: "ai", text: `Let's work on: ${s.name}` });
      /* brief pause then go to complexity */
      await new Promise(r => setTimeout(r, 400));
      advanceStreamPhase(idx, "complexity");
    }

    else if (phase === "complexity") {
      const cardId = addFeedItem({ kind: "card", resolved: false, card: { type: "complexity" } });
      setInputLocked(true);
      /* stored for card action handler — nothing async needed here */
      void cardId;
    }

    else if (phase === "collect_chat") {
      setInputLocked(false);
      setInputVal("");
      addFeedItem({ kind: "ai", text: `For ${s.name}, describe your items — what you sell, monthly volumes, and prices. You can type below or use the paste table.` });
      /* also show the paste card so the user has both options */
      addFeedItem({ kind: "card", resolved: false, card: { type: "paste_data", streamName: s.name } });
      driverMsgsRef.current = [];
    }

    else if (phase === "collect_paste") {
      setInputLocked(false);
      setInputVal("");
      const cardId = addFeedItem({
        kind: "card", resolved: false,
        card: { type: "paste_data", streamName: s.name },
      });
      void cardId;
    }

    else if (phase === "confirm_items") {
      setInputLocked(true);
      const items = pendingItemsRef.current;
      addFeedItem({
        kind: "card", resolved: false,
        card: { type: "confirm_items", items },
      });
    }

    else if (phase === "growth") {
      setInputLocked(true);
      addFeedItem({ kind: "card", resolved: false, card: { type: "growth" } });
    }

    else if (phase === "confirm_growth") {
      const profile = pendingGrowthRef.current!;
      addFeedItem({ kind: "card", resolved: false, card: { type: "confirm_growth", profile } });
    }

    else if (phase === "seasonality") {
      addFeedItem({ kind: "card", resolved: false, card: { type: "seasonality", streamType: s.type } });
    }

    else if (phase === "confirm_seasonality") {
      const profile = pendingSeasonalityRef.current!;
      addFeedItem({ kind: "card", resolved: false, card: { type: "confirm_seasonality", profile } });
    }

    else if (phase === "stream_summary") {
      /* update stream with accumulated data */
      const updated = {
        ...s,
        items: pendingItemsRef.current,
        growth: pendingGrowthRef.current,
        seasonality: pendingSeasonalityRef.current,
        status: "completed" as const,
      };
      setStreamsSync(prev => prev.map((ws, i) => i === idx ? updated : ws));
      addFeedItem({
        kind: "card", resolved: false,
        card: { type: "stream_summary", stream: updated },
      });
    }
  }

  /* ── card action handler ── */
  const handleCardAction = useCallback(async (
    cardId: number,
    action: string,
    payload?: unknown,
  ) => {
    const idx = currentStreamIdx();
    const streamPhase = currentStreamPhase();

    /* ── confirm_streams ── */
    if (action === "confirm_streams") {
      const detected = payload as DetectedStream[];
      resolveCard(cardId, `${detected.length} streams confirmed`);
      const ws: WorkingStream[] = detected.map((d, i) => ({
        id: `local-${i}-${Date.now()}`,
        name: d.name, type: d.type, confidence: d.confidence,
        items: [], growth: null, seasonality: null, status: "pending",
      }));
      setStreamsSync(() => ws);
      onStreamsDetected(ws);
      await dbSaveStreams(detected);
      /* save intake conversation */
      if (appId && userId) {
        saveIntakeConversation(sb, appId, userId, intakeMsgsRef.current, null, true).catch(console.error);
        updateApplicationFlags(sb, appId, { intake_done: true }).catch(console.error);
      }
      /* start first stream */
      setPhase({ kind: "stream", idx: 0, phase: "intro" });
      setStreamsSync(prev => prev.map((s, i) => i === 0 ? { ...s, status: "in_progress" } : s));
      await advanceStreamPhase(0, "intro");
      return;
    }

    if (action === "edit_streams") {
      resolveCard(cardId, "Editing…");
      addFeedItem({ kind: "ai", text: "Sure — which streams would you like to add, remove, or rename? Just tell me." });
      setPhase("detecting");
      setInputLocked(false);
      return;
    }

    /* ── complexity ── */
    if (action === "complexity") {
      const choice = payload as "under20" | "20to100" | "more100";
      const label = choice === "under20" ? "Under 20" : choice === "20to100" ? "20–100" : "More than 100";
      resolveCard(cardId, label);
      /* always show both chat + paste regardless of item count */
      await advanceStreamPhase(idx!, "collect_chat");
      return;
    }

    /* ── paste_extract ── */
    if (action === "paste_extract" && idx !== null) {
      const pastedText = payload as string;
      resolveCard(cardId, "Data pasted");
      const preview = pastedText.substring(0, 100) + (pastedText.length > 100 ? "…" : "");
      addFeedItem({ kind: "user", text: preview });
      setInputLocked(true);

      /* ── fast path: client-side tabular parse (tab / pipe / comma + header) ── */
      const quickItems = parseTabularData(pastedText);
      if (quickItems && quickItems.length > 0) {
        addFeedItem({ kind: "ai", text: `Got it — extracted ${quickItems.length} item${quickItems.length !== 1 ? "s" : ""} from your table. Review below.` });
        pendingItemsRef.current = quickItems;
        await advanceStreamPhase(idx, "confirm_items");
        return;
      }

      /* ── slow path: send to AI for free-text / ambiguous formats ── */
      const typingId = addFeedItem({ kind: "typing" });
      try {
        /* prepend a clear extraction instruction so the AI always outputs the block */
        const extractPrompt =
          `Extract every product/item from the data below and output [ITEMS_DETECTED] immediately — no questions.\n\n${pastedText}`;
        const msgs: ChatMsg[] = [
          ...driverMsgsRef.current,
          { role: "user", content: extractPrompt },
        ];
        driverMsgsRef.current = msgs;
        const reply = await callDrivers(msgs, idx);
        removeTyping(typingId);
        driverMsgsRef.current = [...msgs, { role: "assistant", content: reply }];

        const cleanIdx = reply.indexOf("[ITEMS_DETECTED]");
        const clean = (cleanIdx !== -1 ? reply.slice(0, cleanIdx) : reply).trim();
        if (clean) addFeedItem({ kind: "ai", text: clean });

        const items = parseItems(reply);
        if (items && items.length > 0) {
          pendingItemsRef.current = items;
          await advanceStreamPhase(idx, "confirm_items");
        } else {
          addFeedItem({ kind: "ai", text: "I couldn't read that format. Try using a table with headers: Product | Volume | Price | Cost" });
          await advanceStreamPhase(idx, "collect_paste");
        }
      } catch (e) {
        removeTyping(typingId);
        console.error(e);
        addFeedItem({ kind: "ai", text: "Something went wrong. Please try again." });
        setInputLocked(false);
      }
      return;
    }

    /* ── confirm_items ── */
    if (action === "confirm_items" && idx !== null) {
      const items = pendingItemsRef.current;
      const s = streamsRef.current[idx];
      resolveCard(cardId, `${items.length} items confirmed`);
      await dbSaveItems(s.id, s.name, items);
      if (appId && userId) {
        saveDriverConversation(sb, appId, userId, s.id, driverMsgsRef.current, null, false).catch(console.error);
      }
      await advanceStreamPhase(idx, "growth");
      return;
    }

    if (action === "edit_items" && idx !== null) {
      resolveCard(cardId, "Editing…");
      pendingItemsRef.current = [];
      await advanceStreamPhase(idx, "collect_chat");
      return;
    }

    /* ── growth profile selected from GrowthCard ── */
    if (action === "confirm_growth_profile") {
      const profile = payload as GrowthProfile;
      pendingGrowthRef.current = profile;
      resolveCard(cardId, profile.trend);
      await advanceStreamPhase(idx!, "confirm_growth");
      return;
    }

    /* ── confirm_growth (ConfirmGrowthCard confirmed) ── */
    if (action === "confirm_growth") {
      resolveCard(cardId, "Growth confirmed");
      await advanceStreamPhase(idx!, "seasonality");
      return;
    }

    if (action === "adjust_growth") {
      resolveCard(cardId, "Adjusting…");
      pendingGrowthRef.current = null;
      await advanceStreamPhase(idx!, "growth");
      return;
    }

    /* ── seasonality profile selected from SeasonalityCard ── */
    if (action === "confirm_seasonality_profile") {
      const profile = payload as SeasonalityProfile;
      pendingSeasonalityRef.current = profile;
      resolveCard(cardId, profile.variation);
      await advanceStreamPhase(idx!, "confirm_seasonality");
      return;
    }

    /* ── confirm_seasonality ── */
    if (action === "confirm_seasonality") {
      resolveCard(cardId, "Seasonality confirmed");
      await advanceStreamPhase(idx!, "stream_summary");
      return;
    }

    if (action === "edit_seasonality") {
      resolveCard(cardId, "Editing…");
      pendingSeasonalityRef.current = null;
      await advanceStreamPhase(idx!, "seasonality");
      return;
    }

    /* ── stream_summary confirmed ── */
    if (action === "confirm_stream_summary" && idx !== null) {
      const s = streamsRef.current[idx];
      resolveCard(cardId, `${s.name} done`);
      addFeedItem({ kind: "divider", text: `${s.name} complete`, color: "emerald" });

      const nextIdx = idx + 1;
      if (nextIdx < streamsRef.current.length) {
        /* start next stream */
        setStreamsSync(prev => prev.map((ws, i) => i === nextIdx ? { ...ws, status: "in_progress" } : ws));
        driverMsgsRef.current = [];
        pendingItemsRef.current = [];
        pendingGrowthRef.current = null;
        pendingSeasonalityRef.current = null;
        await advanceStreamPhase(nextIdx, "intro");
      } else {
        /* all streams done → confirm model */
        setPhase("confirm_model");
        setInputLocked(true);
        addFeedItem({ kind: "divider", text: "Finalising revenue model…", color: "cyan" });
        addFeedItem({ kind: "card", resolved: false, card: { type: "confirm_model", streams: streamsRef.current } });
      }
      return;
    }

    if (action === "edit_stream_summary" && idx !== null) {
      resolveCard(cardId, "Editing…");
      addFeedItem({ kind: "ai", text: "Let's revisit this stream. Which part would you like to change?" });
      await advanceStreamPhase(idx, "intro");
      return;
    }

    /* ── confirm_model ── */
    if (action === "confirm_model") {
      resolveCard(cardId, "Model confirmed");
      if (appId && userId) {
        updateApplicationFlags(sb, appId, { drivers_done: true }).catch(console.error);
      }
      setPhase("done");
      /* clear the saved session — workflow is complete */
      if (STORAGE_KEY) { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } }
      onComplete();
      return;
    }

    if (action === "edit_model") {
      resolveCard(cardId, "Editing…");
      addFeedItem({ kind: "ai", text: "Which stream would you like to edit?" });
      /* allow user to specify stream — go back to confirm_streams concept */
      setPhase("confirm_model");
      return;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── send chat message ── */
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || inputLocked) return;
    addFeedItem({ kind: "user", text });
    setInputVal("");
    setInputLocked(true);

    const p = phaseRef.current;

    /* ── detecting phase ── */
    if (p === "detecting") {
      const msgs: ChatMsg[] = [...intakeMsgsRef.current, { role: "user", content: text }];
      intakeMsgsRef.current = msgs;
      const typingId = addFeedItem({ kind: "typing" });
      try {
        const reply = await callIntake(msgs);
        removeTyping(typingId);
        intakeMsgsRef.current = [...msgs, { role: "assistant", content: reply }];
        intakeCtxRef.current = reply;

        const detected = parseStreams(reply);
        const fy = parseForecastYears(reply);
        const fs = parseForecastStart(reply);
        if (fy) onForecastYears(fy);
        if (fs) onForecastStart(fs.year, fs.month);

        const tagIdx = reply.indexOf("[STREAMS_DETECTED]");
        const clean = (tagIdx !== -1 ? reply.slice(0, tagIdx) : reply).trim();
        if (clean) addFeedItem({ kind: "ai", text: clean });

        if (detected && detected.length > 0) {
          addFeedItem({
            kind: "card", resolved: false,
            card: { type: "confirm_streams", streams: detected },
          });
          setInputLocked(true);
        } else {
          setInputLocked(false);
        }
      } catch (e) {
        removeTyping(typingId);
        console.error(e);
        addFeedItem({ kind: "ai", text: "I had trouble processing that. Could you try again?" });
        setInputLocked(false);
      }
      return;
    }

    /* ── collect_chat phase ── */
    if (typeof p === "object" && p.kind === "stream" && p.phase === "collect_chat") {
      const idx = p.idx;
      const msgs: ChatMsg[] = [...driverMsgsRef.current, { role: "user", content: text }];
      driverMsgsRef.current = msgs;
      const typingId = addFeedItem({ kind: "typing" });
      try {
        const reply = await callDrivers(msgs, idx);
        removeTyping(typingId);
        driverMsgsRef.current = [...msgs, { role: "assistant", content: reply }];

        const fy = parseForecastYears(reply);
        const fs = parseForecastStart(reply);
        if (fy) onForecastYears(fy);
        if (fs) onForecastStart(fs.year, fs.month);

        const chatCleanIdx = reply.indexOf("[ITEMS_DETECTED]");
        const chatClean = (chatCleanIdx !== -1 ? reply.slice(0, chatCleanIdx) : reply).trim();
        if (chatClean) addFeedItem({ kind: "ai", text: chatClean });

        const items = parseItems(reply);
        if (items && items.length > 0) {
          pendingItemsRef.current = items;
          await advanceStreamPhase(idx, "confirm_items");
        } else {
          setInputLocked(false);
        }
      } catch (e) {
        removeTyping(typingId);
        console.error(e);
        addFeedItem({ kind: "ai", text: "Something went wrong. Please try again." });
        setInputLocked(false);
      }
      return;
    }

    setInputLocked(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputLocked]);

  /* ── start intake on mount ── */
  async function startIntake() {
    setPhase("detecting");
    setInputLocked(true);
    const typingId = addFeedItem({ kind: "typing" });
    try {
      // Send empty messages — the API uses the situation context to generate the correct opening
      const reply = await callIntake([]);
      removeTyping(typingId);
      intakeMsgsRef.current = [{ role: "assistant", content: reply }];
      intakeCtxRef.current = reply;
      const streams = parseStreams(reply);
      if (streams && streams.length > 0) {
        // Rare: AI detected streams immediately
        const clean = reply.slice(0, reply.indexOf("[STREAMS_DETECTED]")).trim();
        if (clean) addFeedItem({ kind: "ai", text: clean });
        addFeedItem({ kind: "card", resolved: false, card: { type: "confirm_streams", streams } });
        setInputLocked(true);
      } else {
        addFeedItem({ kind: "ai", text: reply });
        setInputLocked(false);
      }
    } catch (e) {
      removeTyping(typingId);
      console.error("[RevenueEngine] startIntake:", e);
      addFeedItem({ kind: "ai", text: "Welcome! Tell me about your business and how it generates revenue." });
      setInputLocked(false);
    }
  }

  useEffect(() => {
    /* try to restore a saved session first */
    if (STORAGE_KEY) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const s = JSON.parse(raw) as SavedSession;
          const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
          if (Date.now() - s.savedAt < SEVEN_DAYS && s.feed && s.feed.length > 0) {
            /* strip in-flight typing indicators */
            const cleanFeed = s.feed.filter(f => f.kind !== "typing");
            /* re-seed the uid counter above the highest existing id */
            if (cleanFeed.length > 0) {
              _uid = Math.max(...cleanFeed.map(f => f.id));
            }
            /* restore all state */
            setFeed(cleanFeed);
            setStreams(s.streams ?? []);
            streamsRef.current       = s.streams ?? [];
            phaseRef.current         = s.phase ?? "detecting";
            intakeMsgsRef.current    = s.intakeMsgs ?? [];
            driverMsgsRef.current    = s.driverMsgs ?? [];
            intakeCtxRef.current     = s.intakeCtx ?? "";
            pendingItemsRef.current  = s.pendingItems ?? [];
            pendingGrowthRef.current = s.pendingGrowth ?? null;
            pendingSeasonalityRef.current = s.pendingSeasonality ?? null;
            setInputVal(s.inputVal ?? "");
            setInputLocked(inputLockForPhase(s.phase ?? "detecting"));
            return; /* skip startIntake */
          } else {
            localStorage.removeItem(STORAGE_KEY); /* expired */
          }
        }
      } catch { /* corrupt data — fall through to fresh start */ }
    }
    startIntake();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── key handler ── */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputVal);
    }
  }

  const active = isInputActive() && !inputLocked;

  /* ── mic ── */
  const [micActive, setMicActive] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const toggleMic = useCallback(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (micActive) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setMicActive(false);
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
      if (final) setInputVal(prev => prev ? prev.trimEnd() + " " + final.trim() : final.trim());
    };
    rec.onerror = () => { recognitionRef.current = null; setMicActive(false); };
    rec.onend   = () => { if (recognitionRef.current) { recognitionRef.current = null; setMicActive(false); } };
    rec.start();
    recognitionRef.current = rec;
    setMicActive(true);
  }, [micActive]);

  /* ── render ── */
  return (
    <div className="flex gap-6 h-full">
      {/* left: feed */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* feed scroll area */}
        <div
          className="flex-1 overflow-y-auto space-y-3 pb-4 pr-1"
          style={{ height: "calc(100vh - 280px)" }}
        >
          <FeedRenderer feed={feed} currency={currency} onCardAction={handleCardAction} />
          <div ref={feedEndRef} />
        </div>

        {/* input */}
        <div className={`mt-4 flex gap-2 transition-opacity ${active ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
          {/* mic button */}
          <button
            onClick={toggleMic}
            disabled={!active}
            title={micActive ? "Stop recording" : "Speak your answer"}
            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
              micActive
                ? "bg-red-500 text-white shadow-md shadow-red-200 animate-pulse"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            {micActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={micActive ? "Listening… speak now" : "Type your answer or use the mic"}
            disabled={!active}
            className={`flex-1 border rounded-xl px-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 bg-white transition-all ${
              micActive
                ? "border-red-300 focus:ring-red-200"
                : "border-slate-200 focus:ring-cyan-300"
            }`}
          />

          <button
            onClick={() => sendMessage(inputVal)}
            disabled={!active || !inputVal.trim()}
            title="Send"
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-cyan-600 text-white flex items-center justify-center hover:bg-cyan-700 transition-colors disabled:opacity-40"
          >
            <SendIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* right: progress panel */}
      <ProgressPanel streams={streams} />
    </div>
  );
}
