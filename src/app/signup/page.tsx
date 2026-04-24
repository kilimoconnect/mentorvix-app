"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Mail, Lock, User, Building2, ArrowRight, ShieldCheck, ChevronDown, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const INDUSTRIES = [
  "Retail & Trade", "Agriculture & Farming", "Construction",
  "Transport & Logistics", "Food & Hospitality", "Healthcare",
  "Manufacturing", "Technology", "Education", "Other",
];

const STAGES = [
  { value: "idea", label: "Idea stage", sub: "Not yet operating" },
  { value: "operating", label: "Operating", sub: "Less than 2 years" },
  { value: "growing", label: "Growing", sub: "2+ years in business" },
];

const COUNTRIES = [
  "Zambia","Zimbabwe","Kenya","South Africa","Nigeria",
  "Ghana","Tanzania","Uganda","Rwanda","Other"
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.45, ease: [0.22, 1, 0.36, 1] } }),
};

const slideLeft = {
  hidden: { opacity: 0, x: 40 },
  show: { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, x: -40, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
};

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", email: "", password: "",
    businessName: "", industry: "", stage: "", country: "",
  });

  const update = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          full_name: form.name,
          business_name: form.businessName,
          industry: form.industry,
          business_stage: form.stage,
          country: form.country,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id,
        full_name: form.name,
        business_name: form.businessName,
        industry: form.industry,
        business_stage: form.stage,
        country: form.country,
      });
    }

    router.push("/dashboard");
    router.refresh();
  };

  const handleGoogle = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
  };

  return (
    <div className="min-h-screen flex flex-row-reverse">

      {/* RIGHT — white panel with logo + form */}
      <div className="flex-1 flex flex-col px-8 py-8 bg-white overflow-y-auto">
        {/* Logo */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Image src="/logo.png" alt="Mentorvix" width={160} height={54} priority style={{ height: "auto" }} />
        </motion.div>

        <div className="flex-1 flex items-center justify-center py-8">
          <div className="w-full max-w-md">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div key="step1" variants={slideLeft} initial="hidden" animate="show" exit="exit">
                  <motion.div variants={fadeUp} initial="hidden" animate="show" className="mb-8">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest px-3 py-1 rounded-full mb-3" style={{ background: "#f0f9ff", color: "#0e7490" }}>
                      Step 1 of 2
                    </span>
                    <h1 className="text-3xl font-bold text-slate-900 mt-2">Create your account</h1>
                    <p className="text-slate-500 mt-1.5">Free forever — no credit card required</p>
                  </motion.div>

                  {/* Google */}
                  <motion.button
                    variants={fadeUp} initial="hidden" animate="show" custom={1}
                    onClick={handleGoogle} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                    className="w-full flex items-center justify-center gap-3 border border-slate-200 rounded-2xl py-3.5 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all mb-5 shadow-sm"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continue with Google
                  </motion.button>

                  <motion.div variants={fadeUp} initial="hidden" animate="show" custom={2} className="flex items-center gap-3 mb-5">
                    <div className="flex-1 h-px bg-slate-100" />
                    <span className="text-xs text-slate-400 font-medium">OR</span>
                    <div className="flex-1 h-px bg-slate-100" />
                  </motion.div>

                  <form onSubmit={handleStep1} className="space-y-4">
                    {[
                      { label: "Full name", field: "name", type: "text", icon: User, placeholder: "John Banda", custom: 3 },
                      { label: "Email address", field: "email", type: "email", icon: Mail, placeholder: "you@business.com", custom: 4 },
                    ].map(({ label, field, type, icon: Icon, placeholder, custom }) => (
                      <motion.div key={field} variants={fadeUp} initial="hidden" animate="show" custom={custom}>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
                        <div className="relative group">
                          <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-cyan-600 transition-colors" />
                          <input
                            type={type} required
                            value={form[field as keyof typeof form]}
                            onChange={(e) => update(field, e.target.value)}
                            placeholder={placeholder}
                            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all placeholder:text-slate-300 bg-slate-50 focus:bg-white"
                          />
                        </div>
                      </motion.div>
                    ))}

                    <motion.div variants={fadeUp} initial="hidden" animate="show" custom={5}>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                      <div className="relative group">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-cyan-600 transition-colors" />
                        <input
                          type={showPassword ? "text" : "password"} required minLength={8}
                          value={form.password} onChange={(e) => update("password", e.target.value)}
                          placeholder="Min. 8 characters"
                          className="w-full pl-10 pr-11 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all placeholder:text-slate-300 bg-slate-50 focus:bg-white"
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </motion.div>

                    <motion.button
                      variants={fadeUp} initial="hidden" animate="show" custom={6}
                      type="submit" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 mt-2"
                      style={{ background: "linear-gradient(135deg, #0e7490 0%, #0891b2 100%)" }}
                    >
                      Continue <ArrowRight className="w-4 h-4" />
                    </motion.button>
                  </form>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div key="step2" variants={slideLeft} initial="hidden" animate="show" exit="exit">
                  <motion.div variants={fadeUp} initial="hidden" animate="show" className="mb-8">
                    <button onClick={() => setStep(1)} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 mb-4 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Back
                    </button>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest px-3 py-1 rounded-full mb-3" style={{ background: "#f0f9ff", color: "#0e7490" }}>
                      Step 2 of 2
                    </span>
                    <h1 className="text-3xl font-bold text-slate-900 mt-2">About your business</h1>
                    <p className="text-slate-500 mt-1.5">Helps us match you to the right funding</p>
                  </motion.div>

                  <AnimatePresence>
                    {error && (
                      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">
                        {error}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <motion.div variants={fadeUp} initial="hidden" animate="show" custom={1}>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Business name</label>
                      <div className="relative group">
                        <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-cyan-600 transition-colors" />
                        <input type="text" required value={form.businessName} onChange={(e) => update("businessName", e.target.value)}
                          placeholder="Your business name"
                          className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all placeholder:text-slate-300 bg-slate-50 focus:bg-white" />
                      </div>
                    </motion.div>

                    <motion.div variants={fadeUp} initial="hidden" animate="show" custom={2} className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Country", field: "country", options: COUNTRIES },
                        { label: "Industry", field: "industry", options: INDUSTRIES },
                      ].map(({ label, field, options }) => (
                        <div key={field}>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
                          <div className="relative">
                            <select required value={form[field as keyof typeof form]} onChange={(e) => update(field, e.target.value)}
                              className="w-full pl-4 pr-8 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all appearance-none bg-slate-50 focus:bg-white text-slate-700">
                              <option value="">Select...</option>
                              {options.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                          </div>
                        </div>
                      ))}
                    </motion.div>

                    <motion.div variants={fadeUp} initial="hidden" animate="show" custom={3}>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Where is your business right now?</label>
                      <div className="grid grid-cols-3 gap-2">
                        {STAGES.map(({ value, label, sub }) => (
                          <motion.button
                            key={value} type="button"
                            onClick={() => update("stage", value)}
                            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                            className="relative flex flex-col items-start p-3 rounded-xl border text-left transition-all"
                            style={{
                              borderColor: form.stage === value ? "#0e7490" : "#e2e8f0",
                              background: form.stage === value ? "#f0f9ff" : "#f8fafc",
                            }}
                          >
                            {form.stage === value && (
                              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                                className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
                                style={{ background: "#0e7490" }}>
                                <Check className="w-2.5 h-2.5 text-white" />
                              </motion.div>
                            )}
                            <span className="text-xs font-semibold text-slate-800">{label}</span>
                            <span className="text-xs text-slate-400 mt-0.5 leading-tight">{sub}</span>
                          </motion.button>
                        ))}
                      </div>
                    </motion.div>

                    <motion.button
                      variants={fadeUp} initial="hidden" animate="show" custom={4}
                      type="submit" disabled={loading || !form.stage}
                      whileHover={!loading && form.stage ? { scale: 1.01 } : {}}
                      whileTap={!loading && form.stage ? { scale: 0.98 } : {}}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white transition-all shadow-lg shadow-cyan-500/20 mt-2"
                      style={{ background: loading || !form.stage ? "#94a3b8" : "linear-gradient(135deg, #0e7490 0%, #0891b2 100%)" }}
                    >
                      {loading ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (<>Create My Account <ArrowRight className="w-4 h-4" /></>)}
                    </motion.button>

                    <p className="text-center text-xs text-slate-400 pt-1">
                      By signing up you agree to our{" "}
                      <Link href="#" className="underline hover:text-slate-600">Terms</Link> and{" "}
                      <Link href="#" className="underline hover:text-slate-600">Privacy Policy</Link>
                    </p>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
              className="text-center text-sm text-slate-500 mt-8">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold" style={{ color: "#0e7490" }}>Sign in</Link>
            </motion.p>
          </div>
        </div>
      </div>

      {/* LEFT — teal panel, branding only */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-14 relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #042f3d 0%, #0e7490 55%, #0891b2 100%)" }}
      >
        {/* Animated background orbs */}
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.15, 0.25, 0.15] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[-10%] right-[-15%] w-96 h-96 rounded-full"
          style={{ background: "radial-gradient(circle, #38bdf8 0%, transparent 70%)" }}
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute bottom-[-5%] left-[-10%] w-80 h-80 rounded-full"
          style={{ background: "radial-gradient(circle, #0891b2 0%, transparent 70%)" }}
        />

        {/* Step progress */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, duration: 0.6 }}
          className="relative z-10">
          <div className="flex gap-2 mb-12">
            {[1, 2].map((n) => (
              <motion.div key={n} className="h-1 rounded-full flex-1 overflow-hidden bg-white/20">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "white" }}
                  initial={{ width: "0%" }}
                  animate={{ width: step >= n ? "100%" : "0%" }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Main copy */}
        <div className="relative z-10 space-y-8">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.7 }}>
            <h2 className="text-5xl font-bold text-white leading-tight tracking-tight">
              Start Your<br />
              <span style={{ color: "#7dd3fc" }}>Funding</span><br />
              Journey.
            </h2>
            <p className="text-cyan-200 mt-4 text-lg max-w-xs leading-relaxed">
              Answer a few questions. Get a professional funding package — in minutes.
            </p>
          </motion.div>

          <div className="space-y-4">
            {[
              { n: 1, label: "Create your account", done: step > 1, active: step === 1 },
              { n: 2, label: "Tell us about your business", done: false, active: step === 2 },
              { n: 3, label: "Get your funding score", done: false, active: false },
            ].map(({ n, label, done, active }, i) => (
              <motion.div key={n} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
                className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition-all duration-300"
                  style={{
                    background: done ? "#0e7490" : active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.1)",
                    color: done ? "white" : active ? "#0e7490" : "rgba(255,255,255,0.4)",
                    boxShadow: active ? "0 0 0 4px rgba(255,255,255,0.15)" : "none",
                  }}>
                  {done ? <Check className="w-4 h-4" /> : n}
                </div>
                <span className="text-sm font-medium transition-colors duration-300"
                  style={{ color: active ? "white" : done ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.35)" }}>
                  {label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
          className="relative z-10 flex items-center gap-2 text-cyan-300 text-xs">
          <ShieldCheck className="w-4 h-4" />
          <span>Bank-grade encryption · Private & confidential</span>
        </motion.div>
      </div>
    </div>
  );
}
