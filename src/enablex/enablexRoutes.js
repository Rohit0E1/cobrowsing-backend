const express = require("express");
const jwt = require("jsonwebtoken");
const EnableXService = require("./EnableXService");
const MeetingService = require("../services/MeetingService");
const RecordingService = require("../services/RecordingService");

const router = express.Router();

router.post("/create/:uuid", async (req, res) => {
  const { uuid } = req.params;
  const { title } = req.body;

  try {
    const meeting = await MeetingService.recoverState(uuid);
    if (!meeting)
      return res.status(404).json({ error: "Internal meeting not found." });

    const fullMeeting = await MeetingService.getWithModerator(uuid);
    if (fullMeeting?.enablex_room_id) {
      const existing = await EnableXService.getRoom(
        fullMeeting.enablex_room_id,
      );
      if (existing?.room_id) {
        return res.json({
          roomId: fullMeeting.enablex_room_id,
          status: "already_exists",
        });
      }
      await MeetingService.clearEnableXRoom(uuid);
    }

    const enxRoom = await EnableXService.createRoom(
      uuid,
      title || "Propley Suite",
    );
    if (!enxRoom?.room_id)
      throw new Error("EnableX returned malformed room data.");

    await MeetingService.updateEnableXRoom(uuid, enxRoom.room_id);
    res.status(201).json({ roomId: enxRoom.room_id, status: "created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/token", async (req, res) => {
  const { uuid, name, role, socketId } = req.body;

  try {
    const meeting = await MeetingService.getWithModerator(uuid);
    if (!meeting) return res.status(404).json({ error: "Meeting not found." });

    let roomId = meeting.enablex_room_id;
    const issueToken = () =>
      EnableXService.generateToken(
        roomId,
        name || "Guest",
        role || "participant",
        socketId,
      );
    let token = null;

    if (roomId) {
      token = await issueToken().catch(() => null);
      if (!token) {
        const existing = await EnableXService.getRoom(roomId);
        if (!existing?.room_id) {
          await MeetingService.clearEnableXRoom(uuid);
          roomId = null;
        }
      }
    }

    if (!roomId) {
      const enxRoom = await EnableXService.createRoom(uuid, "Propley Suite");
      if (!enxRoom?.room_id)
        throw new Error("EnableX returned malformed room data.");
      await MeetingService.updateEnableXRoom(uuid, enxRoom.room_id);
      roomId = enxRoom.room_id;
    }

    if (!token) token = await issueToken();
    res.json({ token, roomId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/recordings/stream", async (req, res) => {
  let claims;
  try {
    claims = jwt.verify(String(req.query.token || ""), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired link" });
  }
  if (claims.typ !== "recording") return res.status(401).json({ error: "Invalid link" });

  try {
    const file = await RecordingService.getFile(claims.rid, claims.conf);
    if (!file) return res.status(404).json({ error: "Recording not found" });

    const signed = file.key && (await RecordingService.signedUrl(file.key));
    if (signed) return res.redirect(302, signed);

    const upstream = await EnableXService.streamRecording(file.url, req.headers.range);
    if (upstream.status >= 400) {
      upstream.data.destroy();
      console.error(`[ENX_RECORDING] upstream ${upstream.status} for recording ${claims.rid}`);
      return res.status(502).json({ error: "Recording unavailable" });
    }

    res.status(upstream.status);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    }
    res.on("close", () => upstream.data.destroy());
    upstream.data.pipe(res);
  } catch (err) {
    res.status(502).json({ error: "Recording unavailable" });
  }
});

router.post("/test/provision", async (req, res) => {
  const { name = "TestUser" } = req.body;
  try {
    const testUUID = `test-${Date.now()}`;
    const room = await EnableXService.createRoom(testUUID, "EnableX Test Room");
    if (!room?.room_id) throw new Error("EnableX returned no room_id");

    const [modToken, partToken] = await Promise.all([
      EnableXService.generateToken(room.room_id, name, "moderator"),
      EnableXService.generateToken(room.room_id, "Participant", "participant"),
    ]);

    res.json({
      room_id: room.room_id,
      mod_token: modToken,
      participant_token: partToken,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
