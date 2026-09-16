import { useState, FormEvent, ChangeEvent } from "react";
import { Mail, UserPlus, CheckCircle2, Send } from "lucide-react";
import { handleInviteSubmit, validateInviteEmail } from "./core/action";

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
        <div className="w-full max-w-md bg-[#131518] border border-[#23262A] rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.35)] p-6">

            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-[#4FA9A0]/12 border border-[#4FA9A0]/30 flex items-center justify-center">
                    <UserPlus className="w-5 h-5 text-[#4FA9A0]" strokeWidth={2.2} />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-[#E7E3DA] [font-family:'Space_Grotesk',sans-serif] tracking-tight">
                        Invite someone
                    </h2>
                    <p className="text-xs text-[#8B92A0] mt-0.5">
                        Send them a link to join
                    </p>
                </div>
            </div>

            {/* Success banner */}
            {sentTo && (
                <div className="bg-[#4FA9A0]/10 border border-[#4FA9A0]/30 text-[#A9F3E4] text-sm rounded-xl px-4 py-3 mb-4 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#4FA9A0]" />
                    <span>
                        Invite sent to <span className="font-semibold text-[#E7E3DA]">{sentTo}</span>.
                        <span className="text-[#8B92A0]"> It expires in 7 days.</span>
                    </span>
                </div>
            )}

            <form className="space-y-4" noValidate onSubmit={handleSubmit}>
                {/* Error banner */}
                {error && (
                    <div className="bg-[#450A0A]/60 border border-[#7F1D1D] text-[#FECACA] text-sm rounded-xl px-4 py-3 flex items-start gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#E27D7D] mt-1.5 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Email input */}
                <div>
                    <label
                        htmlFor="inviteEmail"
                        className="block text-xs font-semibold text-[#8B92A0] uppercase tracking-wider mb-2"
                    >
                        Email address
                    </label>
                    <div className="relative group">
                        <Mail className="w-4 h-4 text-[#565C66] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors group-focus-within:text-[#4FA9A0]" />
                        <input
                            id="inviteEmail"
                            name="inviteEmail"
                            type="email"
                            value={email}
                            onChange={handleChange}
                            placeholder="friend@example.com"
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
                    className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-b from-[#5FBDB2] to-[#4FA9A0] hover:from-[#6FCBC0] hover:to-[#5FBDB2] disabled:from-[#2A2D32] disabled:to-[#2A2D32] disabled:cursor-not-allowed text-[#0B0C0D] disabled:text-[#565C66] font-semibold text-sm py-3 rounded-xl transition-all duration-200 shadow-[0_8px_20px_rgba(79,169,160,0.25)] hover:shadow-[0_12px_28px_rgba(79,169,160,0.4)] hover:-translate-y-0.5 active:translate-y-0 disabled:shadow-none disabled:hover:translate-y-0"
                >
                    {isSubmitting ? (
                        <>
                            <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                            Sending...
                        </>
                    ) : (
                        <>
                            <Send className="w-4 h-4" strokeWidth={2.2} />
                            Send invite
                        </>
                    )}
                </button>
            </form>
        </div>
    );
}