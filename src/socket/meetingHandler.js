const MeetingService = require("../services/MeetingService");
const RoomState = require("../state/RoomState");
const EnableXService = require("../enablex/EnableXService");
const AnalyticsService = require("../services/AnalyticsService");
const { resolveLocation, extractClientIp } = require("../services/GeolocationService");

module.exports = (io, socket) => {

    socket.on("join-meeting", async ({ meetingId: uuid, role, name, mobile }) => {
        if (!uuid) return;

        socket.join(uuid);
        socket.meetingId = uuid;
        // Stash role on the socket so disconnect handler can detect a moderator
        // leaving abruptly (closed tab, network drop) and end the room for everyone.
        socket.meetingRole = role;

        if (!RoomState.has(uuid)) {
            try {
                const meeting = await MeetingService.recoverState(uuid);
                if (meeting) RoomState.init(uuid, meeting.id, meeting.state);
            } catch (e) {
                // Ignore state recovery error
            }
        }

        const displayName = name || (role === "moderator" ? "Advisor" : "Client");

        RoomState.addParticipant(uuid, socket.id, {
            id: socket.id,
            socketId: socket.id,
            name: displayName,
            mobile: mobile || "",
            role,
            location: null,
        });

        io.to(uuid).emit("participants-update", RoomState.getParticipants(uuid));

        // Persist to DB — fire and forget, non-blocking
        const meetingPk = RoomState.getMeetingPk(uuid);
        if (meetingPk) {
            MeetingService.registerParticipant(meetingPk, socket.id, displayName, mobile || "", role)
                .catch(() => {});
        }

        // Async IP geolocation — never blocks the join. Resolves typically in
        // 200-1500ms, then updates RoomState, persists to DB, and re-emits
        // participants-update so the moderator UI gets the location row.
        (async () => {
            try {
                const ip = extractClientIp(socket);
                console.log(`[Geo] join socket=${socket.id} ip=${ip}`);
                const loc = await resolveLocation(ip);
                if (!loc) {
                    console.log(`[Geo] ${ip} → null (local/private or lookup failed)`);
                    return;
                }
                console.log(`[Geo] ${ip} → ${loc.city}, ${loc.country}`);
                RoomState.setParticipantLocation(uuid, socket.id, loc);
                io.to(uuid).emit("participants-update", RoomState.getParticipants(uuid));
                if (meetingPk) {
                    MeetingService.updateParticipantLocation(socket.id, loc).catch(() => {});
                }
            } catch (e) {
                console.warn(`[Geo] lookup error:`, e && e.message);
            }
        })();

        // Sync current slide to late joiner
        const state = RoomState.getState(uuid);
        if (state?.currentUrl) socket.emit("urlChange", { src: state.currentUrl, isRecovered: true });

        if (role === "participant") io.to(uuid).emit("negotiation-needed", { roomId: uuid });
    });

    socket.on("urlChange", async (msg) => {
        const uuid = socket.meetingId;
        if (!uuid) return;

        const newState = { currentUrl: msg.src };
        RoomState.setState(uuid, newState);

        // Broadcast immediately — don't wait for DB
        io.to(uuid).emit("urlChange", msg);

        // Persist state + slide_view event in one transaction — fire and forget
        const meetingPk = RoomState.getMeetingPk(uuid);
        if (meetingPk) {
        const slideName = msg.title || msg.src.split("/").pop().split("?")[0];
        MeetingService.recordUrlChange(meetingPk, newState, slideName)
            .catch(() => {});
        }
    });

    socket.on("disconnect", async () => {
        const wasModerator = socket.meetingRole === "moderator";
        const uuid = RoomState.removeParticipant(socket.id);
        if (!uuid) return;

        MeetingService.markParticipantLeft(socket.id)
            .catch(() => {});

        io.to(uuid).emit("participants-update", RoomState.getParticipants(uuid));

        // Abrupt moderator exit (closed tab, network drop) — finalize the
        // session for everyone. The clean hang-up path already POSTs /reset
        // and emits session-ended explicitly, so this only fires when that
        // path was skipped.
        if (wasModerator) {
            const meetingPk = RoomState.getMeetingPk(uuid);
            try {
                if (meetingPk) await AnalyticsService.summarize(meetingPk);
            } catch (_) {}
            try {
                await MeetingService.reset(uuid);
            } catch (_) {}
            RoomState.cleanup(uuid);
            io.to(uuid).emit("session-ended", { roomId: uuid, reason: "moderator-disconnected" });
        }
    });

    socket.on("moderator:mute-all", () => {
        const uuid = socket.meetingId;
        if (!uuid) return;

        const participants = RoomState.getParticipants(uuid);
        const sender = participants.find((p) => p.socketId === socket.id);
        if (!sender || sender.role !== "moderator") return;

        const targets = participants.filter(
            (p) => p.socketId !== socket.id && !RoomState.isMuted(uuid, p.socketId),
        );
        targets.forEach((p) => {
            io.to(p.socketId).emit("force-mute-self", { by: sender.name });
        });
    });

    socket.on("mic-state-changed", ({ isMuted } = {}) => {
        const uuid = socket.meetingId;
        if (!uuid) return;
        RoomState.setMuted(uuid, socket.id, !!isMuted);
        socket.to(uuid).emit("mic-state-changed", { socketId: socket.id, isMuted: !!isMuted });
    });

    socket.on("moderator:mute-user", ({ targetSocketId } = {}) => {
        const uuid = socket.meetingId;
        if (!uuid || !targetSocketId) return;
        const participants = RoomState.getParticipants(uuid);
        const sender = participants.find((p) => p.socketId === socket.id);
        if (!sender || sender.role !== "moderator") return;
        const target = participants.find((p) => p.socketId === targetSocketId);
        if (!target) return;
        io.to(targetSocketId).emit("force-mute-self", { by: sender.name });
    });

    socket.on("moderator:unmute-request", ({ targetSocketId } = {}) => {
        const uuid = socket.meetingId;
        if (!uuid || !targetSocketId) return;
        const participants = RoomState.getParticipants(uuid);
        const sender = participants.find((p) => p.socketId === socket.id);
        if (!sender || sender.role !== "moderator") return;
        const target = participants.find((p) => p.socketId === targetSocketId);
        if (!target) return;
        io.to(targetSocketId).emit("unmute-request", { by: sender.name, from: socket.id });
    });

    socket.on("participant:unmute-declined", ({ to } = {}) => {
        const uuid = socket.meetingId;
        if (!uuid || !to) return;
        const participants = RoomState.getParticipants(uuid);
        const sender = participants.find((p) => p.socketId === socket.id);
        if (!sender) return;
        const recipient = participants.find((p) => p.socketId === to);
        if (!recipient || recipient.role !== "moderator") return;
        io.to(to).emit("participant:unmute-declined", { name: sender.name });
    });

    // Participant -> moderators: broadcast active device labels so the
    // moderator UI can show what mic/cam/speaker the client is using.
    // Uses Socket.IO as a reliable fallback for EnableX's room.sendUserData.
    socket.on("client-device-info", (data = {}) => {
        const uuid = socket.meetingId;
        if (!uuid) return;
        const participants = RoomState.getParticipants(uuid);
        const sender = participants.find((p) => p.socketId === socket.id);
        if (!sender) return;
        const payload = {
            senderId: socket.id,
            senderName: sender.name,
            role: sender.role,
            devices: data.devices || {},
        };
        // Send only to moderators in this room (avoid noisy broadcast to peer participants).
        participants
            .filter((p) => p.role === "moderator" && p.socketId !== socket.id)
            .forEach((m) => io.to(m.socketId).emit("client-device-info", payload));
    });

    // Passthrough relay events — no DB, just broadcast
    socket.on("whiteboard-draw", (data) => socket.to(socket.meetingId).emit("whiteboard-draw", data));
    socket.on("whiteboard-clear", () => socket.to(socket.meetingId).emit("whiteboard-clear"));
    socket.on("moderator-cursor", (data) => socket.to(socket.meetingId || data.roomId).emit("moderator-cursor", data));
    socket.on("moderator-layout-shift", (data) => socket.to(socket.meetingId).emit("moderator-layout-shift", data));
    socket.on("answer", (msg) => socket.to(socket.meetingId).emit("answer", msg));
    socket.on("calleeCandidates", (msg) => socket.to(socket.meetingId).emit("calleeCandidates", msg));
    socket.on("callerCandidates", (msg) => socket.to(socket.meetingId).emit("callerCandidates", msg));
};
