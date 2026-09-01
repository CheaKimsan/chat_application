import { formatBytes } from "../utils/formation";
import React from "react";

export const LoadingSpinner = ({ progress, loaded, total, count }: { progress?: number; loaded?: number; total?: number; count?: number }) => (
    <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 16px',
        borderRadius: 12,
        backgroundColor: '#1a1a1a',
        border: '1px solid #333',
        width: 'fit-content'
    }}>
        <div style={{
            width: 16,
            height: 16,
            border: '2px solid #333',
            borderTop: '2px solid #4F46E5',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ color: '#8B92A0', fontSize: 14 }}>
            Uploading{count && count > 1 ? ` ${count} files` : ''}...
            {progress !== undefined && ` ${progress}%`}
            {loaded !== undefined && total !== undefined && ` · ${formatBytes(loaded)} / ${formatBytes(total)}`}
        </span>
    </div>
);