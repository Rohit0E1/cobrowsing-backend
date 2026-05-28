const express = require("express");
const EnableXService = require("./EnableXService");
const MeetingService = require("../services/MeetingService");

const router = express.Router();

router.post("/create/:uuid", async (req, res) => {
  const { uuid } = req.params;
  const { title } = req.body;

  try {
    const meeting = await MeetingService.recoverState(uuid);
    if (!meeting)
      return res.status(404).json({ error: "Internal meeting not found." });

    // Validate existing room is still alive on EnableX
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

    if (roomId) {
      const existing = await EnableXService.getRoom(roomId);
      if (!existing?.room_id) {
        await MeetingService.clearEnableXRoom(uuid);
        roomId = null;
      }
    }

    if (!roomId) {
      const enxRoom = await EnableXService.createRoom(uuid, "Propley Suite");
      if (!enxRoom?.room_id)
        throw new Error("EnableX returned malformed room data.");
      await MeetingService.updateEnableXRoom(uuid, enxRoom.room_id);
      roomId = enxRoom.room_id;
    }

    const token = await EnableXService.generateToken(
      roomId,
      name || "Guest",
      role || "participant",
      socketId,
    );
    res.json({ token, roomId });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
