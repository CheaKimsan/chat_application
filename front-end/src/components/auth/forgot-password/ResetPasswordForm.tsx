import { useState, FormEvent, ChangeEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Lock } from "lucide-react";
import Logo from "../../../../src/assets/image/message-image.png";
import { validateResetPassword, handleResetPasswordSubmit } from "./core/action";

export default function ResetPasswordForm() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get("token") ?? "";

    const [newPassword, setNewPassword] = useState<string>("");
    const [confirmPassword, setConfirmPassword] = useState<string>("");
    const [error, setError] = useState<string | undefined>(undefined);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [success, setSuccess] = useState<boolean>(false);

    const handleNewPasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
        setNewPassword(e.target.value);
        if (error) setError(undefined);
    };

    const handleConfirmPasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
        setConfirmPassword(e.target.value);
        if (error) setError(undefined);
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const validationError = validateResetPassword(token, newPassword, confirmPassword);
        if (validationError) {
            setError(validationError);
            return;
        }
        setIsSubmitting(true);
        try {
            await handleResetPasswordSubmit(token, newPassword);
            setSuccess(true);
            setTimeout(() => navigate("/"), 2500);
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
                    <h1 className="text-2xl font-semibold text-white">Reset password</h1>
                    <p className="text-white text-sm mt-1">
                        {success
                            ? "Your password has been changed"
                            : "Enter a new password for your account"}
                    </p>
                </div>

                {success ? (
                    <div className="space-y-5">
                        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-4 py-3">
                            Your password was reset successfully. All other sessions have been signed
                            out. Redirecting you to sign in…
                        </div>
                        <p className="text-center text-sm text-slate-500">
                            <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">
                                Go to sign in now
                            </Link>
                        </p>
                    </div>
                ) : (
                    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-2">
                                {error}
                                {!token && (
                                    <>
                                        {" "}
                                        <Link to="/forgot-password" className="underline font-medium">
                                            Request a new link
                                        </Link>
                                    </>
                                )}
                            </div>
                        )}

                        <div>
                            <label htmlFor="newPassword" className="block text-sm font-medium text-white mb-1.5">
                                New password
                            </label>
                            <div className="relative">
                                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    id="newPassword"
                                    name="newPassword"
                                    type="password"
                                    value={newPassword}
                                    onChange={handleNewPasswordChange}
                                    placeholder="At least 6 characters"
                                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-white mb-1.5">
                                Confirm new password
                            </label>
                            <div className="relative">
                                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={handleConfirmPasswordChange}
                                    placeholder="Re-enter new password"
                                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium py-2.5 rounded-lg transition"
                        >
                            {isSubmitting ? "Resetting..." : "Reset password"}
                        </button>

                        <p className="text-center text-sm text-slate-500">
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