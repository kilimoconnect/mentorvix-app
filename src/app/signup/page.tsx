"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, User, Building2, ArrowRight, ShieldCheck, ChevronDown } from "lucide-react";

const INDUSTRIES = [
  "Retail & Trade",
  "Agriculture & Farming",
  "Construction",
  "Transport & Logistics",
  "Food & Hospitality",
  "Healthcare",
  "Manufacturing",
  "Technology",
  "Education",
  "Other",
];

const STAGES = [
  { value: "idea", label: "Idea stage — not yet operating" },
  { value: "operating", label: "Operating — less than 2 years" },
  { value: "growing", label: "Growing — 2+ years in business" },
];

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    businessName: "",
    industry: "",
    stage: "",
    country: "",
  });

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1400));
    router.push("/dashboard");
  };

  const update = (field: string, value: string) => setForm({ ...form, [field]: value });

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: "linear-gradient(145deg, #0c4a6e 0%, #0e7490 60%, #0891b2 100%)" }}
      >
        <Image src="/logo.png" alt="Mentorvix" width={180} height={60} priority style={{ height: "auto" }} />

        <div className="text-white space-y-8">
          <div>
            <h2 className="text-4xl font-bold leading-tight">
              Start Your <br />
              Funding Journey.
            </h2>
            <p className="text-cyan-100 mt-3 max-w-sm">
              Join thousands of business owners who got funded with Mentorvix.
            </p>
          </div>

          {/* Step indicator */}
          <div className="space-y-4">
            {[
              { n: 1, label: "Create your account" },
              { n: 2, label: "Tell us about your business" },
              { n: 3, label: "Get your funding readiness score" },
            ].map(({ n, label }) => (
              <div key={n} className="flex items-center gap-4">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition-colors"
                  style={{
                    background: step >= n ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.15)",
                    color: step >= n ? "#0e7490" : "rgba(255,255,255,0.6)",
                  }}
                >
                  {step > n ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : n}
                </div>
                <span
                  className="text-sm font-medium"
                  style={{ color: step >= n ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.5)" }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-cyan-200 text-sm">
          <ShieldCheck className="w-4 h-4" />
          <span>Bank-grade encryption · Private & confidential</span>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-white">
        <div className="lg:hidden mb-8">
          <Image src="/logo.png" alt="Mentorvix" width={150} height={50} priority style={{ height: "auto" }} />
        </div>

        <div className="w-full max-w-md">
          {step === 1 && (
            <>
              <div className="mb-8">
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#0e7490" }}>
                  Step 1 of 2
                </p>
                <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
                <p className="text-slate-500 mt-1 text-sm">Free forever — no credit card required</p>
              </div>

              {/* Google */}
              <button className="w-full flex items-center justify-center gap-3 border border-slate-200 rounded-xl py-3 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors mb-6">
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continue with Google
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">OR</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <form onSubmit={handleStep1} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Full name</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      placeholder="John Banda"
                      className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-colors placeholder:text-slate-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      placeholder="you@business.com"
                      className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-colors placeholder:text-slate-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={form.password}
                      onChange={(e) => update("password", e.target.value)}
                      placeholder="Min. 8 characters"
                      className="w-full pl-10 pr-11 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-colors placeholder:text-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-all mt-2"
                  style={{ background: "#0e7490" }}
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </>
          )}

          {step === 2 && (
            <>
              <div className="mb-8">
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#0e7490" }}>
                  Step 2 of 2
                </p>
                <h1 className="text-2xl font-bold text-slate-900">About your business</h1>
                <p className="text-slate-500 mt-1 text-sm">This helps us find the right funding for you</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Business name</label>
                  <div className="relative">
                    <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={form.businessName}
                      onChange={(e) => update("businessName", e.target.value)}
                      placeholder="Your business name"
                      className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-colors placeholder:text-slate-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Country</label>
                  <div className="relative">
                    <select
                      required
                      value={form.country}
                      onChange={(e) => update("country", e.target.value)}
                      className="w-full pl-4 pr-10 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-colors appearance-none bg-white text-slate-700"
                    >
                      <option value="">Select your country</option>
                      {["Zambia", "Zimbabwe", "Kenya", "South Africa", "Nigeria", "Ghana", "Tanzania", "Uganda", "Rwanda", "Other"].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Industry</label>
                  <div className="relative">
                    <select
                      required
                      value={form.industry}
                      onChange={(e) => update("industry", e.target.value)}
                      className="w-full pl-4 pr-10 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition-colors appearance-none bg-white text-slate-700"
                    >
                      <option value="">Select your industry</option>
                      {INDUSTRIES.map((i) => (
                        <option key={i} value={i}>{i}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Where is your business right now?</label>
                  <div className="space-y-2">
                    {STAGES.map(({ value, label }) => (
                      <label
                        key={value}
                        className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors"
                        style={{
                          borderColor: form.stage === value ? "#0e7490" : "#e2e8f0",
                          background: form.stage === value ? "#f0f9ff" : "white",
                        }}
                      >
                        <input
                          type="radio"
                          name="stage"
                          value={value}
                          checked={form.stage === value}
                          onChange={(e) => update("stage", e.target.value)}
                          className="accent-cyan-600"
                        />
                        <span className="text-sm text-slate-700">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !form.stage}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-all mt-2"
                  style={{ background: loading || !form.stage ? "#94a3b8" : "#0e7490" }}
                >
                  {loading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <>
                      Create My Account <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-slate-400 pt-1">
                  By creating an account you agree to our{" "}
                  <Link href="#" className="underline">Terms</Link> and{" "}
                  <Link href="#" className="underline">Privacy Policy</Link>
                </p>
              </form>
            </>
          )}

          <p className="text-center text-sm text-slate-500 mt-6">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold" style={{ color: "#0e7490" }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
