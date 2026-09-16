import { useState, useEffect, FormEvent, ChangeEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Lock, User, Mail, MessageSquare, MailCheck } from "lucide-react";
import axios from "axios";
import { RegisterFormData, RegisterFormErrors } from "./core/model";
import { validateInviteRequest } from "./core/requestInvite";
import { registerRequest, verifyEmailRequest, resendVerificationRequest } from "./core/requestRegister";
import { exportPublicKeyBase64, generateAndStoreKeyPair } from "../../../socket/crypto";

export default function RegisterForm() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inviteToken = searchParams.get("invite");

    const [formData, setFormData] = useState<RegisterFormData>({
        username: "",
        email: "",
        password: "",
    });
    const [showPassword, setShowPassword] = useState<boolean>(false);
    const [errors, setErrors] = useState<RegisterFormErrors>({});
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [otpSent, setOtpSent] = useState<boolean>(false);
    const [otpCode, setOtpCode] = useState<string>("");
    const [resendCooldown, setResendCooldown] = useState<number>(0);

    const [inviteEmailLocked, setInviteEmailLocked] = useState<boolean>(false);
    const [checkingInvite, setCheckingInvite] = useState<boolean>(!!inviteToken);
    const [inviteError, setInviteError] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = window.setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
        return () => window.clearTimeout(timer);
    }, [resendCooldown]);

    useEffect(() => {
        if (!inviteToken) return;

        validateInviteRequest(inviteToken)
            .then((res) => {
                setFormData((prev) => ({ ...prev, email: res.email }));
                setInviteEmailLocked(true);
            })
            .catch((err) => {
                let message = "This invite link is invalid or has expired.";
                if (axios.isAxiosError(err)) {
                    message = err.response?.data?.message ?? message;
                }
                setInviteError(message);
            })
            .finally(() => setCheckingInvite(false));
    }, [inviteToken]);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        if (errors[name as keyof RegisterFormErrors]) {
            setErrors((prev) => ({ ...prev, [name]: undefined }));
        }
    };

    const validate = (): RegisterFormErrors => {
        const newErrors: RegisterFormErrors = {};
        if (!formData.username) {
            newErrors.username = "Username is required";
        } else if (formData.username.length < 3) {
            newErrors.username = "Username must be at least 3 characters";
        }
        if (!formData.email) {
            newErrors.email = "Email is required";
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            newErrors.email = "Enter a valid email";
        }
        if (!formData.password) {
            newErrors.password = "Password is required";
        } else if (formData.password.length < 6) {
            newErrors.password = "Password must be at least 6 characters";
        }
        return newErrors;
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const newErrors = validate();
        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        setIsSubmitting(true);
        try {
            const keyPair = await generateAndStoreKeyPair();
            const publicKey = await exportPublicKeyBase64(keyPair.publicKey);

            await registerRequest({
                username: formData.username,
                email: formData.email,
                password: formData.password,
                public_key: publicKey,
                ...(inviteToken ? { invite_token: inviteToken } : {}),
            });

            setOtpSent(true);
            setOtpCode("");
            setErrors({});
            setResendCooldown(30);
        } catch (err) {
            let message = "Registration failed. Please try again.";
            if (axios.isAxiosError(err)) {
                message = err.response?.data?.message ?? message;
            }
            setErrors({ form: message });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleVerifyOTP = async () => {
        if (!otpCode.trim()) {
            setErrors((prev) => ({ ...prev, otp: "OTP is required" }));
            return;
        }

        try {
            await verifyEmailRequest({ email: formData.email, otp: otpCode.trim() });
            navigate("/");
        } catch (err) {
            let message = "Invalid or expired OTP.";
            if (axios.isAxiosError(err)) {
                message = err.response?.data?.message ?? message;
            }
            setErrors({ ...errors, otp: message });
        }
    };

    const handleResendOTP = async () => {
        if (resendCooldown > 0) return;

        try {
            await resendVerificationRequest(formData.email);
            setResendCooldown(30);
            setErrors((prev) => ({ ...prev, otp: undefined }));
        } catch (err) {
            let message = "Could not resend verification code.";
            if (axios.isAxiosError(err)) {
                message = err.response?.data?.message ?? message;
            }
            setErrors((prev) => ({ ...prev, otp: message }));
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#0B0C0D] px-4 py-8 relative overflow-hidden">
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
                {/* Card */}
                <div className="bg-[#131518] border border-[#23262A] rounded-3xl shadow-[0_24px_64px_rgba(0,0,0,0.5)] p-8 sm:p-10">

                    {/* Header */}
                    <div className="mb-8 text-center">
                        <div className="w-20 h-20 bg-gradient-to-br from-[#5FBDB2] to-[#4FA9A0] rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-[0_8px_24px_rgba(79,169,160,0.35)]">
                            {otpSent ? (
                                <MailCheck className="w-10 h-10 text-[#0B0C0D]" strokeWidth={2.2} />
                            ) : (
                                <MessageSquare className="w-10 h-10 text-[#0B0C0D]" strokeWidth={2.2} />
                            )}
                        </div>
                        <h1 className="text-2xl font-semibold text-[#E7E3DA] tracking-tight [font-family:'Space_Grotesk',sans-serif]">
                            {otpSent ? "Check your email" : "Create your account"}
                        </h1>
                        <p className="text-[#8B92A0] text-sm mt-1.5">
                            {otpSent
                                ? "We sent you a 6-digit verification code"
                                : inviteEmailLocked
                                    ? "You've been invited — finish setting up your account"
                                    : "Sign up to get started"}
                        </p>
                    </div>

                    {/* Invite checking */}
                    {checkingInvite && (
                        <div className="mb-5 flex items-center justify-center gap-2 text-sm text-[#8B92A0]">
                            <span className="w-3.5 h-3.5 border-2 border-[#4FA9A0]/30 border-t-[#4FA9A0] rounded-full animate-spin" />
                            Checking your invite...
                        </div>
                    )}

                    {/* Invite error */}
                    {inviteError && (
                        <div className="mb-5 bg-[#450A0A]/60 border border-[#7F1D1D] text-[#FECACA] text-sm rounded-xl px-4 py-3 flex items-start gap-2.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#E27D7D] mt-1.5 flex-shrink-0" />
                            <span>{inviteError}</span>
                        </div>
                    )}

                    {!otpSent ? (
                        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                            {errors.form && (
                                <div className="bg-[#450A0A]/60 border border-[#7F1D1D] text-[#FECACA] text-sm rounded-xl px-4 py-3 flex items-start gap-2.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#E27D7D] mt-1.5 flex-shrink-0" />
                                    <span>{errors.form}</span>
                                </div>
                            )}

                            {/* Username */}
                            <div>
                                <label htmlFor="username" className="block text-xs font-semibold text-[#8B92A0] uppercase tracking-wider mb-2">
                                    Username
                                </label>
                                <div className="relative group">
                                    <User className="w-4 h-4 text-[#565C66] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors group-focus-within:text-[#4FA9A0]" />
                                    <input
                                        id="username"
                                        name="username"
                                        type="text"
                                        value={formData.username}
                                        onChange={handleChange}
                                        placeholder="yourusername"
                                        className={`w-full pl-10 pr-4 py-3 rounded-xl bg-[#0B0C0D] border text-sm text-[#E7E3DA] placeholder-[#565C66] focus:outline-none focus:ring-2 focus:ring-[#4FA9A0]/30 focus:border-[#4FA9A0] transition-all duration-200 ${errors.username
                                            ? "border-[#E27D7D] focus:border-[#E27D7D] focus:ring-[#E27D7D]/25"
                                            : "border-[#23262A] hover:border-[#2A2D32]"
                                            }`}
                                    />
                                </div>
                                {errors.username && (
                                    <p className="text-[#E27D7D] text-xs mt-1.5 pl-1">{errors.username}</p>
                                )}
                            </div>

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
                                        value={formData.email}
                                        onChange={inviteEmailLocked ? undefined : handleChange}
                                        readOnly={inviteEmailLocked}
                                        placeholder="you@example.com"
                                        className={`w-full pl-10 pr-4 py-3 rounded-xl bg-[#0B0C0D] border text-sm text-[#E7E3DA] placeholder-[#565C66] focus:outline-none focus:ring-2 focus:ring-[#4FA9A0]/30 focus:border-[#4FA9A0] transition-all duration-200 ${errors.email
                                            ? "border-[#E27D7D] focus:border-[#E27D7D] focus:ring-[#E27D7D]/25"
                                            : "border-[#23262A] hover:border-[#2A2D32]"
                                            } ${inviteEmailLocked ? "opacity-70 cursor-not-allowed hover:border-[#23262A]" : ""}`}
                                    />
                                    {inviteEmailLocked && (
                                        <Lock className="w-3.5 h-3.5 text-[#4FA9A0] absolute right-3.5 top-1/2 -translate-y-1/2" />
                                    )}
                                </div>
                                {errors.email && (
                                    <p className="text-[#E27D7D] text-xs mt-1.5 pl-1">{errors.email}</p>
                                )}
                            </div>

                            {/* Password */}
                            <div>
                                <label htmlFor="password" className="block text-xs font-semibold text-[#8B92A0] uppercase tracking-wider mb-2">
                                    Password
                                </label>
                                <div className="relative group">
                                    <Lock className="w-4 h-4 text-[#565C66] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors group-focus-within:text-[#4FA9A0]" />
                                    <input
                                        id="password"
                                        name="password"
                                        type={showPassword ? "text" : "password"}
                                        value={formData.password}
                                        onChange={handleChange}
                                        placeholder="••••••••"
                                        className={`w-full pl-10 pr-11 py-3 rounded-xl bg-[#0B0C0D] border text-sm text-[#E7E3DA] placeholder-[#565C66] focus:outline-none focus:ring-2 focus:ring-[#4FA9A0]/30 focus:border-[#4FA9A0] transition-all duration-200 ${errors.password
                                            ? "border-[#E27D7D] focus:border-[#E27D7D] focus:ring-[#E27D7D]/25"
                                            : "border-[#23262A] hover:border-[#2A2D32]"
                                            }`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((prev) => !prev)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#565C66] hover:text-[#4FA9A0] hover:bg-[#4FA9A0]/10 transition-colors"
                                        tabIndex={-1}
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {errors.password && (
                                    <p className="text-[#E27D7D] text-xs mt-1.5 pl-1">{errors.password}</p>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full relative mt-2 bg-gradient-to-b from-[#5FBDB2] to-[#4FA9A0] hover:from-[#6FCBC0] hover:to-[#5FBDB2] disabled:from-[#2A2D32] disabled:to-[#2A2D32] disabled:cursor-not-allowed text-[#0B0C0D] disabled:text-[#565C66] font-semibold text-sm py-3 rounded-xl transition-all duration-200 shadow-[0_8px_20px_rgba(79,169,160,0.25)] hover:shadow-[0_12px_28px_rgba(79,169,160,0.4)] hover:-translate-y-0.5 active:translate-y-0 disabled:shadow-none disabled:hover:translate-y-0"
                            >
                                {isSubmitting ? (
                                    <span className="inline-flex items-center gap-2 justify-center">
                                        <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                        Creating account...
                                    </span>
                                ) : (
                                    "Sign up"
                                )}
                            </button>
                        </form>
                    ) : (
                        <div className="space-y-5">
                            {/* Info banner */}
                            <div className="rounded-xl border border-[#4FA9A0]/30 bg-[#4FA9A0]/10 p-4 text-sm text-[#A9F3E4] flex items-start gap-3">
                                <MailCheck className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#4FA9A0]" />
                                <span>
                                    We sent a 6-digit code to{" "}
                                    <span className="font-semibold text-[#E7E3DA]">{formData.email}</span>
                                </span>
                            </div>

                            {/* OTP input */}
                            <div>
                                <label htmlFor="otp" className="block text-xs font-semibold text-[#8B92A0] uppercase tracking-wider mb-2">
                                    Verification code
                                </label>
                                <input
                                    id="otp"
                                    name="otp"
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                    placeholder="123456"
                                    className={`w-full px-4 py-3.5 rounded-xl bg-[#0B0C0D] border text-center text-2xl font-bold tracking-[0.4em] text-[#E7E3DA] placeholder-[#565C66] placeholder:tracking-[0.2em] focus:outline-none focus:ring-2 focus:ring-[#4FA9A0]/30 focus:border-[#4FA9A0] transition-all duration-200 [font-family:'Space_Grotesk',sans-serif] ${errors.otp
                                        ? "border-[#E27D7D] focus:border-[#E27D7D] focus:ring-[#E27D7D]/25"
                                        : "border-[#23262A] hover:border-[#2A2D32]"
                                        }`}
                                />
                                {errors.otp && (
                                    <p className="text-[#E27D7D] text-xs mt-1.5 pl-1">{errors.otp}</p>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3 pt-1">
                                <button
                                    type="button"
                                    onClick={handleVerifyOTP}
                                    className="flex-1 bg-gradient-to-b from-[#5FBDB2] to-[#4FA9A0] hover:from-[#6FCBC0] hover:to-[#5FBDB2] text-[#0B0C0D] font-semibold text-sm py-3 rounded-xl transition-all duration-200 shadow-[0_8px_20px_rgba(79,169,160,0.25)] hover:shadow-[0_12px_28px_rgba(79,169,160,0.4)] hover:-translate-y-0.5 active:translate-y-0"
                                >
                                    Verify email
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResendOTP}
                                    disabled={resendCooldown > 0}
                                    className="flex-1 bg-[#1A1D21] hover:bg-[#20242A] disabled:bg-[#15181C] disabled:cursor-not-allowed border border-[#23262A] hover:border-[#2A2D32] text-[#E7E3DA] disabled:text-[#565C66] font-semibold text-sm py-3 rounded-xl transition-all duration-200"
                                >
                                    {resendCooldown > 0 ? `Resend (${resendCooldown}s)` : "Resend code"}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Footer */}
                    <div className="mt-8 pt-6 border-t border-[#23262A] text-center">
                        <p className="text-sm text-[#8B92A0]">
                            Already have an account?{" "}
                            <Link
                                to="/"
                                className="text-[#4FA9A0] hover:text-[#5FBDB2] font-medium transition-colors"
                            >
                                Sign in
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Footer note */}
                <p className="text-center text-xs text-[#565C66] mt-6">
                    Secured with end-to-end encryption
                </p>
            </div>
        </div>
    );
}