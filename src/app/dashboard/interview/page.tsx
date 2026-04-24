"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, ArrowLeft, CheckCircle2, TrendingUp, DollarSign,
  ShoppingCart, Landmark, PiggyBank, BarChart3, Calendar,
  Smartphone, Banknote, CreditCard, Zap, Shield, ChevronRight,
} from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

const REVENUE_RANGES = [
  { label: "Under $500", value: 250 },
  { label: "$500 – $1,000", value: 750 },
  { label: "$1,000 – $2,500", value: 1750 },
  { label: "$2,500 – $5,000", value: 3750 },
  { label: "$5,000 – $10,000", value: 7500 },
  { label: "$10,000 – $25,000", value: 17500 },
  { label: "$25,000 – $50,000", value: 37500 },
  { label: "Over $50,000", value: 65000 },
];

const EXPENSE_RANGES = [
  { label: "Under $300", value: 150 },
  { label: "$300 – $800", value: 550 },
  { label: "$800 – $2,000", value: 1400 },
  { label: "$2,000 – $5,000", value: 3500 },
  { label: "$5,000 – $10,000", value: 7500 },
  { label: "$10,000 – $25,000", value: 17500 },
  { label: "Over $25,000", value: 35000 },
];

const DEBT_RANGES = [
  { label: "None", value: 0 },
  { label: "Under $1,000", value: 500 },
  { label: "$1,000 – $5,000", value: 3000 },
  { label: "$5,000 – $15,000", value: 10000 },
  { label: "$15,000 – $50,000", value: 32500 },
  { label: "Over $50,000", value: 75000 },
];

const SAVINGS_RANGES = [
  { label: "None / Very little", value: 0 },
  { label: "Under $500", value: 250 },
  { label: "$500 – $2,000", value: 1250 },
  { label: "$2,000 – $10,000", value: 6000 },
  { label: "$10,000 – $30,000", value: 20000 },
  { label: "Over $30,000", value: 45000 },
];

const COLLATERAL_RANGES = [
  { label: "None", value: 0 },
  { label: "Under $2,000", value: 1000 },
  { label: "$2,000 – $10,000", value: 6000 },
  { label: "$10,000 – $30,000", value: 20000 },
  { label: "$30,000 – $100,000", value: 65000 },
  { label: "Over $100,000", value: 150000 },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TRANSACTION_OPTS = [
  { label: "1 – 20 / month", value: "low" },
  { label: "20 – 100 / month", value: "medium" },
  { label: "100 – 500 / month", value: "high" },
  { label: "500+ / month", value: "very_high" },
];

interface FormData {
  revenueAvg: number;
  revenueBest: number;
  revenueWorst: number;
  expenses: number;
  transactions: string;
  paymentCash: number;
  paymentMobile: number;
  paymentBank: number;
  busyMonths: string[];
  existingDebt: number;
  savings: number;
  collateral: number;
  supplierCredit: boolean;
}

const defaultForm: FormData = {
  revenueAvg: -1,
  revenueBest: -1,
  revenueWorst: -1,
  expenses: -1,
  transactions: "",
  paymentCash: 60,
  paymentMobile: 30,
  paymentBank: 10,
  busyMonths: [],
  existingDebt: -1,
  savings: -1,
  collateral: -1,
  supplierCredit: false,
};

function calculateScore(f: FormData) {
  let score = 38;

  // Revenue consistency (0-15)
  if (f.revenueBest > 0 && f.revenueWorst >= 0) {
    const consistency = 1 - (f.revenueBest - f.revenueWorst) / Math.max(f.revenueBest, 1);
    score += Math.round(consistency * 15);
  }

  // Expense ratio (0-15)
  if (f.revenueAvg > 0 && f.expenses >= 0) {
    const ratio = f.expenses / f.revenueAvg;
    if (ratio < 0.4) score += 15;
    else if (ratio < 0.6) score += 11;
    else if (ratio < 0.75) score += 7;
    else if (ratio < 0.9) score += 3;
  }

  // Debt burden (0-12)
  const annual = f.revenueAvg * 12;
  if (annual > 0 && f.existingDebt >= 0) {
    const dRatio = f.existingDebt / annual;
    if (dRatio === 0) score += 12;
    else if (dRatio < 0.15) score += 10;
    else if (dRatio < 0.35) score += 6;
    else if (dRatio < 0.6) score += 3;
  }

  // Collateral (0-10)
  if (f.collateral > 0 && f.revenueAvg > 0) {
    if (f.collateral > f.revenueAvg * 6) score += 10;
    else if (f.collateral > f.revenueAvg * 3) score += 7;
    else if (f.collateral > f.revenueAvg) score += 4;
    else score += 2;
  }

  // Savings buffer (0-5)
  if (f.savings > 0 && f.revenueAvg > 0) {
    if (f.savings > f.revenueAvg * 4) score += 5;
    else if (f.savings > f.revenueAvg * 2) score += 3;
    else score += 1;
  }

  // Payment formality (0-5)
  const formal = f.paymentMobile + f.paymentBank;
  score += Math.round((formal / 100) * 5);

  return Math.min(Math.max(score, 20), 96);
}

function calculateFunding(score: number, revenueAvg: number) {
  const annual = revenueAvg * 12;
  const multiplier = (score / 100) * 2.8;
  const max = Math.round((annual * multiplier) / 1000) * 1000;
  const min = Math.round((max * 0.38) / 1000) * 1000;
  return { min: Math.max(min, 1000), max: Math.max(max, 3000) };
}

function fmt(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
}

function RangeSelector({ options, value, onChange }: {
  options: { label: string; value: number }[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-4 py-3 rounded-xl text-sm font-medium border transition-all text-left ${
            value === opt.value
              ? "border-cyan-500 bg-cyan-50 text-cyan-700"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const STEPS = [
  { id: "welcome", label: "Start" },
  { id: "revenue", label: "Revenue" },
  { id: "costs", label: "Costs" },
  { id: "operations", label: "Operations" },
  { id: "position", label: "Position" },
  { id: "results", label: "Results" },
];

export default function InterviewPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [form, setForm] = useState<FormData>(defaultForm);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<{ score: number; min: number; max: number } | null>(null);

  const go = (n: number) => { setDir(n > step ? 1 : -1); setStep(n); };
  const next = () => go(step + 1);
  const back = () => go(step - 1);

  const canNext = () => {
    if (step === 0) return true;
    if (step === 1) return form.revenueAvg >= 0 && form.revenueBest >= 0 && form.revenueWorst >= 0;
    if (step === 2) return form.expenses >= 0;
    if (step === 3) return form.transactions !== "";
    if (step === 4) return form.existingDebt >= 0 && form.savings >= 0 && form.collateral >= 0;
    return true;
  };

  const finalize = async () => {
    setCalculating(true);
    await new Promise((r) => setTimeout(r, 2200));
    const score = calculateScore(form);
    const { min, max } = calculateFunding(score, form.revenueAvg);
    const data = { ...form, score, fundingMin: min, fundingMax: max, confidence: "manual", completedAt: new Date().toISOString() };
    localStorage.setItem("mvx_assessment", JSON.stringify(data));
    setResult({ score, min, max });
    setCalculating(false);
    setStep(5);
  };

  const slideVariants = {
    enter: (d: number) => ({ opacity: 0, x: d > 0 ? 48 : -48 }),
    center: { opacity: 1, x: 0, transition: { duration: 0.38, ease: EASE } },
    exit: (d: number) => ({ opacity: 0, x: d > 0 ? -48 : 48, transition: { duration: 0.25, ease: EASE } }),
  };

  const totalSteps = STEPS.length - 2; // welcome and results don't count in progress

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Topbar */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0e7490, #0891b2)" }}>
            <BarChart3 className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-slate-900">Financial Assessment</span>
        </div>
        {step > 0 && step < 5 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">Step {step} of {totalSteps}</span>
            <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg, #0e7490, #0891b2)" }}
                animate={{ width: `${(step / totalSteps) * 100}%` }}
                transition={{ duration: 0.4, ease: EASE }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Shield className="w-3.5 h-3.5" />
          <span>Private & encrypted</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl">
          <AnimatePresence mode="wait" custom={dir}>
            {/* STEP 0 — Welcome */}
            {step === 0 && (
              <motion.div key="welcome" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit">
                <div className="text-center mb-10">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5" style={{ background: "linear-gradient(135deg, #042f3d, #0e7490)" }}>
                    <Zap className="w-7 h-7 text-white" />
                  </div>
                  <h1 className="text-3xl font-bold text-slate-900 mb-3">Get loan-ready in 3 minutes</h1>
                  <p className="text-slate-500 text-base max-w-sm mx-auto leading-relaxed">
                    No bank statements. No documents. Just answer a few simple questions and we&apos;ll generate your funding readiness score and estimated loan range instantly.
                  </p>
                </div>

                <div className="space-y-3 mb-8">
                  {[
                    { icon: <CheckCircle2 className="w-4 h-4" />, text: "No uploads required to start", color: "text-emerald-500" },
                    { icon: <Shield className="w-4 h-4" />, text: "Your data is private and encrypted", color: "text-cyan-600" },
                    { icon: <TrendingUp className="w-4 h-4" />, text: "Add records later to improve accuracy", color: "text-violet-500" },
                  ].map(({ icon, text, color }) => (
                    <div key={text} className="flex items-center gap-3 bg-white rounded-xl px-4 py-3.5 border border-slate-100">
                      <span className={color}>{icon}</span>
                      <span className="text-sm text-slate-700 font-medium">{text}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={next}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition-all hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #0e7490 0%, #0891b2 100%)" }}
                >
                  Start free assessment <ArrowRight className="w-4 h-4" />
                </button>
                <p className="text-center text-xs text-slate-400 mt-4">Takes about 3 minutes · No sign-up required</p>
              </motion.div>
            )}

            {/* STEP 1 — Revenue */}
            {step === 1 && (
              <motion.div key="revenue" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" className="space-y-8">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-5 h-5 text-cyan-600" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-cyan-600">Revenue</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">How much does your business earn?</h2>
                  <p className="text-slate-500 text-sm mt-1">Estimates are fine — use your best guess.</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">Average monthly revenue (last 3 months)</label>
                  <RangeSelector options={REVENUE_RANGES} value={form.revenueAvg} onChange={(v) => setForm({ ...form, revenueAvg: v })} />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">Your best month in the last year</label>
                  <RangeSelector options={REVENUE_RANGES} value={form.revenueBest} onChange={(v) => setForm({ ...form, revenueBest: v })} />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">Your slowest month in the last year</label>
                  <RangeSelector options={REVENUE_RANGES} value={form.revenueWorst} onChange={(v) => setForm({ ...form, revenueWorst: v })} />
                </div>

                <StepNav onBack={back} onNext={next} canNext={canNext()} />
              </motion.div>
            )}

            {/* STEP 2 — Costs */}
            {step === 2 && (
              <motion.div key="costs" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" className="space-y-8">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <ShoppingCart className="w-5 h-5 text-orange-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-orange-500">Costs</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">What are your monthly costs?</h2>
                  <p className="text-slate-500 text-sm mt-1">Include rent, salaries, stock, utilities, transport — everything you pay out each month.</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">Total monthly expenses</label>
                  <RangeSelector options={EXPENSE_RANGES} value={form.expenses} onChange={(v) => setForm({ ...form, expenses: v })} />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">Do you buy stock/goods on credit from suppliers?</label>
                  <div className="flex gap-3">
                    {["Yes, regularly", "Sometimes", "No"].map((opt, i) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setForm({ ...form, supplierCredit: i === 0 })}
                        className={`flex-1 py-3 rounded-xl text-sm font-medium border transition-all ${
                          (i === 0 && form.supplierCredit) || (i !== 0 && !form.supplierCredit && form.expenses >= 0)
                            ? "border-cyan-500 bg-cyan-50 text-cyan-700"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <StepNav onBack={back} onNext={next} canNext={canNext()} />
              </motion.div>
            )}

            {/* STEP 3 — Operations */}
            {step === 3 && (
              <motion.div key="operations" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" className="space-y-8">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-5 h-5 text-violet-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-violet-500">Operations</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">How does your business operate?</h2>
                  <p className="text-slate-500 text-sm mt-1">This helps us understand your business patterns.</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">How many customer transactions per month?</label>
                  <div className="grid grid-cols-2 gap-2">
                    {TRANSACTION_OPTS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm({ ...form, transactions: opt.value })}
                        className={`px-4 py-3.5 rounded-xl text-sm font-medium border transition-all text-left ${
                          form.transactions === opt.value
                            ? "border-cyan-500 bg-cyan-50 text-cyan-700"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">How do customers pay you? <span className="font-normal text-slate-400">(approximate %)</span></label>
                  <div className="space-y-4">
                    {[
                      { label: "Cash", icon: <Banknote className="w-4 h-4" />, key: "paymentCash" as keyof FormData, color: "#f59e0b" },
                      { label: "Mobile money (M-Pesa, Airtel, etc.)", icon: <Smartphone className="w-4 h-4" />, key: "paymentMobile" as keyof FormData, color: "#10b981" },
                      { label: "Bank transfer / cheque", icon: <CreditCard className="w-4 h-4" />, key: "paymentBank" as keyof FormData, color: "#0e7490" },
                    ].map(({ label, icon, key, color }) => (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <span style={{ color }}>{icon}</span>
                            {label}
                          </div>
                          <span className="text-sm font-bold text-slate-800">{form[key] as number}%</span>
                        </div>
                        <input
                          type="range" min={0} max={100} step={5}
                          value={form[key] as number}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const diff = val - (form[key] as number);
                            const others = key === "paymentCash"
                              ? ["paymentMobile", "paymentBank"] as const
                              : key === "paymentMobile"
                              ? ["paymentCash", "paymentBank"] as const
                              : ["paymentCash", "paymentMobile"] as const;
                            const remaining = 100 - val;
                            const total = (form[others[0]] as number) + (form[others[1]] as number);
                            if (total === 0) return;
                            const r0 = Math.round(remaining * ((form[others[0]] as number) / Math.max(total, 1)));
                            const r1 = remaining - r0;
                            setForm({ ...form, [key]: val, [others[0]]: r0, [others[1]]: r1 });
                          }}
                          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                          style={{ accentColor: color }}
                        />
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
                      <span>Total</span>
                      <span className={`font-bold ${form.paymentCash + form.paymentMobile + form.paymentBank === 100 ? "text-emerald-500" : "text-red-500"}`}>
                        {form.paymentCash + form.paymentMobile + form.paymentBank}%
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">Which are your busiest months? <span className="font-normal text-slate-400">(optional)</span></label>
                  <div className="grid grid-cols-4 gap-2">
                    {MONTHS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            busyMonths: form.busyMonths.includes(m)
                              ? form.busyMonths.filter((x) => x !== m)
                              : [...form.busyMonths, m],
                          })
                        }
                        className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                          form.busyMonths.includes(m)
                            ? "border-cyan-500 bg-cyan-50 text-cyan-700"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <StepNav onBack={back} onNext={next} canNext={canNext()} />
              </motion.div>
            )}

            {/* STEP 4 — Financial Position */}
            {step === 4 && (
              <motion.div key="position" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" className="space-y-8">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Landmark className="w-5 h-5 text-emerald-600" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Financial Position</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Assets, savings & existing debt</h2>
                  <p className="text-slate-500 text-sm mt-1">This helps lenders assess risk and sets your loan ceiling.</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-3">Existing business debt / loans</label>
                  <RangeSelector options={DEBT_RANGES} value={form.existingDebt} onChange={(v) => setForm({ ...form, existingDebt: v })} />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <PiggyBank className="w-4 h-4 text-slate-500" />
                    <label className="text-sm font-semibold text-slate-700">Current savings or cash reserves</label>
                  </div>
                  <RangeSelector options={SAVINGS_RANGES} value={form.savings} onChange={(v) => setForm({ ...form, savings: v })} />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Assets you could offer as collateral</label>
                  <p className="text-xs text-slate-400 mb-3">Property, equipment, vehicles, inventory — anything with value.</p>
                  <RangeSelector options={COLLATERAL_RANGES} value={form.collateral} onChange={(v) => setForm({ ...form, collateral: v })} />
                </div>

                <button
                  onClick={finalize}
                  disabled={!canNext() || calculating}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #0e7490, #0891b2)" }}
                >
                  {calculating ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generating your report...
                    </>
                  ) : (
                    <>Generate My Readiness Report <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>

                {calculating && <CalculatingOverlay />}

                <button onClick={back} className="w-full text-center text-sm text-slate-400 hover:text-slate-600 transition-colors">
                  ← Back
                </button>
              </motion.div>
            )}

            {/* STEP 5 — Results */}
            {step === 5 && result && (
              <motion.div key="results" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit">
                <ResultsView score={result.score} fundingMin={result.min} fundingMax={result.max} onDashboard={() => router.push("/dashboard")} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function StepNav({ onBack, onNext, canNext }: { onBack: () => void; onNext: () => void; canNext: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        onClick={onBack}
        className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <button
        onClick={onNext}
        disabled={!canNext}
        className="flex-[2] flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 shadow-md shadow-cyan-500/15"
        style={{ background: "linear-gradient(135deg, #0e7490, #0891b2)" }}
      >
        Continue <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function CalculatingOverlay() {
  const steps = [
    "Analysing revenue patterns...",
    "Calculating expense ratios...",
    "Benchmarking against 1,200+ SMEs...",
    "Generating funding range...",
    "Building your readiness profile...",
  ];
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCurrent((c) => Math.min(c + 1, steps.length - 1)), 420);
    return () => clearInterval(t);
  });
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center z-50"
    >
      <div className="text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto" style={{ background: "linear-gradient(135deg, #0e7490, #0891b2)" }}>
          <BarChart3 className="w-8 h-8 text-white" />
        </div>
        <div>
          <p className="text-lg font-bold text-slate-900 mb-1">Generating your report</p>
          <AnimatePresence mode="wait">
            <motion.p
              key={current}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-sm text-slate-500"
            >
              {steps[current]}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="w-48 h-1 bg-slate-100 rounded-full overflow-hidden mx-auto">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, #0e7490, #0891b2)" }}
            animate={{ width: `${((current + 1) / steps.length) * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>
    </motion.div>
  );
}

function ScoreArc({ score }: { score: number }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const pct = score / 100;
  const dash = circ * 0.75;
  const offset = dash * (1 - pct);
  const color = score >= 70 ? "#10b981" : score >= 55 ? "#f59e0b" : "#ef4444";

  return (
    <svg width="140" height="100" viewBox="0 0 140 100">
      <circle cx="70" cy="75" r={r} fill="none" stroke="#e2e8f0" strokeWidth="10"
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        transform="rotate(-225 70 75)" />
      <motion.circle cx="70" cy="75" r={r} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        transform="rotate(-225 70 75)"
        initial={{ strokeDashoffset: dash }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.2, delay: 0.3, ease: EASE }}
        style={{ strokeDashoffset: offset }} />
      <text x="70" y="68" textAnchor="middle" fontSize="26" fontWeight="800" fill={color}>{score}</text>
      <text x="70" y="84" textAnchor="middle" fontSize="9" fill="#94a3b8">out of 100</text>
    </svg>
  );
}

function ResultsView({ score, fundingMin, fundingMax, onDashboard }: {
  score: number; fundingMin: number; fundingMax: number; onDashboard: () => void;
}) {
  const label = score >= 70 ? "Strong" : score >= 55 ? "Developing" : "Early Stage";
  const color = score >= 70 ? "text-emerald-600" : score >= 55 ? "text-amber-600" : "text-red-500";
  const bg = score >= 70 ? "bg-emerald-50 border-emerald-100" : score >= 55 ? "bg-amber-50 border-amber-100" : "bg-red-50 border-red-100";

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 mb-4">
          <CheckCircle2 className="w-3.5 h-3.5" /> Report ready
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Your Readiness Report</h2>
        <p className="text-slate-500 text-sm mt-1">Based on your business inputs · Confidence: Medium</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }}
        className="bg-white rounded-2xl border border-slate-100 p-6 text-center shadow-sm">
        <ScoreArc score={score} />
        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border mt-3 ${bg} ${color}`}>
          {label} Profile
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-xs text-slate-400 mb-1">Estimated funding range</p>
          <p className="text-2xl font-bold text-slate-900">{fmt(fundingMin)} – {fmt(fundingMax)}</p>
          <p className="text-xs text-slate-400 mt-0.5">Based on your revenue & financial position</p>
        </div>
      </motion.div>

      {/* Benchmarks */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="bg-white rounded-2xl border border-slate-100 p-4">
        <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider">Score benchmark</p>
        <div className="flex items-center justify-between text-xs">
          {[
            { label: "Avg SME", val: 52, color: "#94a3b8" },
            { label: "Your Score", val: score, color: score >= 70 ? "#10b981" : score >= 55 ? "#f59e0b" : "#ef4444", bold: true },
            { label: "Bank-ready", val: 80, color: "#0e7490" },
          ].map(({ label, val, color, bold }) => (
            <div key={label} className="text-center">
              <p className="text-slate-400 mb-1">{label}</p>
              <p className={`text-base ${bold ? "font-bold" : "font-medium"}`} style={{ color }}>{val}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Upgrade nudge */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
        className="bg-gradient-to-r from-cyan-50 to-blue-50 rounded-2xl border border-cyan-100 p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <TrendingUp className="w-4 h-4 text-cyan-700" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Improve your score by +8–15 points</p>
            <p className="text-xs text-slate-500 mt-0.5">Connect bank statements or upload records to verify your numbers, unlock better lender matching, and auto-fill your application.</p>
            <button className="mt-2 text-xs font-semibold text-cyan-700 flex items-center gap-1 hover:gap-2 transition-all">
              Learn how to improve <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </motion.div>

      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
        onClick={onDashboard}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20"
        style={{ background: "linear-gradient(135deg, #0e7490, #0891b2)" }}
      >
        View full dashboard <ArrowRight className="w-4 h-4" />
      </motion.button>
    </div>
  );
}
