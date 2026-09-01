import { useState, FormEvent, ChangeEvent } from "react";
import { Mail, UserPlus } from "lucide-react";
import {handleInviteSubmit, validateInviteEmail} from "./core/action";

export default function InviteForm() {
    const [email, setEmail] = useState<string>("");
    const [error, setError] = useState<string | undefined>(undefined);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [sentTo, setSentTo] = useState<string | undefined>(undefined);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        setEmail(e.target.value);
        if (error) setError(undefined);
    };
    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const validationError = validateInviteEmail(email);
        if (validationError) {
            setError(validationError);
            return;
        }
        setIsSubmitting(true);
        try {
            await handleInviteSubmit(email);
            setSentTo(email);
            setEmail("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
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