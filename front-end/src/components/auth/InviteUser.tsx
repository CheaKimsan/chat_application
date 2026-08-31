import { useState, FormEvent, ChangeEvent } from "react";
import { Mail, UserPlus } from "lucide-react";
import axios from "axios";
import { sendInviteRequest } from "../../api/requestAuth";

// Adjust this to however your app actually stores the access token
// (e.g. a context/store, or localStorage under a different key).
function getAccessToken(): string | null {
    return localStorage.getItem("access_token");
}

export default function InviteForm() {
    const [email, setEmail] = useState<string>("");
    const [error, setError] = useState<string | undefined>(undefined);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [sentTo, setSentTo] = useState<string | undefined>(undefined);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        setEmail(e.target.value);
        if (error) setError(undefined);
    };

    const validate = (): string | undefined => {
        if (!email) return "Email is required";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address";
        return undefined;
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const validationError = validate();
        if (validationError) {
            setError(validationError);
            return;
        }

        const accessToken = getAccessToken();
        if (!accessToken) {
            setError("You must be logged in to send invites.");
            return;
        }

        setIsSubmitting(true);
        try {
            await sendInviteRequest(email, accessToken);
            setSentTo(email);
            setEmail("");
        } catch (err) {
            let message = "Something went wrong. Please try again.";
            if (axios.isAxiosError(err)) {
                // Backend returns 409 if the email is already registered
                message = err.response?.data?.message ?? message;
            }
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="w-full max-w-md bg-slate-800 rounded-2xl shadow-lg p-6">
            <div className="flex items-center gap-2 mb-4">
                <UserPlus className="w-5 h-5 text-indigo-400" />
                <h2 className="text-lg font-semibold text-white">Invite someone</h2>
            </div>

            {sentTo && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-4 py-3 mb-4">
                    Invite sent to <span className="font-medium">{sentTo}</span>. It expires in 7 days.
                </div>
            )}

            <form className="space-y-4" noValidate onSubmit={handleSubmit}>
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-2">
                        {error}
                    </div>
                )}

                <div>
                    <label htmlFor="inviteEmail" className="block text-sm font-medium text-white mb-1.5">
                        Email address
                    </label>
                    <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            id="inviteEmail"
                            name="inviteEmail"
                            type="email"
                            value={email}
                            onChange={handleChange}
                            placeholder="friend@example.com"
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
                    {isSubmitting ? "Sending..." : "Send invite"}
                </button>
            </form>
        </div>
    );
}