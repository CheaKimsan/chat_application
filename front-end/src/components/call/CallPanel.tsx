import { useEffect, useRef, useState } from "react";
import { Camera, Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { sendCallSignal, sendMediaSignal } from "../../socket/socketClient";
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
    reason?: string;
};

type MediaSignal = {
    type: "media_answer" | "media_offer" | "media_ice_candidate" | "media_failed";
    call_id: string;
    sdp?: string;
    candidate?: string;
    sdp_m_line_index?: number | null;
    sdp_mid?: string | null;
    reason?: string;
};

interface CallPanelProps {
    contactId?: string | number;
}

const rtcConfig: RTCConfiguration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// Small helper so every log line has a consistent, greppable prefix and a
// millisecond-precision timestamp — makes it easy to line up caller vs
// callee console output side by side when diagnosing connect-time delays.
const logTiming = (label: string, callId?: string | null) => {
    const suffix = callId ? ` (call ${callId})` : "";
    console.log(`[${new Date().toISOString()}] ${label}${suffix}`);
};

export default function CallPanel({ contactId }: CallPanelProps) {
    const [callState, setCallState] = useState<"idle" | "calling" | "incoming" | "connected">("idle");
    const [callMode, setCallMode] = useState<CallMode>("audio");
    const [incomingMode, setIncomingMode] = useState<CallMode>("audio");
    const [callId, setCallId] = useState<string | null>(null);
    const [callerId, setCallerId] = useState<string | null>(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [networkQuality, setNetworkQuality] = useState<"excellent" | "good" | "fair" | "poor">("good");
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const callStateRef = useRef<"idle" | "calling" | "incoming" | "connected">("idle");
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
    const qualityTimerRef = useRef<number | null>(null);
    const ringtoneTimerRef = useRef<number | null>(null);
    const ringtoneContextRef = useRef<AudioContext | null>(null);
    const callPanelRef = useRef<HTMLElement | null>(null);
    const historyFinishedRef = useRef(false);
    // Caches the in-flight/resolved getUserMedia() call so it's only ever
    // requested once per call, even if we pre-warm it on incoming-call UI
    // and then acceptCall() asks for it again — both share the same promise.
    const localMediaRequestRef = useRef<{ mode: CallMode; promise: Promise<MediaStream> } | null>(null);

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
        if (historyFinishedRef.current) return;
        historyFinishedRef.current = true;
        const startedAt = callStartedAtRef.current;
        addHistory(status, mode, startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : undefined);
        callStartedAtRef.current = null;
    };

    const updateNetworkQuality = async () => {
        const peer = peerRef.current;
        if (!peer) return;

        const stats = await peer.getStats();
        const statEntries = Array.from(stats.values());
        let rttMs = 0;
        let packetLoss = 0;
        let packetTotal = 0;

        for (const stat of statEntries) {
            if (stat.type === "candidate-pair" && stat.state === "succeeded") {
                if (typeof stat.currentRoundTripTime === "number") {
                    rttMs = stat.currentRoundTripTime * 1000;
                }
            }

            if (stat.type === "inbound-rtp") {
                packetLoss += Number(stat.packetsLost ?? 0);
                packetTotal += Number(stat.packetsReceived ?? 0);
            }

            if (stat.type === "outbound-rtp") {
                packetLoss += Number(stat.packetsLost ?? 0);
            }
        }

        const lossPercent = packetTotal > 0 ? (packetLoss / Math.max(1, packetLoss + packetTotal)) * 100 : 0;

        if (rttMs < 120 && lossPercent < 1) setNetworkQuality("excellent");
        else if (rttMs < 220 && lossPercent < 3) setNetworkQuality("good");
        else if (rttMs < 400 && lossPercent < 8) setNetworkQuality("fair");
        else setNetworkQuality("poor");
    };

    useEffect(() => {
        callStateRef.current = callState;
    }, [callState]);

    const stopRingtone = () => {
        if (ringtoneTimerRef.current) window.clearInterval(ringtoneTimerRef.current);
        ringtoneTimerRef.current = null;
        void ringtoneContextRef.current?.close();
        ringtoneContextRef.current = null;
    };

    const playRingtonePing = () => {
        const context = ringtoneContextRef.current;
        if (!context || context.state === "closed") return;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, context.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(660, context.currentTime + 0.18);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.24);
    };

    useEffect(() => {
        if (callState !== "incoming") {
            stopRingtone();
            return;
        }

        try {
            const context = new AudioContext();
            ringtoneContextRef.current = context;
            void context.resume().then(() => playRingtonePing()).catch(() => undefined);
            ringtoneTimerRef.current = window.setInterval(playRingtonePing, 1600);
        } catch {
            // Browsers can block audio until the user interacts with the page.
        }

        return stopRingtone;
    }, [callState]);

    const clearCall = () => {
        stopRingtone();
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        peerRef.current?.close();
        peerRef.current = null;
        localStreamRef.current = null;
        localMediaRequestRef.current = null;
        activeCallIdRef.current = null;
        if (callTimeoutRef.current) window.clearTimeout(callTimeoutRef.current);
        callTimeoutRef.current = null;
        if (qualityTimerRef.current) window.clearInterval(qualityTimerRef.current);
        qualityTimerRef.current = null;
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
        setIsFullscreen(false);
        setNetworkQuality("good");
    };

    const createPeer = (targetUser: string, currentCallId: string, mode: CallMode) => {
        logTiming("createPeer called", currentCallId);
        const peer = new RTCPeerConnection(rtcConfig);
        peer.oniceconnectionstatechange = () => {
            logTiming(`ICE state: ${peer.iceConnectionState}`, currentCallId);
        };

        // Fires on gathering progress — useful to see if candidate
        // gathering itself (rather than connectivity checks) is slow.
        peer.onicegatheringstatechange = () => {
            logTiming(`ICE gathering state: ${peer.iceGatheringState}`, currentCallId);
        };

        peer.onicecandidate = (event) => {
            if (!event.candidate) return;
            sendMediaSignal({
                kind: "media_ice_candidate",
                call_id: currentCallId,
                candidate: event.candidate.candidate,
                sdp_m_line_index: event.candidate.sdpMLineIndex,
                sdp_mid: event.candidate.sdpMid,
            });
        };
        peer.ontrack = (event) => {
            logTiming(`ontrack: ${event.track.kind}`, currentCallId);
            const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
            const existingStream = remoteStreamRef.current;
            if (existingStream && existingStream !== remoteStream && !existingStream.getTracks().some((track) => track.id === event.track.id)) {
                existingStream.addTrack(event.track);
            }
            remoteStreamRef.current = existingStream ?? remoteStream;
            setRemoteStreamVersion((v) => v + 1); // triggers the effect above, once
        };
        peer.onconnectionstatechange = () => {
            logTiming(`Connection state: ${peer.connectionState}`, currentCallId);

            if (["failed", "closed"].includes(peer.connectionState)) {
                if (callStateRef.current !== "idle") {
                    finishHistory("failed", mode);
                    setStatusMessage("Call failed: connection closed");
                }
                clearCall();
                return;
            }

            if (peer.connectionState === "disconnected") {
                setStatusMessage("Connection unstable, retrying...");
            }
        };
        peerRef.current = peer;
        setCallMode(mode);

        if (qualityTimerRef.current) window.clearInterval(qualityTimerRef.current);
        qualityTimerRef.current = window.setInterval(() => {
            void updateNetworkQuality();
        }, 2000);

        return peer;
    };

    // Requests (and caches) local media for the given mode. Safe to call
    // more than once for the same call — e.g. once to pre-warm as soon as
    // the incoming-call UI is shown, and again inside acceptCall() — both
    // calls share the same underlying getUserMedia() request instead of
    // prompting/initializing the camera twice.
    const getLocalMedia = (mode: CallMode): Promise<MediaStream> => {
        const cached = localMediaRequestRef.current;
        if (cached && cached.mode === mode) {
            return cached.promise;
        }
        if (cached) {
            // Stale request for a different mode (e.g. audio pre-warmed,
            // then call turned out to be video) — stop it once it resolves.
            void cached.promise.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
            localMediaRequestRef.current = null;
        }
        const promise = (async () => {
            const t0 = performance.now();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
            logTiming(`getUserMedia resolved in ${(performance.now() - t0).toFixed(0)}ms`, activeCallIdRef.current);
            localStreamRef.current = stream;
            if (localVideoRef.current) localVideoRef.current.srcObject = stream;
            stream.getAudioTracks().forEach((track) => { track.enabled = true; });
            return stream;
        })();
        localMediaRequestRef.current = { mode, promise };
        return promise;
    };


    console.log(remoteStreamRef);


    const startCall = async (mode: CallMode) => {
        if (!contactId || callState !== "idle") return;
        const targetUser = String(contactId);
        const currentCallId = crypto.randomUUID();
        activeCallIdRef.current = currentCallId;
        logTiming("startCall", currentCallId);
        setCallId(currentCallId);
        setCallState("calling");
        setStatusMessage(mode === "video" ? "Starting camera..." : "Starting microphone...");
        try {
            const stream = await getLocalMedia(mode);
            const peer = createPeer(targetUser, currentCallId, mode);
            stream.getTracks().forEach((track) => peer.addTrack(track, stream));

            logTiming("stream-id :", stream.id);

            const offerStartedAt = performance.now();
            const offer = await peer.createOffer();
            logTiming(`createOffer resolved in ${(performance.now() - offerStartedAt).toFixed(0)}ms`, currentCallId);
            const localDescriptionStartedAt = performance.now();
            await peer.setLocalDescription(offer);
            logTiming(`setLocalDescription resolved in ${(performance.now() - localDescriptionStartedAt).toFixed(0)}ms`, currentCallId);
            setStatusMessage(null);
            callStartedAtRef.current = Date.now();
            historyFinishedRef.current = false;
            addHistory("calling", mode);
            sendCallSignal({ kind: "call_offer", to_user: targetUser, call_id: currentCallId, sdp: offer.sdp ?? "" });
            sendMediaSignal({ kind: "media_offer", call_id: currentCallId, sdp: offer.sdp ?? "" });
            logTiming("media_offer sent", currentCallId);
            callTimeoutRef.current = window.setTimeout(() => {
                if (activeCallIdRef.current !== currentCallId) return;
                if (callStateRef.current !== "calling") return;
                sendCallSignal({ kind: "call_end", to_user: targetUser, call_id: currentCallId });
                sendMediaSignal({ kind: "media_end", call_id: currentCallId });
                finishHistory("failed", mode);
                setStatusMessage("Call failed: no answer");
                clearCall();
            }, 30000);
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
        if (callId) sendMediaSignal({ kind: "media_end", call_id: callId });
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
                    historyFinishedRef.current = false;
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



    useEffect(() => {
        const handleMediaSignal = async (event: Event) => {
            const signal = (event as CustomEvent<MediaSignal>).detail;
            if (!signal || signal.call_id !== activeCallIdRef.current || !peerRef.current) return;

            logTiming(`media signal received: ${signal.type}`, signal.call_id);

            try {
                if (signal.type === "media_ice_candidate" && signal.candidate) {
                    const candidate = new RTCIceCandidate({
                        candidate: signal.candidate,
                        sdpMLineIndex: signal.sdp_m_line_index ?? undefined,
                        sdpMid: signal.sdp_mid ?? undefined,
                    });
                    if (!peerRef.current.remoteDescription) pendingCandidatesRef.current.push(candidate);
                    else await peerRef.current.addIceCandidate(candidate);
                    return;
                }
                if (signal.type === "media_failed") throw new Error(signal.reason || "Pion media negotiation failed");
                if (!signal.sdp) return;

                if (signal.type === "media_answer") {
                    await peerRef.current.setRemoteDescription({ type: "answer", sdp: signal.sdp });
                    for (const candidate of pendingCandidatesRef.current) await peerRef.current.addIceCandidate(candidate);
                    pendingCandidatesRef.current = [];
                    setCallState("connected");
                    setStatusMessage(null);
                    return;
                }

                await peerRef.current.setRemoteDescription({ type: "offer", sdp: signal.sdp });
                const answer = await peerRef.current.createAnswer();
                await peerRef.current.setLocalDescription(answer);
                sendMediaSignal({ kind: "media_answer", call_id: signal.call_id, sdp: answer.sdp ?? "" });
                logTiming("media_answer sent", signal.call_id);
                setCallState("connected");
            } catch (error) {
                console.error("Pion media negotiation failed:", error);
                setStatusMessage("Call media failed");
                clearCall();
            }
        };

        window.addEventListener("chat:media", handleMediaSignal);
        return () => window.removeEventListener("chat:media", handleMediaSignal);
    }, []);

    // Pre-warm the camera/mic as soon as the incoming-call UI is shown,
    // instead of waiting for the user to tap Accept. getUserMedia() (plus
    // any first-use permission prompt) was previously entirely inside the
    // critical path after Accept was clicked — this overlaps it with the
    // time the user spends looking at the incoming-call card, so by the
    // time they tap Accept the stream is often already ready.
    useEffect(() => {
        if (callState === "incoming") {
            logTiming("incoming UI shown", callId);
            void getLocalMedia(incomingMode).catch((error) => {
                // Don't surface this yet — acceptCall() will retry and
                // report the real error to the user if it still fails.
                console.error("Pre-warm getUserMedia failed:", error);
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [callState, incomingMode, callId]);

    const [remoteStreamVersion, setRemoteStreamVersion] = useState(0);

    // bump this only when ontrack actually assigns/updates remoteStreamRef
    useEffect(() => {
        if (remoteVideoRef.current && remoteStreamRef.current) {
            remoteVideoRef.current.srcObject = remoteStreamRef.current;
        }
    }, [remoteStreamVersion]);

    const acceptCall = async () => {
        if (!callerId || !callId) return;
        logTiming("acceptCall", callId);
        try {
            const stream = await getLocalMedia(incomingMode);
            const peer = createPeer(callerId, callId, incomingMode);
            stream.getTracks().forEach((track) => peer.addTrack(track, stream));
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            setCallState("connected");
            sendMediaSignal({ kind: "media_offer", call_id: callId, sdp: offer.sdp ?? "" });
            logTiming("media_offer sent (acceptCall)", callId);
        } catch (error) {
            console.error("Could not accept call:", error);
            const reason = error instanceof Error ? error.message : "Unable to access microphone or camera";
            if (callerId && callId) {
                sendCallSignal({ kind: "call_end", to_user: callerId, call_id: callId });
                sendMediaSignal({ kind: "media_end", call_id: callId });
            }
            finishHistory("failed", incomingMode);
            setStatusMessage(`Call failed: ${reason}`);
            clearCall();
        }
    };

    useEffect(() => {
        const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === callPanelRef.current);
        document.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
    }, []);

    if (callState === "idle") {
        return (
            <div className="call-panel-wrapper">
                <div className="call-actions">
                    <button type="button" className="call-action-button call-action-button--ghost" title="Start audio call" onClick={() => startCall("audio")}>
                        <Phone size={16} />
                        <span>Audio</span>
                    </button>
                    <button type="button" className="call-action-button call-action-button--primary" title="Start video call" onClick={() => startCall("video")}>
                        <Video size={16} />
                        <span>Video</span>
                    </button>
                </div>
                {statusMessage && <div className="call-status-message">{statusMessage}</div>}
            </div>
        );
    }

    const toggleFullscreen = async () => {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await callPanelRef.current?.requestFullscreen();
            }
        } catch (error) {
            console.error("Fullscreen request failed:", error);
        }
    };

    return (
        <section ref={callPanelRef} className={`call-panel${isFullscreen ? " call-panel--fullscreen" : ""}`}>
            {callState === "incoming" ? (
                <div className="call-incoming-card">
                    <div className="call-header-row">
                        <div className="call-avatar-badge">
                            {incomingMode === "video" ? <Video size={18} /> : <Phone size={18} />}
                        </div>
                        <div className="call-header-copy">
                            <span className="call-tag">Incoming</span>
                            <strong>{incomingMode === "video" ? "Video call" : "Audio call"}</strong>
                        </div>
                    </div>
                    <div className="call-action-row">
                        <button type="button" className="call-action-button call-action-button--accept" onClick={(event) => { event.stopPropagation(); void acceptCall(); }} title="Accept call"><Phone size={18} /></button>
                        <button type="button" className="call-action-button call-action-button--reject" onClick={(event) => { event.stopPropagation(); rejectCall(); }} title="Reject call"><PhoneOff size={18} /></button>
                    </div>
                </div>
            ) : (
                <div className="call-active-card">
                    <div className="call-video-stage">
                        <video
                            ref={(element) => {
                                remoteVideoRef.current = element;
                                if (element && remoteStreamRef.current) element.srcObject = remoteStreamRef.current;
                            }}
                            autoPlay
                            playsInline
                            className="call-remote-video"
                        ></video>
                        <video ref={(element) => { localVideoRef.current = element; if (element && localStreamRef.current) element.srcObject = localStreamRef.current; }} autoPlay muted playsInline className={`call-local-video${callMode === "audio" ? " call-local-video--audio" : ""}`} />
                        <div className="call-badge">{callState === "calling" ? "Calling" : "Connected"}</div>
                        <div className="call-type-chip">{callMode === "video" ? "Video call" : "Audio call"}</div>
                        <div className={`call-quality-badge call-quality-badge--${networkQuality}`}>
                            {networkQuality.charAt(0).toUpperCase() + networkQuality.slice(1)}
                        </div>
                        <button
                            type="button"
                            className="call-fullscreen-button"
                            onClick={(event) => { event.stopPropagation(); toggleFullscreen(); }}
                            title={isFullscreen ? "Exit fullscreen" : "Full screen"}
                        >
                            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                        </button>
                    </div>
                    <div className="call-action-row">
                        <button type="button" className="call-action-button call-action-button--muted" onClick={(event) => { event.stopPropagation(); localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = isMuted; }); setIsMuted(!isMuted); }} title="Toggle microphone">{isMuted ? <MicOff size={18} /> : <Mic size={18} />}</button>
                        {callMode === "video" && <button type="button" className="call-action-button call-action-button--muted" onClick={(event) => { event.stopPropagation(); localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = isCameraOff; }); setIsCameraOff(!isCameraOff); }} title="Toggle camera">{isCameraOff ? <VideoOff size={18} /> : <Camera size={18} />}</button>}
                        <button type="button" className="call-action-button call-action-button--reject" onClick={(event) => { event.stopPropagation(); endCall(); }} title="End call"><PhoneOff size={18} /></button>
                    </div>
                </div>
            )}
        </section>
    );
}