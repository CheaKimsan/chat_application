import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import InviteForm from "../components/auth/InviteUser";

export default function InviteButton() {
    const [isOpen, setIsOpen] = useState<boolean>(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #2A2D32',
                    background: '#101317',
                    color: '#E7E3DA',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 13,
                }}
            >
                <UserPlus size={14} />
                Invite
            </button>

            {isOpen && (
                <div
                    onClick={() => setIsOpen(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 50,
                        padding: 16,
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()} // don't close when clicking inside the card
                        style={{ position: 'relative' }}
                    >
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            aria-label="Close"
                            style={{
                                position: 'absolute',
                                top: -12,
                                right: -12,
                                background: '#2A2D32',
                                border: 'none',
                                color: '#fff',
                                borderRadius: '9999px',
                                padding: 6,
                                cursor: 'pointer',
                                display: 'flex',
                            }}
                        >
                            <X size={16} />
                        </button>
                        <InviteForm />
                    </div>
                </div>
            )}
        </>
    );
}