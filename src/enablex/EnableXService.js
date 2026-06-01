const axios = require("axios");
require("dotenv").config();

const APP_ID = process.env.ENABLEX_APP_ID;
const APP_KEY = process.env.ENABLEX_APP_KEY;

const auth = Buffer.from(`${APP_ID}:${APP_KEY}`).toString("base64");
const axiosInstance = axios.create({
  baseURL: "https://api.enablex.io/video/v2",
  headers: {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  },
});

class EnableXService {
  static async createRoom(meetingUUID, meetingTitle = "Propley Advisory") {
    try {
      const roomData = {
        name: meetingTitle,
        owner_ref: meetingUUID,
        settings: {
          description: `Propley Session: ${meetingUUID}`,
          quality: "SD",
          mode: "group",
          adhoc: true,
          participants: 10,
          duration: 60,
          scheduled: false,
          auto_recording: false,
          active_talker: false,
        },
        sip: { enabled: false },
      };

      const response = await axiosInstance.post("/rooms", roomData);
      return response.data.room;
    } catch (error) {
      const detail = error.response
        ? JSON.stringify(error.response.data)
        : error.message;
      throw new Error(`EnableX infrastructure failed: ${detail}`);
    }
  }

  static async generateToken(roomId, name, role, userRef) {
    try {
      const finalUserRef = userRef || `${name}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      console.log(`[ENX_TOKEN] room=${roomId} name="${name}" role=${role} user_ref="${finalUserRef}"`);
      const response = await axiosInstance.post(`/rooms/${roomId}/tokens`, {
        name: name,
        role: role,
        user_ref: finalUserRef,
      });
      return response.data.token;
    } catch (error) {
      throw new Error("Failed to authenticate with EnableX media gateway.");
    }
  }

  static async getRoom(roomId) {
    try {
      const response = await axiosInstance.get(`/rooms/${roomId}`);
      return response.data.room;
    } catch (error) {
      return null;
    }
  }

  static async deleteRoom(roomId) {
    try {
      const response = await axiosInstance.delete(`/rooms/${roomId}`);
      return response.data;
    } catch (error) {
      return null;
    }
  }
}

module.exports = EnableXService;
