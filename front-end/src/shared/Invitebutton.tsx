import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import InviteForm from "../components/auth/register/InviteUser";

export default function InviteButton() {
    const [isOpen, setIsOpen] = useState<boolean>(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                style={{
                    width: '100%',
                    border: 'none',
                    background: 'transparent',
                    color: '#eef2f7',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 16px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 14,
                    fontWeight: 500,
                }}
            >
                <UserPlus size={18} color="#d9e0ee" />
                <span>Invite user</span>
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
                        onClick={(e) => e.stopPropagation()}
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