import { useEffect, useRef, useState } from "react";
import { Camera, Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { sendCallSignal } from "../../socket/socketClient";
import { reqCreateCallHistory } from "../message/core/request";
import "../../assets/css/style.css";

type CallMode = "audio" | "video";
type CallStatus = "calling" | "incoming" | "connected" | "completed" | "missed" | "rejected" | "busy" | "failed";
type CallRecord = {
    id: string;
    mode: CallMode;
    status: CallStatus;
    createdAt: string;
    durationSeconds?: number;
    direction: "incoming" | "outgoing";
    call_id?: string;
};

type CallSignal = {
    type: "call_offer" | "call_answer" | "ice_candidate" | "call_end" | "call_reject" | "call_busy" | "call_failed";
    from_user: string;
    to_user: string;
    call_id: string;
    sdp?: string;
    candidate?: string;
    sdp_m_line_index?: number | null;
    sdp_mid?: string | null;
};

interface CallPanelProps {
    contactId?: string | number;
}

const rtcConfig: RTCConfiguration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function CallPanel({ contactId }: CallPanelProps) {
    const [callState, setCallState] = useState<"idle" | "calling" | "incoming" | "connected">("idle");
    const [callMode, setCallMode] = useState<CallMode>("audio");
    const [incomingMode, setIncomingMode] = useState<CallMode>("audio");
    const [callId, setCallId] = useState<string | null>(null);
    const [callerId, setCallerId] = useState<string | null>(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const peerRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const pendingOfferRef = useRef<string | null>(null);
    const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
    const activeCallIdRef = useRef<string | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const callStartedAtRef = useRef<number | null>(null);
    const callTimeoutRef = useRef<number | null>(null);

    const addHistory = (status: CallStatus, mode: CallMode, durationSeconds?: number, direction: "incoming" | "outgoing" = "outgoing") => {
        if (!contactId) return;
        const record: CallRecord = {
            id: crypto.randomUUID(),
            mode,
            status,
            createdAt: new Date().toISOString(),
            durationSeconds,
            direction,
            call_id: activeCallIdRef.current ?? undefined,
        };
        const previous: CallRecord[] = JSON.parse(localStorage.getItem(`call-history-${contactId}`) || "[]");
        const next = [record, ...previous].slice(0, 30);
        localStorage.setItem(`call-history-${contactId}`, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("chat:call_history", { detail: { contactId, records: next } }));
        void reqCreateCallHistory({
            call_id: record.call_id ?? record.id,
            to_user: String(contactId),
            mode,
            status,
            duration_seconds: durationSeconds,
        }).catch((error) => console.error("Failed to save call history:", error));
    };

    const finishHistory = (status: CallStatus, mode: CallMode) => {
        const startedAt = callStartedAtRef.current;
        addHistory(status, mode, startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : undefined);
        callStartedAtRef.current = null;
    };

    const clearCall = () => {
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        peerRef.current?.close();
        peerRef.current = null;
        localStreamRef.current = null;
        activeCallIdRef.current = null;
        if (callTimeoutRef.current) window.clearTimeout(callTimeoutRef.current);
        callTimeoutRef.current = null;
        remoteStreamRef.current = null;
        pendingOfferRef.current = null;
        pendingCandidatesRef.current = [];
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        setCallState("idle");
        setCallId(null);
        setCallerId(null);
        setIsMuted(false);
        setIsCameraOff(false);
    };

    const createPeer = (targetUser: string, currentCallId: string, mode: CallMode) => {
        const peer = new RTCPeerConnection(rtcConfig);
        peer.onicecandidate = (event) => {
            if (!event.candidate) return;
            sendCallSignal({
                kind: "ice_candidate",
                to_user: targetUser,
                call_id: currentCallId,
                candidate: event.candidate.candidate,
                sdp_m_line_index: event.candidate.sdpMLineIndex,
                sdp_mid: event.candidate.sdpMid,
            });
        };
        peer.ontrack = (event) => {
            remoteStreamRef.current = event.streams[0];
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
        };
        peer.onconnectionstatechange = () => {
            if (["failed", "closed", "disconnected"].includes(peer.connectionState)) clearCall();
        };
        peerRef.current = peer;
        setCallMode(mode);
        return peer;
    };

    const getLocalMedia = async (mode: CallMode) => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        stream.getAudioTracks().forEach((track) => { track.enabled = true; });
        return stream;
    };

    const startCall = async (mode: CallMode) => {
        if (!contactId || callState !== "idle") return;
        const targetUser = String(contactId);
        const currentCallId = crypto.randomUUID();
        activeCallIdRef.current = currentCallId;
        try {
            const stream = await getLocalMedia(mode);
            const peer = createPeer(targetUser, currentCallId, mode);
            stream.getTracks().forEach((track) => peer.addTrack(track, stream));
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            setCallId(currentCallId);
            setCallState("calling");
            setStatusMessage(null);
            callStartedAtRef.current = Date.now();
            addHistory("calling", mode);
            sendCallSignal({ kind: "call_offer", to_user: targetUser, call_id: currentCallId, sdp: offer.sdp ?? "" });
            callTimeoutRef.current = window.setTimeout(() => {
                if (activeCallIdRef.current !== currentCallId) return;
                sendCallSignal({ kind: "call_end", to_user: targetUser, call_id: currentCallId });
                finishHistory("failed", mode);
                setStatusMessage("Call failed: no answer");
                clearCall();
            }, 15000);
        } catch (error) {
            console.error("Could not start call:", error);
            clearCall();
        }
    };

    const rejectCall = () => {
        if (callerId && callId) sendCallSignal({ kind: "call_reject", to_user: callerId, call_id: callId });
        finishHistory("rejected", incomingMode);
        setStatusMessage("Call rejected");
        clearCall();
    };

    const endCall = () => {
        const targetUser = callerId ?? (contactId ? String(contactId) : null);
        if (targetUser && callId) sendCallSignal({ kind: "call_end", to_user: targetUser, call_id: callId });
        finishHistory(callState === "connected" ? "completed" : "missed", callMode);
        setStatusMessage(callState === "connected" ? "Call ended" : "Call cancelled");
        clearCall();
    };

    useEffect(() => {
        const handleSignal = async (event: Event) => {
            const signal = (event as CustomEvent<CallSignal>).detail;
            if (!signal) return;

            // Incoming offers must be handled even when the caller is not
            // the contact currently open in the chat.
            const expectedUser = callerId ?? (contactId ? String(contactId) : null);
            if (signal.type !== "call_offer" && String(signal.from_user) !== String(expectedUser)) return;

            try {
                if (signal.type === "call_offer") {
                    if (callState !== "idle") {
                        sendCallSignal({ kind: "call_busy", to_user: signal.from_user, call_id: signal.call_id });
                        return;
                    }
                    setCallerId(signal.from_user);
                    setCallId(signal.call_id);
                    activeCallIdRef.current = signal.call_id;
                    pendingOfferRef.current = signal.sdp ?? null;
                    pendingCandidatesRef.current = [];
                    setIncomingMode(signal.sdp?.includes("m=video") ? "video" : "audio");
                    setStatusMessage(null);
                    addHistory("incoming", signal.sdp?.includes("m=video") ? "video" : "audio", undefined, "incoming");
                    setCallState("incoming");
                    return;
                }

                if (["call_reject", "call_busy", "call_failed"].includes(signal.type)) {
                    const status = signal.type === "call_reject" ? "rejected" : signal.type === "call_busy" ? "busy" : "failed";
                    finishHistory(status, callMode);
                    setStatusMessage(signal.type === "call_busy" ? "User is busy" : signal.type === "call_failed" ? "Call failed: user is offline" : "Call rejected");
                    clearCall();
                    return;
                }

                if (signal.type === "ice_candidate" && signal.candidate && signal.call_id === activeCallIdRef.current) {
                    const candidate = {
                        candidate: signal.candidate,
                        sdpMLineIndex: signal.sdp_m_line_index ?? undefined,
                        sdpMid: signal.sdp_mid ?? undefined,
                    };
                    if (!peerRef.current || !peerRef.current.remoteDescription) {
                        pendingCandidatesRef.current.push(candidate);
                    } else {
                        await peerRef.current.addIceCandidate(candidate);
                    }
                    return;
                }

                if (!peerRef.current || signal.call_id !== activeCallIdRef.current) return;
                if (signal.type === "call_answer" && signal.sdp) {
                    await peerRef.current.setRemoteDescription({ type: "answer", sdp: signal.sdp });
                    for (const candidate of pendingCandidatesRef.current) {
                        await peerRef.current.addIceCandidate(candidate);
                    }
                    pendingCandidatesRef.current = [];
                    setCallState("connected");
                    setStatusMessage(null);
                    callStartedAtRef.current = callStartedAtRef.current ?? Date.now();
                    addHistory("connected", callMode);
                } else if (signal.type === "call_end") {
                    finishHistory("completed", callMode);
                    setStatusMessage("Call ended");
                    clearCall();
                }
            } catch (error) {
                console.error("Call signaling failed:", error);
                finishHistory("failed", incomingMode);
                setStatusMessage("Call failed");
                clearCall();
            }
        };

        window.addEventListener("chat:call", handleSignal);
        return () => window.removeEventListener("chat:call", handleSignal);
    }, [callId, callState, callerId, contactId]);

    const acceptCall = async () => {
        if (!callerId || !callId) return;
        try {
            const stream = await getLocalMedia(incomingMode);
            const peer = createPeer(callerId, callId, incomingMode);
            stream.getTracks().forEach((track) => peer.addTrack(track, stream));
            if (!pendingOfferRef.current) throw new Error("Call offer is missing.");
            await peer.setRemoteDescription({ type: "offer", sdp: pendingOfferRef.current });
            for (const candidate of pendingCandidatesRef.current) {
                await peer.addIceCandidate(candidate);
            }
            pendingCandidatesRef.current = [];
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            setCallState("connected");
            sendCallSignal({ kind: "call_answer", to_user: callerId, call_id: callId, sdp: answer.sdp ?? "" });
        } catch (error) {
            console.error("Could not accept call:", error);
            rejectCall();
        }
    };

    if (!contactId && callState === "idle") return null;

    if (callState === "idle") {
        return (
            <div className="call-panel-wrapper">
                <div className="call-actions">
                    <button type="button" className="call-action-button" title="Start audio call" onClick={() => startCall("audio")}><Phone size={16} /></button>
                    <button type="button" className="call-action-button" title="Start video call" onClick={() => startCall("video")}><Video size={16} /></button>
                </div>
                {statusMessage && <div className="call-status-message">{statusMessage}</div>}
            </div>
        );
    }

    return (
        <section className="call-panel">
            {callState === "incoming" ? (
                <div className="call-incoming">
                    <span>{incomingMode === "video" ? "Incoming video call" : "Incoming audio call"}</span>
                    <button type="button" className="call-action-button call-action-button--accept" onClick={acceptCall} title="Accept call"><Phone size={16} /></button>
                    <button type="button" className="call-action-button call-action-button--reject" onClick={rejectCall} title="Reject call"><PhoneOff size={16} /></button>
                </div>
            ) : (
                <div className="call-active">
                    <video ref={(element) => { remoteVideoRef.current = element; if (element && remoteStreamRef.current) element.srcObject = remoteStreamRef.current; }} autoPlay playsInline className="call-remote-video" />
                    <video ref={(element) => { localVideoRef.current = element; if (element && localStreamRef.current) element.srcObject = localStreamRef.current; }} autoPlay muted playsInline className={`call-local-video${callMode === "audio" ? " call-local-video--audio" : ""}`} />
                    <span>{callState === "calling" ? "Calling..." : "Connected"}</span>
                    <button type="button" className="call-action-button" onClick={() => { localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = isMuted; }); setIsMuted(!isMuted); }} title="Toggle microphone">{isMuted ? <MicOff size={16} /> : <Mic size={16} />}</button>
                    {callMode === "video" && <button type="button" className="call-action-button" onClick={() => { localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = isCameraOff; }); setIsCameraOff(!isCameraOff); }} title="Toggle camera">{isCameraOff ? <VideoOff size={16} /> : <Camera size={16} />}</button>}
                    <button type="button" className="call-action-button call-action-button--reject" onClick={endCall} title="End call"><PhoneOff size={16} /></button>
                </div>
            )}
        </section>
    );
}
