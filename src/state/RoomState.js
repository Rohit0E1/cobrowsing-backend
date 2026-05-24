/**
 * RoomState — singleton in-memory store for active meeting sessions.
 *
 * Stores per-room:
 *   meetingPk   — the integer DB primary key (cached to avoid repeated UUID lookups)
 *   state       — current slide/URL state
 *   participants — Map<socketId, userObj>
 */
class RoomState {
    #rooms = new Map();

    has(uuid) {
        return this.#rooms.has(uuid);
    }

    /**
     */
    init(uuid, meetingPk, initialState) {
        if (this.#rooms.has(uuid)) return;
        this.#rooms.set(uuid, {
            meetingPk,
            state: initialState || {},
            participants: new Map(),
            muted: new Set(),
        });
    }

    setMuted(uuid, socketId, isMuted) {
        const room = this.#rooms.get(uuid);
        if (!room) return;
        if (isMuted) room.muted.add(socketId);
        else room.muted.delete(socketId);
    }

    isMuted(uuid, socketId) {
        return !!this.#rooms.get(uuid)?.muted?.has(socketId);
    }

    /** Returns the integer DB PK — null if room not initialised */
    getMeetingPk(uuid) {
        return this.#rooms.get(uuid)?.meetingPk ?? null;
    }

    getState(uuid) {
        return this.#rooms.get(uuid)?.state ?? null;
    }

    setState(uuid, state) {
        const room = this.#rooms.get(uuid);
        if (room) room.state = state;
    }

    addParticipant(uuid, socketId, userObj) {
        const room = this.#rooms.get(uuid);
        if (room) room.participants.set(socketId, userObj);
    }

    setParticipantLocation(uuid, socketId, location) {
        const room = this.#rooms.get(uuid);
        if (!room) return;
        const p = room.participants.get(socketId);
        if (p) p.location = location;
    }

    /**
     * Removes a participant by socketId across all rooms.
     * Returns the uuid of the room they were in, or null.
     */
    removeParticipant(socketId) {
        for (const [uuid, room] of this.#rooms) {
            if (room.participants.has(socketId)) {
                room.participants.delete(socketId);
                room.muted?.delete(socketId);
                return uuid;
            }
        }
        return null;
    }

    getParticipants(uuid) {
        const room = this.#rooms.get(uuid);
        if (!room) return [];
        return Array.from(room.participants.values()).map((p) => ({
            ...p,
            isMuted: room.muted.has(p.socketId),
        }));
    }

    /** Called on session-ended — frees memory for completed sessions */
    cleanup(uuid) {
        this.#rooms.delete(uuid);
    }
}

module.exports = new RoomState();
