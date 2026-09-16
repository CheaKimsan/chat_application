import { useState, FormEvent, ChangeEvent, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, MessageSquare, User } from "lucide-react";
import { FormErrors, FormData } from "./core/login.model";
import { validateLogin, handleLoginSubmit } from "./core/action";

export default function LoginForm() {
    const navigate = useNavigate();
    const [formData, setFormData] = useState<FormData>({ username: "", password: "" });
    const [showPassword, setShowPassword] = useState<boolean>(false);
    const [errors, setErrors] = useState<FormErrors>({});
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    const [time, setTime] = useState(new Date());

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        if (errors[name as keyof FormErrors]) {
            setErrors((prev) => ({ ...prev, [name]: undefined }));
        }
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const newErrors = validateLogin(formData);
        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }
        setIsSubmitting(true);
        try {
            await handleLoginSubmit(formData);
            navigate("/dashboard");
        } catch (err) {
            setErrors({ form: err instanceof Error ? err.message : "Login failed. Please try again." });
        } finally {
            setIsSubmitting(false);
        }
    };

    useEffect(() => {
        const interval = setInterval(() => {
            setTime(new Date());
        }, 1000);

        return () => clearInterval(interval);
    }, []);

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
                {/* Card */}
                <div className="bg-[#131518] border border-[#23262A] rounded-3xl shadow-[0_24px_64px_rgba(0,0,0,0.5)] p-8 sm:p-10">

                    {/* Header */}
                    <div className="mb-8 text-center">
                        <div className="w-20 h-20 bg-gradient-to-br from-[#5FBDB2] to-[#4FA9A0] rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-[0_8px_24px_rgba(79,169,160,0.35)]">
                            <MessageSquare className="w-10 h-10 text-[#0B0C0D]" strokeWidth={2.2} />
                        </div>
                        <h1 className="text-2xl font-semibold text-[#E7E3DA] tracking-tight [font-family:'Space_Grotesk',sans-serif]">
                            Welcome back
                        </h1>
                        <p className="text-[#8B92A0] text-sm mt-1.5">
                            Sign in to continue to your account
                        </p>

                        {/* Live clock */}
                        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1A1D21] border border-[#23262A]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#4FA9A0] animate-pulse" />
                            <span className="text-[#8B92A0] text-xs tabular-nums tracking-wide">
                                {time.toLocaleTimeString()}
                            </span>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                        {/* Form-level error */}
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

                        {/* Remember / Forgot */}
                        <div className="flex items-center justify-between text-sm pt-1">
                            <label className="flex items-center gap-2 text-[#8B92A0] cursor-pointer select-none hover:text-[#E7E3DA] transition-colors">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-[#23262A] bg-[#0B0C0D] text-[#4FA9A0] focus:ring-2 focus:ring-[#4FA9A0]/40 focus:ring-offset-0 cursor-pointer accent-[#4FA9A0]"
                                />
                                <span className="text-xs">Remember me</span>
                            </label>
                            <a
                                href="/forgot-password"
                                className="text-[#4FA9A0] hover:text-[#5FBDB2] text-xs font-medium transition-colors"
                            >
                                Forgot password?
                            </a>
                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full relative mt-2 bg-gradient-to-b from-[#5FBDB2] to-[#4FA9A0] hover:from-[#6FCBC0] hover:to-[#5FBDB2] disabled:from-[#2A2D32] disabled:to-[#2A2D32] disabled:cursor-not-allowed text-[#0B0C0D] disabled:text-[#565C66] font-semibold text-sm py-3 rounded-xl transition-all duration-200 shadow-[0_8px_20px_rgba(79,169,160,0.25)] hover:shadow-[0_12px_28px_rgba(79,169,160,0.4)] hover:-translate-y-0.5 active:translate-y-0 disabled:shadow-none disabled:hover:translate-y-0"
                        >
                            {isSubmitting ? (
                                <span className="inline-flex items-center gap-2 justify-center">
                                    <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                    Signing in...
                                </span>
                            ) : (
                                "Sign in"
                            )}
                        </button>
                    </form>

                    {/* Footer */}
                    <div className="mt-8 pt-6 border-t border-[#23262A] text-center">
                        <p className="text-sm text-[#8B92A0]">
                            Don't have an account?{" "}
                            <Link
                                to="/register"
                                className="text-[#4FA9A0] hover:text-[#5FBDB2] font-medium transition-colors"
                            >
                                Sign up
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