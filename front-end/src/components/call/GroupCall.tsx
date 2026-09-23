import { useEffect, useRef, useState } from "react";
import { Camera, Mic, MicOff, Phone, PhoneOff, Users, Video, VideoOff } from "lucide-react";
import { sendCallSignal, sendMediaSignal } from "../../socket/socketClient";
import { useAuthStore } from "../../store/auth.store";
import { reqCreateCallHistory } from "../message/core/request";

type CallMode = "audio" | "video";
type CallState = "idle" | "ringing" | "incoming" | "active";
type CallHistoryStatus = "calling" | "incoming" | "connected" | "completed" | "missed" | "rejected" | "busy" | "failed";

export type GroupMember = { id: string; username: string; profile_photo?: string };

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
    group_call_id?: string;
    members?: string[];
    mode?: CallMode;
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

const rtcConfig: RTCConfiguration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const legIdFor = (groupCallId: string, a: string, b: string) =>
    `${groupCallId}::${[a, b].sort().join("::")}`;

// --- lightweight per-stream speaking detector ---
type SpeakingDetector = {
    ctx: AudioContext;
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    raf: number;
};

const SPEAKING_THRESHOLD = 12;
const SPEAKING_HANGOVER_MS = 400;

function startSpeakingDetector(
    stream: MediaStream,
    setSpeaking: (v: boolean) => void,
    ref: React.MutableRefObject<SpeakingDetector | null>
) {
    stopSpeakingDetector(ref, setSpeaking);
    if (stream.getAudioTracks().length === 0) return;
    let ctx: AudioContext;
    try {
        ctx = new AudioContext();
    } catch {
        return;
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let lastSpokeAt = 0;
    const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const level = sum / data.length;
        const now = performance.now();
        if (level > SPEAKING_THRESHOLD) lastSpokeAt = now;
        setSpeaking(now - lastSpokeAt < SPEAKING_HANGOVER_MS);
        const rafId = requestAnimationFrame(tick);
        if (ref.current) ref.current.raf = rafId;
    };
    const rafId = requestAnimationFrame(tick);
    ref.current = { ctx, source, analyser, raf: rafId };
}

function stopSpeakingDetector(
    ref: React.MutableRefObject<SpeakingDetector | null>,
    setSpeaking?: (v: boolean) => void
) {
    const current = ref.current;
    if (!current) return;
    cancelAnimationFrame(current.raf);
    current.source.disconnect();
    void current.ctx.close();
    ref.current = null;
    setSpeaking?.(false);
}

type Leg = {
    peerId: string;
    pc: RTCPeerConnection;
    remoteStream: MediaStream | null;
    pendingCandidates: RTCIceCandidateInit[];
    hasOffered: boolean;
    speaking: boolean;
    hasRemote: boolean;
    detectorRef: { current: SpeakingDetector | null };
};

interface GroupCallPanelProps {
    conversationId: string;
    members: GroupMember[];
}

export default function GroupCallPanel({ conversationId, members }: GroupCallPanelProps) {
    const currentUser = useAuthStore((s) => s.user);
    const currentUserId = String(currentUser?.id ?? "");

    const [callState, _setCallState] = useState<CallState>("idle");
    const callStateRef = useRef<CallState>("idle");
    const setCallState = (next: CallState) => {
        callStateRef.current = next;
        _setCallState(next);
    };

    const [callMode, setCallMode] = useState<CallMode>("audio");
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [incomingFrom, setIncomingFrom] = useState<string | null>(null);
    const [legVersion, setLegVersion] = useState(0);
    const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);

    const groupCallIdRef = useRef<string | null>(null);
    const rosterRef = useRef<string[]>([]);
    const localStreamRef = useRef<MediaStream | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const legsRef = useRef<Map<string, Leg>>(new Map());
    const localDetectorRef = useRef<SpeakingDetector | null>(null);
    const bufferedMediaRef = useRef<MediaSignal[]>([]);
    const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
    // Call-history tracking — mirrors CallPanel.tsx's addHistory/finishHistory
    // pattern, but writes group_id + participant_ids instead of to_user so
    // the row shows up under GET /groups/:groupId/call-history for everyone
    // on the call, not just a single 1:1 pair.
    const historyFinishedRef = useRef(false);
    const callStartedAtRef = useRef<number | null>(null);

    const bump = () => setLegVersion((v) => v + 1);

    const memberUsername = (id: string) =>
        members.find((m) => String(m.id) === id)?.username ?? id;

    const addHistory = (status: CallHistoryStatus, mode: CallMode, durationSeconds?: number) => {
        if (!groupCallIdRef.current) return;
        const participantIds = rosterRef.current.filter((id) => id !== currentUserId);
        void reqCreateCallHistory({
            call_id: groupCallIdRef.current,
            group_id: conversationId,
            participant_ids: participantIds,
            mode,
            status,
            duration_seconds: durationSeconds,
        }).catch((error) => console.error("Failed to save group call history:", error));
    };

    const finishHistory = (status: CallHistoryStatus, mode: CallMode) => {
        if (historyFinishedRef.current) return;
        historyFinishedRef.current = true;
        const startedAt = callStartedAtRef.current;
        addHistory(status, mode, startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : undefined);
        callStartedAtRef.current = null;
    };

    const getLocalMedia = async (mode: CallMode) => {
        if (localStreamRef.current) return localStreamRef.current;
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: mode === "video",
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        startSpeakingDetector(stream, setIsLocalSpeaking, localDetectorRef);
        return stream;
    };

    const ensureLeg = (peerId: string): Leg => {
        let leg = legsRef.current.get(peerId);
        if (leg) return leg;

        const pc = new RTCPeerConnection(rtcConfig);
        leg = {
            peerId,
            pc,
            remoteStream: null,
            pendingCandidates: [],
            hasOffered: false,
            speaking: false,
            hasRemote: false,
            detectorRef: { current: null },
        };
        legsRef.current.set(peerId, leg);

        pc.onicecandidate = (event) => {
            if (!event.candidate || !groupCallIdRef.current) return;
            sendMediaSignal({
                kind: "media_ice_candidate",
                call_id: legIdFor(groupCallIdRef.current, currentUserId, peerId),
                candidate: event.candidate.candidate,
                sdp_m_line_index: event.candidate.sdpMLineIndex,
                sdp_mid: event.candidate.sdpMid,
            });
        };

        pc.ontrack = (event) => {
            console.log("[GROUP-CALL] 🎥 ontrack:", event.track.kind, "from peer:", peerId);

            const stream = event.streams[0] ?? new MediaStream([event.track]);
            leg!.remoteStream = stream;
            leg!.hasRemote = true;

            const el = videoElsRef.current.get(peerId);
            if (el && el.srcObject !== stream) {
                el.srcObject = stream;
                el.play().catch(() => undefined);
            }

            if (event.track.kind === "audio") {
                startSpeakingDetector(
                    stream,
                    (speaking) => {
                        leg!.speaking = speaking;
                        bump();
                    },
                    leg!.detectorRef
                );
            }
            bump();
        };

        pc.onconnectionstatechange = () => {
            console.log("[GROUP-CALL] 🔗 connection:", peerId, pc.connectionState);
            if (["failed", "closed"].includes(pc.connectionState)) {
                teardownLeg(peerId);
                bump();
            }
        };

        if (localStreamRef.current) {
            localStreamRef.current
                .getTracks()
                .forEach((track) => pc.addTrack(track, localStreamRef.current!));
        }

        return leg;
    };

    const teardownLeg = (peerId: string) => {
        const leg = legsRef.current.get(peerId);
        if (!leg) return;
        stopSpeakingDetector(leg.detectorRef);
        leg.pc.close();
        legsRef.current.delete(peerId);
        videoElsRef.current.delete(peerId);
    };

    const createOfferForLeg = async (peerId: string) => {
        if (!groupCallIdRef.current) return;
        const leg = ensureLeg(peerId);
        if (leg.hasOffered) return;
        leg.hasOffered = true;
        console.log("[GROUP-CALL] 📤 offering →", peerId);
        const offer = await leg.pc.createOffer();
        await leg.pc.setLocalDescription(offer);
        sendMediaSignal({
            kind: "media_offer",
            call_id: legIdFor(groupCallIdRef.current, currentUserId, peerId),
            sdp: offer.sdp ?? "",
        });
    };

    // Both sides always offer — required for server-terminated WebRTC.
    const bootstrapMesh = () => {
        for (const peerId of rosterRef.current) {
            if (peerId === currentUserId) continue;
            void createOfferForLeg(peerId);
        }
        const buffered = bufferedMediaRef.current;
        bufferedMediaRef.current = [];
        buffered.forEach((signal) => void handleMediaSignalForLeg(signal));
    };

    const handleMediaSignalForLeg = async (signal: MediaSignal) => {
        if (!groupCallIdRef.current || !signal.call_id.startsWith(groupCallIdRef.current + "::"))
            return;

        const parts = signal.call_id.split("::");
        const [a, b] = [parts[1], parts[2]];
        const peerId = a === currentUserId ? b : a;
        if (!peerId || peerId === currentUserId) return;

        if (callStateRef.current !== "active") {
            bufferedMediaRef.current.push(signal);
            return;
        }

        const leg = ensureLeg(peerId);
        try {
            if (signal.type === "media_ice_candidate" && signal.candidate) {
                const candidate = {
                    candidate: signal.candidate,
                    sdpMLineIndex: signal.sdp_m_line_index ?? undefined,
                    sdpMid: signal.sdp_mid ?? undefined,
                };
                if (!leg.pc.remoteDescription) leg.pendingCandidates.push(candidate);
                else await leg.pc.addIceCandidate(candidate);
                return;
            }
            if (!signal.sdp) return;

            if (signal.type === "media_offer") {
                await leg.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
                for (const candidate of leg.pendingCandidates)
                    await leg.pc.addIceCandidate(candidate);
                leg.pendingCandidates = [];
                const answer = await leg.pc.createAnswer();
                await leg.pc.setLocalDescription(answer);
                sendMediaSignal({
                    kind: "media_answer",
                    call_id: signal.call_id,
                    sdp: answer.sdp ?? "",
                });
            } else if (signal.type === "media_answer") {
                await leg.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
                for (const candidate of leg.pendingCandidates)
                    await leg.pc.addIceCandidate(candidate);
                leg.pendingCandidates = [];
            }
        } catch (error) {
            console.error("group call leg negotiation failed:", peerId, error);
            teardownLeg(peerId);
            bump();
        }
    };

    const startGroupCall = async (mode: CallMode) => {
        if (members.length === 0 || callState !== "idle") return;
        const newGroupCallId = crypto.randomUUID();
        groupCallIdRef.current = newGroupCallId;
        rosterRef.current = [currentUserId, ...members.map((m) => String(m.id))];
        setCallMode(mode);
        setCallState("active");
        setStatusMessage(mode === "video" ? "Starting camera..." : "Starting microphone...");
        try {
            await getLocalMedia(mode);
            setStatusMessage(null);
            historyFinishedRef.current = false;
            callStartedAtRef.current = Date.now();
            addHistory("calling", mode);
            members.forEach((member) => {
                sendCallSignal({
                    kind: "call_offer",
                    to_user: String(member.id),
                    call_id: newGroupCallId,
                    group_call_id: newGroupCallId,
                    members: rosterRef.current,
                    mode,
                } as any);
            });
            bootstrapMesh();
        } catch (error) {
            console.error("Could not start group call:", error);
            finishHistory("failed", mode);
            endGroupCall();
        }
    };

    const acceptGroupCall = async () => {
        if (!groupCallIdRef.current) return;
        try {
            await getLocalMedia(callMode);
            setCallState("active");
            setStatusMessage(null);
            callStartedAtRef.current = callStartedAtRef.current ?? Date.now();
            addHistory("connected", callMode);
            bootstrapMesh();
        } catch (error) {
            console.error("Could not accept group call:", error);
            finishHistory("failed", callMode);
            declineGroupCall();
        }
    };

    const declineGroupCall = () => {
        if (groupCallIdRef.current && incomingFrom) {
            sendCallSignal({
                kind: "call_reject",
                to_user: incomingFrom,
                call_id: groupCallIdRef.current,
            });
        }
        finishHistory("rejected", callMode);
        resetState();
    };

    const endGroupCall = () => {
        rosterRef.current.forEach((peerId) => {
            if (peerId === currentUserId) return;
            if (groupCallIdRef.current) {
                sendCallSignal({
                    kind: "call_end",
                    to_user: peerId,
                    call_id: groupCallIdRef.current,
                });
            }
        });
        finishHistory(callStateRef.current === "active" ? "completed" : "missed", callMode);
        resetState();
    };

    const resetState = () => {
        stopSpeakingDetector(localDetectorRef, setIsLocalSpeaking);
        legsRef.current.forEach((leg) => {
            stopSpeakingDetector(leg.detectorRef);
            leg.pc.close();
        });
        legsRef.current.clear();
        videoElsRef.current.clear();
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        groupCallIdRef.current = null;
        rosterRef.current = [];
        bufferedMediaRef.current = [];
        setCallState("idle");
        setIncomingFrom(null);
        setIsMuted(false);
        setIsCameraOff(false);
        bump();
    };

    useEffect(() => {
        const handleCallSignal = (event: Event) => {
            const signal = (event as CustomEvent<CallSignal>).detail;
            if (!signal) return;

            if (signal.type === "call_offer" && signal.members && callStateRef.current === "idle") {
                groupCallIdRef.current = signal.call_id;
                rosterRef.current = signal.members;
                setCallMode(signal.mode ?? "audio");
                setIncomingFrom(signal.from_user);
                setCallState("incoming");
                historyFinishedRef.current = false;
                addHistory("incoming", signal.mode ?? "audio");
                return;
            }

            if (signal.call_id !== groupCallIdRef.current) return;

            if (signal.type === "call_end") {
                teardownLeg(signal.from_user);
                bump();
                if (legsRef.current.size === 0 && callStateRef.current === "active") endGroupCall();
            }
            if (signal.type === "call_reject") {
                console.log(`${signal.from_user} declined the group call`);
                teardownLeg(signal.from_user);
                bump();
            }
        };

        const handleMediaSignal = (event: Event) => {
            const signal = (event as CustomEvent<MediaSignal>).detail;
            if (signal) void handleMediaSignalForLeg(signal);
        };

        window.addEventListener("chat:call", handleCallSignal);
        window.addEventListener("chat:media", handleMediaSignal);
        return () => {
            window.removeEventListener("chat:call", handleCallSignal);
            window.removeEventListener("chat:media", handleMediaSignal);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const legs = Array.from(legsRef.current.values());

    // Fallback for remote tiles: pick up streams that arrived before the
    // tile element was in the DOM.
    useEffect(() => {
        legs.forEach((leg) => {
            const el = videoElsRef.current.get(leg.peerId);
            if (el && leg.remoteStream && el.srcObject !== leg.remoteStream) {
                el.srcObject = leg.remoteStream;
                el.play().catch(() => undefined);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [legVersion]);

    // Self-video attach fallback — needed because getLocalMedia() can
    // resolve before the tile element exists in the DOM on the 2nd call.
    useEffect(() => {
        const el = localVideoRef.current;
        const stream = localStreamRef.current;
        if (el && stream && el.srcObject !== stream) {
            el.srcObject = stream;
            el.play().catch(() => undefined);
        }
    }, [callState, legVersion]);

    if (callState === "idle") {
        return (
            <div className="call-panel-wrapper">
                <div className="call-actions">
                    <button
                        type="button"
                        className="call-action-button call-action-button--ghost"
                        title="Start group audio call"
                        onClick={() => void startGroupCall("audio")}
                    >
                        <Phone size={16} />
                        <span>Audio</span>
                    </button>
                    <button
                        type="button"
                        className="call-action-button call-action-button--primary"
                        title="Start group video call"
                        onClick={() => void startGroupCall("video")}
                    >
                        <Video size={16} />
                        <span>Video</span>
                    </button>
                </div>
                {statusMessage && <div className="call-status-message">{statusMessage}</div>}
            </div>
        );
    }

    if (callState === "incoming") {
        return (
            <div className="call-incoming-card">
                <div className="call-header-row">
                    <div className="call-avatar-badge">
                        <Users size={18} />
                    </div>
                    <div className="call-header-copy">
                        <span className="call-tag">Incoming group call</span>
                        <strong>
                            {memberUsername(incomingFrom ?? "")} is calling ({callMode})
                        </strong>
                    </div>
                </div>
                <div className="call-action-row">
                    <button
                        type="button"
                        className="call-action-button call-action-button--accept"
                        onClick={() => void acceptGroupCall()}
                        title="Accept"
                    >
                        <Phone size={18} />
                    </button>
                    <button
                        type="button"
                        className="call-action-button call-action-button--reject"
                        onClick={declineGroupCall}
                        title="Decline"
                    >
                        <PhoneOff size={18} />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <section className="call-panel">
            <div className="call-active-card">
                <div className="call-video-stage call-video-stage--grid">
                    {/* Self tile */}
                    <div className={`call-grid-tile${isLocalSpeaking ? " call-grid-tile--speaking" : ""}`}>
                        <video
                            ref={localVideoRef}
                            autoPlay
                            muted
                            playsInline
                            className={`call-grid-video${callMode === "audio" ? " call-grid-video--audio" : ""}`}
                        />

                        {isLocalSpeaking && (
                            <div className="tile-speaking-badge tile-speaking-badge--local">
                                <span className="tile-speaking-badge__bars">
                                    <i /><i /><i /><i />
                                </span>
                            </div>
                        )}

                        <span className="call-grid-tile__label">You</span>
                    </div>

                    {/* Remote tiles */}
                    {legs.map((leg) => (
                        <div
                            className={`call-grid-tile${leg.hasRemote ? "" : " call-grid-tile--waiting"}${leg.speaking && leg.hasRemote ? " call-grid-tile--speaking" : ""}`}
                            key={leg.peerId}
                        >
                            {leg.hasRemote ? (
                                <video
                                    ref={(element) => {
                                        if (element) {
                                            videoElsRef.current.set(leg.peerId, element);
                                            if (leg.remoteStream && element.srcObject !== leg.remoteStream) {
                                                element.srcObject = leg.remoteStream;
                                                element.play().catch(() => undefined);
                                            }
                                        } else {
                                            videoElsRef.current.delete(leg.peerId);
                                        }
                                    }}
                                    autoPlay
                                    playsInline
                                    className={`call-grid-video${callMode === "audio" ? " call-grid-video--audio" : ""}`}
                                />
                            ) : (
                                <div className="call-grid-waiting">
                                    <div className="call-grid-waiting__avatar">
                                        {memberUsername(leg.peerId).slice(0, 2).toUpperCase()}
                                    </div>
                                    <div className="call-grid-waiting__text">
                                        <span className="call-grid-waiting__name">
                                            {memberUsername(leg.peerId)}
                                        </span>
                                        <span className="call-grid-waiting__status">
                                            <span className="call-grid-waiting__dot" />
                                            Ringing…
                                        </span>
                                    </div>
                                </div>
                            )}

                            {leg.speaking && leg.hasRemote && (
                                <div className="tile-speaking-badge">
                                    <span className="tile-speaking-badge__bars">
                                        <i /><i /><i /><i />
                                    </span>
                                </div>
                            )}

                            <span className="call-grid-tile__label">
                                {memberUsername(leg.peerId)}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="call-action-row">
                    <button
                        type="button"
                        className="call-action-button call-action-button--muted"
                        onClick={() => {
                            localStreamRef.current
                                ?.getAudioTracks()
                                .forEach((t) => {
                                    t.enabled = isMuted;
                                });
                            setIsMuted(!isMuted);
                            setIsLocalSpeaking(false);
                        }}
                        title="Toggle microphone"
                    >
                        {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                    </button>

                    {callMode === "video" && (
                        <button
                            type="button"
                            className="call-action-button call-action-button--muted"
                            onClick={() => {
                                localStreamRef.current
                                    ?.getVideoTracks()
                                    .forEach((t) => {
                                        t.enabled = isCameraOff;
                                    });
                                setIsCameraOff(!isCameraOff);
                            }}
                            title="Toggle camera"
                        >
                            {isCameraOff ? <VideoOff size={18} /> : <Camera size={18} />}
                        </button>
                    )}

                    <button
                        type="button"
                        className="call-action-button call-action-button--reject"
                        onClick={endGroupCall}
                        title="Leave call"
                    >
                        <PhoneOff size={18} />
                    </button>
                </div>
            </div>
        </section>
    );
}