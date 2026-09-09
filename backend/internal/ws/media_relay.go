package ws

import (
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// negotiateDebounce is how long we wait after a track is attached before
// actually sending a renegotiation offer. This lets audio and video tracks
// that arrive within a few milliseconds of each other (the common case)
// get coalesced into a single offer/answer round trip instead of two.
const negotiateDebounce = 150 * time.Millisecond

type mediaPeer struct {
	userID            string
	pc                *webrtc.PeerConnection
	signalMu          sync.Mutex
	pendingCandidates []webrtc.ICECandidateInit
	attachedTracks    map[string]bool
	// videoSSRCs maps a video trackID to the SSRC this peer receives it as,
	// when this peer is the SOURCE of that track. Used to address PLI
	// (keyframe request) RTCP packets back at the right source connection.
	videoSSRCs       map[string]webrtc.SSRC
	negotiating      bool
	needsNegotiation bool
	negotiateTimer   *time.Timer
	disconnectTimer  *time.Timer
}

type mediaSession struct {
	callID string
	users  map[string]*mediaPeer
	tracks map[string]*webrtc.TrackLocalStaticRTP
	// trackOwners maps a track's ID to the userID of the peer who
	// originally published it (i.e. the source, not any subscriber).
	trackOwners map[string]string
}

// MediaRelay terminates browser WebRTC connections on the Go server and
// forwards RTP tracks between the two participants in a call.
type MediaRelay struct {
	mu       sync.Mutex
	sessions map[string]*mediaSession
	send     func(string, any) bool

	turnURL      string
	turnUsername string
	turnPassword string
}

func NewMediaRelay(send func(string, any) bool) *MediaRelay {
	return &MediaRelay{
		sessions:     make(map[string]*mediaSession),
		send:         send,
		turnURL:      os.Getenv("TURN_URL"),
		turnUsername: os.Getenv("TURN_USERNAME"),
		turnPassword: os.Getenv("TURN_PASSWORD"),
	}
}

func (r *MediaRelay) iceServers() []webrtc.ICEServer {
	servers := []webrtc.ICEServer{
		{URLs: []string{"stun:stun.l.google.com:19302"}},
	}
	fmt.Printf("[iceServers] TURN_URL=%q TURN_USERNAME=%q hasPassword=%v\n", r.turnURL, r.turnUsername, r.turnPassword != "")
	if r.turnURL != "" && r.turnUsername != "" && r.turnPassword != "" {
		servers = append(servers, webrtc.ICEServer{
			URLs:       []string{r.turnURL},
			Username:   r.turnUsername,
			Credential: r.turnPassword,
		})
	}
	return servers
}

func (r *MediaRelay) HandleOffer(msg Message) error {
	r.mu.Lock()
	session := r.sessions[msg.CallID]
	if session == nil {
		session = &mediaSession{
			callID:      msg.CallID,
			users:       make(map[string]*mediaPeer),
			tracks:      make(map[string]*webrtc.TrackLocalStaticRTP),
			trackOwners: make(map[string]string),
		}
		r.sessions[msg.CallID] = session
	}
	peer, err := r.ensurePeerLocked(session, msg.FromUser)
	if err != nil {
		r.mu.Unlock()
		return err
	}
	peer.signalMu.Lock()
	defer peer.signalMu.Unlock()
	for sourceID, track := range session.tracks {
		if sourceID != msg.FromUser {
			if !peer.attachedTracks[track.ID()] {
				if _, err := peer.pc.AddTrack(track); err != nil {
					r.mu.Unlock()
					return err
				}
				peer.attachedTracks[track.ID()] = true
			}
		}
	}
	r.mu.Unlock()

	if err := peer.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: msg.SDP}); err != nil {
		return err
	}
	r.mu.Lock()
	pendingCandidates := append([]webrtc.ICECandidateInit(nil), peer.pendingCandidates...)
	peer.pendingCandidates = nil
	r.mu.Unlock()
	for _, candidate := range pendingCandidates {
		if err := peer.pc.AddICECandidate(candidate); err != nil {
			return err
		}
	}
	answer, err := peer.pc.CreateAnswer(nil)
	if err != nil {
		return err
	}
	if err := peer.pc.SetLocalDescription(answer); err != nil {
		return err
	}
	local := peer.pc.LocalDescription()
	if local == nil {
		return fmt.Errorf("pion did not create a local description")
	}
	r.send(msg.FromUser, Message{Type: "media_answer", FromUser: "server", ToUser: msg.FromUser, CallID: msg.CallID, SDP: local.SDP})

	// This peer's initial answer just went out, which means any tracks
	// attached above are (once ICE/DTLS finishes) about to become
	// receivable. Ask each track's source for a fresh keyframe now rather
	// than relying on the periodic keepalive ticker, so the very first
	// frame this peer can decode arrives as soon as possible instead of
	// waiting on that source's next scheduled PLI.
	r.requestKeyframesFor(session, peer, msg.CallID)

	return nil
}

func (r *MediaRelay) ensurePeerLocked(session *mediaSession, userID string) (*mediaPeer, error) {
	if peer := session.users[userID]; peer != nil {
		return peer, nil
	}
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{
		ICEServers: r.iceServers(),
		// NOTE: do not set ICECandidatePoolSize > 1 here — pion only
		// supports 0 or 1, unlike browsers. A value of 2+ makes
		// NewPeerConnection fail with "ice candidate pool size greater
		// than 1 is not supported".
	})
	if err != nil {
		return nil, err
	}
	peer := &mediaPeer{
		userID:         userID,
		pc:             pc,
		attachedTracks: make(map[string]bool),
		videoSSRCs:     make(map[string]webrtc.SSRC),
	}
	session.users[userID] = peer
	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		init := candidate.ToJSON()
		var line *int
		if init.SDPMLineIndex != nil {
			value := int(*init.SDPMLineIndex)
			line = &value
		}
		mid := ""
		if init.SDPMid != nil {
			mid = *init.SDPMid
		}
		r.send(userID, Message{Type: "media_ice_candidate", FromUser: "server", ToUser: userID, CallID: session.callID, Candidate: init.Candidate, SDPMLine: line, SDPMid: mid})
	})
	pc.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		fmt.Printf("[%s] OnTrack fired for %s track=%s kind=%s (call %s)\n",
			time.Now().Format(time.RFC3339Nano), userID, remote.ID(), remote.Kind(), session.callID)
		if remote.Kind() == webrtc.RTPCodecTypeVideo {
			r.mu.Lock()
			peer.videoSSRCs[remote.ID()] = remote.SSRC()
			r.mu.Unlock()
			// Keeps recovering keyframes periodically for the lifetime of
			// this track (loss recovery), independent of the one-shot,
			// correctly-timed request fired from requestKeyframesFor once
			// a subscriber actually finishes negotiating.
			go r.keepAliveKeyframes(pc, remote.SSRC(), session.callID, userID)
		}
		r.forwardTrack(session.callID, userID, remote)
	})

	// ICE state drives recovery: "disconnected" is often transient (brief
	// network blip) and should NOT tear down the call. Only "failed" should
	// trigger an ICE restart, and only after that fails permanently should
	// the peer be removed.
	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		fmt.Printf("[%s] ICE state for %s: %s (call %s)\n",
			time.Now().Format(time.RFC3339Nano), userID, state, session.callID)
		switch state {
		case webrtc.ICEConnectionStateConnected, webrtc.ICEConnectionStateCompleted:
			r.mu.Lock()
			if peer.disconnectTimer != nil {
				peer.disconnectTimer.Stop()
				peer.disconnectTimer = nil
			}
			r.mu.Unlock()

		case webrtc.ICEConnectionStateDisconnected:
			// Give it a grace period to self-recover before doing anything.
			r.mu.Lock()
			if peer.disconnectTimer == nil {
				peer.disconnectTimer = time.AfterFunc(5*time.Second, func() {
					if pc.ICEConnectionState() == webrtc.ICEConnectionStateDisconnected {
						r.restartICE(session.callID, peer)
					}
				})
			}
			r.mu.Unlock()

		case webrtc.ICEConnectionStateFailed:
			r.restartICE(session.callID, peer)
		}
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		// Only remove the peer on a truly terminal state. "failed" here is
		// reached after ICE restart attempts are exhausted by pion itself.
		if state == webrtc.PeerConnectionStateClosed {
			r.removePeer(session.callID, userID)
		}
	})
	return peer, nil
}

// restartICE attempts to recover a degraded connection instead of tearing
// down the whole call and forcing the client to redial from scratch.
func (r *MediaRelay) restartICE(callID string, peer *mediaPeer) {
	peer.signalMu.Lock()
	defer peer.signalMu.Unlock()

	if peer.pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
		return
	}

	offer, err := peer.pc.CreateOffer(&webrtc.OfferOptions{ICERestart: true})
	if err != nil {
		return
	}
	if err := peer.pc.SetLocalDescription(offer); err != nil {
		return
	}
	local := peer.pc.LocalDescription()
	if local == nil {
		return
	}
	r.send(peer.userID, Message{Type: "media_offer", FromUser: "server", ToUser: peer.userID, CallID: callID, SDP: local.SDP})
}

func (r *MediaRelay) AddCandidate(msg Message) error {
	r.mu.Lock()
	session := r.sessions[msg.CallID]
	var peer *mediaPeer
	if session != nil {
		peer = session.users[msg.FromUser]
	}
	r.mu.Unlock()
	if peer == nil {
		return fmt.Errorf("unknown media peer %s", msg.FromUser)
	}
	peer.signalMu.Lock()
	defer peer.signalMu.Unlock()
	var line *uint16
	if msg.SDPMLine != nil {
		value := uint16(*msg.SDPMLine)
		line = &value
	}
	mid := msg.SDPMid
	candidate := webrtc.ICECandidateInit{Candidate: msg.Candidate, SDPMLineIndex: line, SDPMid: &mid}
	if peer.pc.RemoteDescription() == nil {
		r.mu.Lock()
		peer.pendingCandidates = append(peer.pendingCandidates, candidate)
		r.mu.Unlock()
		return nil
	}
	return peer.pc.AddICECandidate(candidate)
}

func (r *MediaRelay) forwardTrack(callID, sourceUser string, remote *webrtc.TrackRemote) {
	track, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, remote.ID(), remote.StreamID())
	if err != nil {
		return
	}
	r.mu.Lock()
	session := r.sessions[callID]
	if session == nil {
		r.mu.Unlock()
		return
	}
	session.tracks[sourceUser] = track
	session.trackOwners[track.ID()] = sourceUser
	var destination *mediaPeer
	for userID, peer := range session.users {
		if userID != sourceUser {
			destination = peer
			break
		}
	}
	if destination != nil && !destination.attachedTracks[track.ID()] {
		if _, err := destination.pc.AddTrack(track); err == nil {
			destination.attachedTracks[track.ID()] = true
		}
	}
	r.mu.Unlock()

	// Schedule (debounced) renegotiation outside the lock. If audio and
	// video tracks both arrive within the debounce window, this collapses
	// into a single offer/answer round trip instead of one per track.
	if destination != nil {
		r.scheduleNegotiate(destination, callID)
	}

	for {
		packet, _, err := remote.ReadRTP()
		if err != nil {
			return
		}
		_ = track.WriteRTP(packet)
	}
}

func (r *MediaRelay) HandleAnswer(msg Message) error {
	r.mu.Lock()
	session := r.sessions[msg.CallID]
	var peer *mediaPeer
	if session != nil {
		peer = session.users[msg.FromUser]
	}
	r.mu.Unlock()
	if peer == nil {
		return fmt.Errorf("unknown media peer %s", msg.FromUser)
	}
	peer.signalMu.Lock()
	if err := peer.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: msg.SDP}); err != nil {
		peer.signalMu.Unlock()
		return err
	}
	r.mu.Lock()
	if peer.needsNegotiation {
		peer.needsNegotiation = false
		peer.negotiating = false
		r.mu.Unlock()
		peer.signalMu.Unlock()
		r.scheduleNegotiate(peer, msg.CallID)
	} else {
		peer.negotiating = false
		r.mu.Unlock()
		peer.signalMu.Unlock()
	}

	// This peer just finished a renegotiation — meaning whatever new
	// track(s) triggered it are now actually receivable by this peer.
	// Ask each track's source for a fresh keyframe right now, rather than
	// waiting on that source's periodic keepalive tick. This is the fix
	// for "connects fine but video takes several seconds to appear": the
	// old code requested a keyframe the moment the track first arrived at
	// the server, which is usually well before this subscriber's
	// renegotiation has actually completed — wasting the on-demand
	// request and leaving the subscriber to wait on the slow periodic
	// fallback instead.
	r.requestKeyframesFor(session, peer, msg.CallID)

	// IMPORTANT: do not unconditionally renegotiate every other peer here.
	// An earlier version did that on every answer, which created an
	// infinite ping-pong: A answers -> renegotiate(B) -> B answers ->
	// renegotiate(A) -> ... forever, since CreateOffer()/SetLocalDescription()
	// happily produce a "valid" offer even when nothing actually changed,
	// so nothing ever broke the cycle.
	//
	// Kicking off negotiation with the other peer as soon as a new track
	// is available is already handled correctly in forwardTrack, which is
	// gated by the attachedTracks map — it only schedules a negotiation
	// once per genuinely new track, not on every answer. That's the only
	// place renegotiation should be triggered from a track/offer event.
	return nil
}

// requestKeyframesFor sends an immediate PLI (keyframe request) to the
// source of every video track currently attached to peer. It must be
// called only once peer's own negotiation (offer/answer) has actually
// completed for those tracks — calling it any earlier wastes the request,
// since the subscriber can't do anything with a keyframe that arrives
// before its own connection is ready to receive it.
func (r *MediaRelay) requestKeyframesFor(session *mediaSession, peer *mediaPeer, callID string) {
	if session == nil || peer == nil {
		return
	}
	type target struct {
		pc   *webrtc.PeerConnection
		ssrc webrtc.SSRC
	}

	r.mu.Lock()
	var targets []target
	for trackID := range peer.attachedTracks {
		sourceUserID, ok := session.trackOwners[trackID]
		if !ok {
			continue
		}
		sourcePeer, ok := session.users[sourceUserID]
		if !ok {
			continue
		}
		ssrc, ok := sourcePeer.videoSSRCs[trackID]
		if !ok {
			continue // not a video track (or SSRC not recorded yet)
		}
		targets = append(targets, target{pc: sourcePeer.pc, ssrc: ssrc})
	}
	r.mu.Unlock()

	for _, t := range targets {
		err := t.pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(t.ssrc)}})
		if err != nil {
			fmt.Printf("[%s] post-negotiation PLI failed (call %s): %v\n",
				time.Now().Format(time.RFC3339Nano), callID, err)
		} else {
			fmt.Printf("[%s] post-negotiation PLI sent (call %s)\n",
				time.Now().Format(time.RFC3339Nano), callID)
		}
	}
}

// scheduleNegotiate debounces renegotiation for a peer. If a negotiation
// is already in flight, it flags that another is needed once the current
// one completes (handled in HandleAnswer). Otherwise it starts (or lets
// run) a short timer so multiple triggers arriving close together (e.g.
// audio + video tracks attaching within milliseconds of each other)
// collapse into one offer instead of several.
func (r *MediaRelay) scheduleNegotiate(peer *mediaPeer, callID string) {
	r.mu.Lock()
	if peer.negotiating {
		peer.needsNegotiation = true
		r.mu.Unlock()
		return
	}
	if peer.negotiateTimer != nil {
		// Already scheduled — this trigger will be covered by the
		// pending timer, nothing more to do.
		r.mu.Unlock()
		return
	}
	fmt.Printf("[%s] scheduleNegotiate: debounce started for %s (call %s)\n",
		time.Now().Format(time.RFC3339Nano), peer.userID, callID)
	peer.negotiateTimer = time.AfterFunc(negotiateDebounce, func() {
		r.mu.Lock()
		peer.negotiateTimer = nil
		peer.negotiating = true
		r.mu.Unlock()
		r.negotiate(peer, callID)
	})
	r.mu.Unlock()
}

func (r *MediaRelay) negotiate(peer *mediaPeer, callID string) {
	fmt.Printf("[%s] negotiate: sending renegotiation offer to %s (call %s)\n",
		time.Now().Format(time.RFC3339Nano), peer.userID, callID)
	peer.signalMu.Lock()
	defer peer.signalMu.Unlock()
	offer, err := peer.pc.CreateOffer(nil)
	if err != nil {
		r.mu.Lock()
		peer.negotiating = false
		r.mu.Unlock()
		return
	}
	if err := peer.pc.SetLocalDescription(offer); err != nil {
		r.mu.Lock()
		peer.negotiating = false
		r.mu.Unlock()
		return
	}
	local := peer.pc.LocalDescription()
	if local == nil {
		r.mu.Lock()
		peer.negotiating = false
		r.mu.Unlock()
		return
	}
	fmt.Printf("[%s] negotiate: media_offer sent to %s (call %s)\n",
		time.Now().Format(time.RFC3339Nano), peer.userID, callID)
	r.send(peer.userID, Message{Type: "media_offer", FromUser: "server", ToUser: peer.userID, CallID: callID, SDP: local.SDP})
}

func (r *MediaRelay) RemoveCall(callID string) {
	r.mu.Lock()
	session := r.sessions[callID]
	delete(r.sessions, callID)
	r.mu.Unlock()
	if session == nil {
		return
	}
	for _, peer := range session.users {
		if peer.disconnectTimer != nil {
			peer.disconnectTimer.Stop()
		}
		if peer.negotiateTimer != nil {
			peer.negotiateTimer.Stop()
		}
		_ = peer.pc.Close()
	}
}

func (r *MediaRelay) removePeer(callID, userID string) {
	r.mu.Lock()
	session := r.sessions[callID]
	if session != nil {
		if peer := session.users[userID]; peer != nil {
			if peer.disconnectTimer != nil {
				peer.disconnectTimer.Stop()
			}
			if peer.negotiateTimer != nil {
				peer.negotiateTimer.Stop()
			}
			delete(session.users, userID)
			_ = peer.pc.Close()
		}
		if len(session.users) == 0 {
			delete(r.sessions, callID)
		}
	}
	r.mu.Unlock()
}

// keepAliveKeyframes periodically requests a fresh keyframe for a given
// video track's source, so playback can recover from packet loss without
// waiting on the encoder's own keyframe interval. This runs for the
// lifetime of the track and is a loss-recovery mechanism — it is NOT
// relied upon for the initial "first frame after subscribing" case
// anymore; that's handled by requestKeyframesFor, called at the precise
// moment a subscriber's negotiation completes.
func (r *MediaRelay) keepAliveKeyframes(pc *webrtc.PeerConnection, ssrc webrtc.SSRC, callID, userID string) {
	sendPLI := func() error {
		return pc.WriteRTCP([]rtcp.Packet{
			&rtcp.PictureLossIndication{MediaSSRC: uint32(ssrc)},
		})
	}

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
			return
		}
		if err := sendPLI(); err != nil {
			fmt.Printf("[%s] periodic PLI failed for %s (call %s): %v\n",
				time.Now().Format(time.RFC3339Nano), userID, callID, err)
		}
	}
}
