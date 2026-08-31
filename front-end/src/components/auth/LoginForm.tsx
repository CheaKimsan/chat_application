import { useState, FormEvent, ChangeEvent, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, User } from "lucide-react";
import { FormData, FormErrors } from "./core/model";
import { loginRequest } from "../../api/requestAuth";
import axios from "axios";
import { useAuthStore } from "../../store/auth.store";
import Logo from "../../assets/image/message-image.png"

export default function LoginForm() {
    const navigate = useNavigate();
    const [formData, setFormData] = useState<FormData>({ username: "", password: "" });
    const [showPassword, setShowPassword] = useState<boolean>(false);
    const [errors, setErrors] = useState<FormErrors>({});
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        if (errors[name as keyof FormErrors]) {
            setErrors((prev) => ({ ...prev, [name]: undefined }));
        }
    };

    const validate = (): FormErrors => {
        const newErrors: FormErrors = {};
        if (!formData.username) {
            newErrors.username = "Username is required";
        } else if (formData.username.length < 3) {
            newErrors.username = "Username must be at least 3 characters";
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
            // loginRequest now handles BOTH storing the tokens (via
            // setTokens in apiClient.ts) and connecting the socket
            // internally — nothing extra needed here.
            const data = await loginRequest(formData);

            useAuthStore.getState().setUser(data.user, data.access_token);

            navigate("/dashboard");
        } catch (err) {
            let message = "Login failed. Please try again.";
            if (axios.isAxiosError(err)) {
                message = err.response?.data?.message ?? message;
            }
            setErrors({ form: message });
        } finally {
            setIsSubmitting(false);
        }
    };

    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const interval = setInterval(() => {
            setTime(new Date());
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
            <div className="w-full max-w-md bg-slate-800 rounded-2xl shadow-lg p-8">
                <div className="mb-8 text-center">
                    <div className="w-24 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                        <img src={Logo} alt="" />
                    </div>
                    <h1 className="text-2xl font-semibold text-white">Welcome back</h1>
                    <p className="text-white text-sm mt-1">Sign in to your account</p>
                    <p className="text-slate-400 text-md mt-2 tabular-nums ">
                        {time.toLocaleTimeString()}
                    </p>
                </div>

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
                                className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${errors.username ? "border-red-400" : "border-slate-300"
                                    }`}
                            />
                        </div>
                        {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
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
                                className={`w-full pl-10 pr-10 py-2.5 rounded-lg border text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${errors.password ? "border-red-400" : "border-slate-300"
                                    }`}
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

                    <div className="flex items-center justify-between text-sm">
                        <label className="flex items-center gap-2 text-slate-600">
                            <input type="checkbox" className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                            Remember me
                        </label>
                        <a href="/forgot-password" className="text-indigo-600 hover:text-indigo-700 font-medium">
                            Forgot password?
                        </a>
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium py-2.5 rounded-lg transition"
                    >
                        {isSubmitting ? "Signing in..." : "Sign in"}
                    </button>
                </form>

                <p className="text-center text-sm text-slate-500 mt-6">
                    Don't have an account?{" "}
                    <Link to={"/register"} className="text-indigo-600 hover:text-indigo-700 font-medium">
                        Sign up
                    </Link>
                </p>
            </div>
        </div>
    );
}