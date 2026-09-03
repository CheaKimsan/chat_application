import { useState, useEffect, FormEvent, ChangeEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Lock, User, Mail } from "lucide-react";
import axios from "axios";
import Logo from "../../../../src/assets/image/message-image.png";
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
        <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
            <div className="w-full max-w-md bg-slate-800 rounded-2xl shadow-lg p-8">
                <div className="mb-8 text-center">
                    <div className="w-24 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                        <img src={Logo} alt="" />
                    </div>
                    <h1 className="text-2xl font-semibold text-white">Create your account</h1>
                    <p className="text-white text-sm mt-1">
                        {inviteEmailLocked ? "You've been invited — finish setting up your account" : "Sign up to get started"}
                    </p>
                </div>

                {checkingInvite && (
                    <p className="text-sm text-slate-400 text-center mb-4">Checking your invite...</p>
                )}

                {inviteError && (
                    <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-2 mb-4">
                        {inviteError}
                    </div>
                )}

                {!otpSent ? (
                    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                        {errors.form && (
                            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-2">
                                {errors.form}
                            </div>
                        )}

                        <div>
                            <label htmlFor="username" className="block text-sm font-medium text-white mb-1.5">
                                Username
                            </label>
                            <div className="relative">
                                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    id="username"
                                    name="username"
                                    type="text"
                                    value={formData.username}
                                    onChange={handleChange}
                                    placeholder="yourusername"
                                    className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${errors.username ? "border-red-400" : "border-slate-300"}`}
                                />
                            </div>
                            {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
                        </div>

                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-white mb-1.5">
                                Email
                            </label>
                            <div className="relative">
                                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    value={formData.email}
                                    onChange={inviteEmailLocked ? undefined : handleChange}
                                    readOnly={inviteEmailLocked}
                                    placeholder="you@example.com"
                                    className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${errors.email ? "border-red-400" : "border-slate-300"} ${inviteEmailLocked ? "bg-slate-100 cursor-not-allowed" : ""}`}
                                />
                            </div>
                            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-white mb-1.5">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    id="password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    value={formData.password}
                                    onChange={handleChange}
                                    placeholder="••••••••"
                                    className={`w-full pl-10 pr-10 py-2.5 rounded-lg border text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${errors.password ? "border-red-400" : "border-slate-300"}`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium py-2.5 rounded-lg transition"
                        >
                            {isSubmitting ? "Creating account..." : "Sign up"}
                        </button>
                    </form>
                ) : (
                    <div className="space-y-5">
                        <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 p-4 text-sm text-indigo-100">
                            We sent a 6-digit code to <span className="font-semibold">{formData.email}</span>.
                        </div>

                        <div>
                            <label htmlFor="otp" className="block text-sm font-medium text-white mb-1.5">
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
                                className={`w-full px-4 py-2.5 rounded-lg border text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${errors.otp ? "border-red-400" : "border-slate-300"}`}
                            />
                            {errors.otp && <p className="text-red-500 text-xs mt-1">{errors.otp}</p>}
                        </div>

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={handleVerifyOTP}
                                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg transition"
                            >
                                Verify email
                            </button>
                            <button
                                type="button"
                                onClick={handleResendOTP}
                                disabled={resendCooldown > 0}
                                className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-500 text-white font-medium py-2.5 rounded-lg transition"
                            >
                                {resendCooldown > 0 ? `Resend (${resendCooldown}s)` : "Resend"}
                            </button>
                        </div>
                    </div>
                )}

                <p className="text-center text-sm text-slate-500 mt-6">
                    Already have an account?{" "}
                    <Link to={"/"} className="text-indigo-600 hover:text-indigo-700 font-medium">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}