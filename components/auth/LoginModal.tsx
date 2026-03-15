"use client";

/**
 * LoginModal — Two-step email OTP authentication dialog
 *
 * Step 1: Enter email address
 * Step 2: Enter 6-digit OTP code
 *
 * Uses the Notator retro dialog styling.
 */

import { useState, useRef, useEffect, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/AuthContext";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { requestOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const emailInputRef = useRef<HTMLInputElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);

  // Focus input when step changes
  useEffect(() => {
    if (!isOpen) return;
    if (step === "email") emailInputRef.current?.focus();
    else otpInputRef.current?.focus();
  }, [step, isOpen]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setStep("email");
      setEmail("");
      setOtp("");
      setError(null);
      setMessage(null);
      setLoading(false);
    }
  }, [isOpen]);

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await requestOtp(email.trim().toLowerCase());
      setMessage(result.message);
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await verifyOtp(email.trim().toLowerCase(), otp.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="notator-dialog-overlay"
      onClick={onClose}
      id="login-modal-overlay"
    >
      <div
        className="notator-dialog"
        style={{ width: 400 }}
        onClick={(e) => e.stopPropagation()}
        id="login-modal"
      >
        {/* Title bar */}
        <div className="notator-dialog-titlebar">
          <span className="flex-1 font-bold">
            {step === "email" ? "Sign In / Register" : "Enter Code"}
          </span>
          <button
            className="notator-dialog-close"
            onClick={onClose}
            id="login-close-btn"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {step === "email" ? (
            <form onSubmit={handleEmailSubmit}>
              <div className="mb-4 text-center">
                <span className="text-3xl">🎹</span>
                <p className="mt-2 text-sm text-notator-text-muted">
                  Enter your email to join the Notator community
                </p>
              </div>

              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
                Email Address
              </label>
              <input
                ref={emailInputRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="mb-4 w-full rounded border border-notator-border bg-notator-bg px-3 py-2 font-mono text-sm text-notator-text placeholder-notator-text-dim focus:border-notator-accent focus:outline-none"
                id="login-email-input"
              />

              {error && (
                <div className="mb-3 rounded border border-notator-red/30 bg-notator-red/10 px-3 py-2 text-xs text-notator-red">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="notator-btn w-full rounded border-notator-accent bg-notator-accent px-4 py-2.5 text-sm text-white transition-all hover:bg-notator-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                id="login-submit-email"
              >
                {loading ? "Sending..." : "Send Verification Code"}
              </button>

              <p className="mt-3 text-center text-[10px] text-notator-text-dim">
                We&apos;ll send a 6-digit code to your email. No password
                needed.
              </p>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit}>
              <div className="mb-4 text-center">
                <span className="text-3xl">✉️</span>
                {message && (
                  <p className="mt-2 text-sm text-notator-green">{message}</p>
                )}
                <p className="mt-1 text-xs text-notator-text-dim">
                  Sent to <span className="text-notator-accent">{email}</span>
                </p>
              </div>

              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-notator-text-dim">
                6-Digit Code
              </label>
              <input
                ref={otpInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                required
                className="mb-4 w-full rounded border border-notator-border bg-notator-bg px-3 py-3 text-center font-mono text-2xl tracking-[0.5em] text-notator-accent placeholder-notator-text-dim focus:border-notator-accent focus:outline-none"
                id="login-otp-input"
              />

              {error && (
                <div className="mb-3 rounded border border-notator-red/30 bg-notator-red/10 px-3 py-2 text-xs text-notator-red">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="notator-btn w-full rounded border-notator-accent bg-notator-accent px-4 py-2.5 text-sm text-white transition-all hover:bg-notator-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                id="login-submit-otp"
              >
                {loading ? "Verifying..." : "Verify & Sign In"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setOtp("");
                  setError(null);
                }}
                className="mt-2 w-full py-1.5 text-center text-[10px] text-notator-text-dim hover:text-notator-accent"
                id="login-back-btn"
              >
                ← Use a different email
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
