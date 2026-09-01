import { useState, FormEvent, ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import Logo from "../../../../src/assets/image/message-image.png";
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
        <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
            <div className="w-full max-w-md bg-slate-800 rounded-2xl shadow-lg p-8">
                <div className="mb-8 text-center">
                    <div className="w-24 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                        <img src={Logo} alt="" />
                    </div>
                    <h1 className="text-2xl font-semibold text-white">Forgot password?</h1>
                    <p className="text-white text-sm mt-1">
                        {submitted
                            ? "Check your inbox for a reset link"
                            : "Enter your email and we'll send you a reset link"}
                    </p>
                </div>

                {submitted ? (
                    <div className="space-y-5">
                        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-4 py-3">
                            If an account exists for <span className="font-medium">{email}</span>, a
                            password reset link is on its way. It expires in 15 minutes.
                        </div>
                        <p className="text-center text-sm text-slate-500">
                            <Link to="/" className="text-indigo-600 hover:text-indigo-700 font-medium">
                                Back to sign in
                            </Link>
                        </p>
                    </div>
                ) : (
                    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-2">
                                {error}
                            </div>
                        )}

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
                                    value={email}
                                    onChange={handleChange}
                                    placeholder="you@example.com"
                                    className={`w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${error ? "border-red-400" : "border-slate-300"
                                    }`}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium py-2.5 rounded-lg transition"
                        >
                            {isSubmitting ? "Sending..." : "Send reset link"}
                        </button>

                        <p className="text-center text-sm text-slate-500">
                            Remembered your password?{" "}
                            <Link to="/" className="text-indigo-600 hover:text-indigo-700 font-medium">
                                Back to sign in
                            </Link>
                        </p>
                    </form>
                )}
            </div>
        </div>
    );
}