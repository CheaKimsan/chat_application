export default function TypingIndicator() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 4, height: 16 }}>
            <span style={dotStyle(0)} />
            <span style={dotStyle(0.15)} />
            <span style={dotStyle(0.3)} />
            <style>{`
                @keyframes typingBounce {
                    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
                    30% { transform: translateY(-4px); opacity: 1; }
                }
            `}</style>
        </div>
    );
}

function dotStyle(delay: number): React.CSSProperties {
    return {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#4FA9A0",
        display: "inline-block",
        animation: `typingBounce 1.1s ${delay}s infinite`,
    };
}