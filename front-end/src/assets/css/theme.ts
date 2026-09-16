// src/assets/css/theme.ts
// Single source of truth for design tokens.
// Import in TS when you need raw values (e.g. inline styles, canvas, JS math).
// The same values are mirrored as CSS variables in chat-ui.css.

export const theme = {
    // Backgrounds
    bg: "#0B0C0D",
    panel: "#131518",
    surface: "#1A1D21",
    surfaceHi: "#20242A",
    elevated: "#17212B", // modals, popovers, call panel

    // Borders
    border: "#23262A",
    borderSoft: "#1C1F23",
    borderHi: "#2A2D32",

    // Text
    text: "#E7E3DA",
    textDim: "#8B92A0",
    textFaint: "#565C66",

    // Brand
    accent: "#4FA9A0",
    accentHi: "#5FBDB2",
    accentDim: "rgba(79, 169, 160, 0.12)",
    accentSoft: "rgba(79, 169, 160, 0.20)",

    // Status
    danger: "#E27D7D",
    dangerBg: "#450A0A",
    dangerBorder: "#7F1D1D",
    warning: "#E2B47D",
    success: "#4FA9A0",
    info: "#6FB1E0",

    // Chat bubbles
    bubbleSelf: "#4FA9A0",
    bubbleSelfText: "#0B0C0D",
    bubbleOther: "#1E2227",
    bubbleOtherText: "#E7E3DA",

    // Radii
    rSm: 8,
    rMd: 12,
    rLg: 16,
    rPill: 999,

    // Shadows
    shadowSoft: "0 4px 16px rgba(0, 0, 0, 0.25)",
    shadowPop: "0 12px 32px rgba(0, 0, 0, 0.45)",

    // Fonts
    fontBody: "'Inter', system-ui, -apple-system, sans-serif",
    fontDisplay: "'Space Grotesk', 'Inter', sans-serif",
} as const;

export type Theme = typeof theme;