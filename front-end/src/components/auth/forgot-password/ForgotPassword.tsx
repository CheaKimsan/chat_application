import { useState, FormEvent, ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { Mail, KeyRound, MailCheck } from "lucide-react";
import { validateForgotPassword, handleForgotPasswordSubmit } from "./core/action";

export default function ForgotPasswordForm() {
    const [email, setEmail] = useState<string>("");
    const [error, setError] = useState<string | undefined>(undefined);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [submitted, setSubmitted] = useState<boolean>(false);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        setEmail(e.target.value);
        if (error) setError(undefined);
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const validationError = validateForgotPassword(email);
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsSubmitting(true);
        try {
            await handleForgotPasswordSubmit(email);
            setSubmitted(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#0B0C0D] px-4 relative overflow-hidden">
            {/* Ambient glow background */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-[#4FA9A0]/10 blur-[120px]"
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-40 right-0 w-[500px] h-[500px] rounded-full bg-[#4FA9A0]/[0.06] blur-[120px]"
            />

            <div className="relative w-full max-w-md">
                <div className="bg-[#131518] border border-[#23262A] rounded-3xl shadow-[0_24px_64px_rgba(0,0,0,0.5)] p-8 sm:p-10">

                    {/* Header */}
                    <div className="mb-8 text-center">
                        <div className="w-20 h-20 bg-gradient-to-br from-[#5FBDB2] to-[#4FA9A0] rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-[0_8px_24px_rgba(79,169,160,0.35)]">
                            {submitted ? (
                                <MailCheck className="w-10 h-10 text-[#0B0C0D]" strokeWidth={2.2} />
                            ) : (
                                <KeyRound className="w-10 h-10 text-[#0B0C0D]" strokeWidth={2.2} />
                            )}
                        </div>
                        <h1 className="text-2xl font-semibold text-[#E7E3DA] tracking-tight [font-family:'Space_Grotesk',sans-serif]">
                            {submitted ? "Check your inbox" : "Forgot password?"}
                        </h1>
                        <p className="text-[#8B92A0] text-sm mt-1.5">
                            {submitted
                                ? "We've sent you a password reset link"
                                : "Enter your email and we'll send you a reset link"}
                        </p>
                    </div>

                    {submitted ? (
                        <div className="space-y-5">
                            {/* Success banner */}
                            <div className="bg-[#4FA9A0]/10 border border-[#4FA9A0]/30 text-[#A9F3E4] text-sm rounded-xl px-4 py-4 flex items-start gap-3">
                                <MailCheck className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#4FA9A0]" />
                                <span>
                                    If an account exists for{" "}
                                    <span className="font-semibold text-[#E7E3DA]">{email}</span>, a
                                    password reset link is on its way.
                                    <span className="text-[#8B92A0]"> It expires in 15 minutes.</span>
                                </span>
                            </div>

                            <Link
                                to="/"
                                className="block w-full text-center bg-gradient-to-b from-[#5FBDB2] to-[#4FA9A0] hover:from-[#6FCBC0] hover:to-[#5FBDB2] text-[#0B0C0D] font-semibold text-sm py-3 rounded-xl transition-all duration-200 shadow-[0_8px_20px_rgba(79,169,160,0.25)] hover:shadow-[0_12px_28px_rgba(79,169,160,0.4)] hover:-translate-y-0.5 active:translate-y-0"
                            >
                                Back to sign in
                            </Link>
                        </div>
                    ) : (
                        <form className="space-y-5" noValidate onSubmit={handleSubmit}>
                            {/* Error banner */}
                            {error && (
                                <div className="bg-[#450A0A]/60 border border-[#7F1D1D] text-[#FECACA] text-sm rounded-xl px-4 py-3 flex items-start gap-2.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#E27D7D] mt-1.5 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* Email */}
                            <div>
                                <label htmlFor="email" className="block text-xs font-semibold text-[#8B92A0] uppercase tracking-wider mb-2">
                                    Email
                                </label>
                                <div className="relative group">
                                    <Mail className="w-4 h-4 text-[#565C66] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors group-focus-within:text-[#4FA9A0]" />
                                    <input
                                        id="email"
                                        name="email"
                                        type="email"
                                        value={email}
                                        onChange={handleChange}
                                        placeholder="you@example.com"
                                        className={`w-full pl-10 pr-4 py-3 rounded-xl bg-[#0B0C0D] border text-sm text-[#E7E3DA] placeholder-[#565C66] focus:outline-none focus:ring-2 focus:ring-[#4FA9A0]/30 focus:border-[#4FA9A0] transition-all duration-200 ${error
                                            ? "border-[#E27D7D] focus:border-[#E27D7D] focus:ring-[#E27D7D]/25"
                                            : "border-[#23262A] hover:border-[#2A2D32]"
                                            }`}
                                    />
                                </div>
                            </div>

                            {/* Submit */}
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full bg-gradient-to-b from-[#5FBDB2] to-[#4FA9A0] hover:from-[#6FCBC0] hover:to-[#5FBDB2] disabled:from-[#2A2D32] disabled:to-[#2A2D32] disabled:cursor-not-allowed text-[#0B0C0D] disabled:text-[#565C66] font-semibold text-sm py-3 rounded-xl transition-all duration-200 shadow-[0_8px_20px_rgba(79,169,160,0.25)] hover:shadow-[0_12px_28px_rgba(79,169,160,0.4)] hover:-translate-y-0.5 active:translate-y-0 disabled:shadow-none disabled:hover:translate-y-0"
                            >
                                {isSubmitting ? (
                                    <span className="inline-flex items-center gap-2 justify-center">
                                        <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                        Sending...
                                    </span>
                                ) : (
                                    "Send reset link"
                                )}
                            </button>

                            {/* Footer */}
                            <div className="pt-4 border-t border-[#23262A] text-center">
                                <p className="text-sm text-[#8B92A0]">
                                    Remembered your password?{" "}
                                    <Link
                                        to="/"
                                        className="text-[#4FA9A0] hover:text-[#5FBDB2] font-medium transition-colors"
                                    >
                                        Back to sign in
                                    </Link>
                                </p>
                            </div>
                        </form>
                    )}
                </div>

                <p className="text-center text-xs text-[#565C66] mt-6">
                    Secured with end-to-end encryption
                </p>
            </div>
        </div>
    );
}