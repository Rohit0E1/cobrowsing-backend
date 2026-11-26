const axios = require("axios");
const https = require("https");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const APP_ID = process.env.ENABLEX_APP_ID;
const APP_KEY = process.env.ENABLEX_APP_KEY;

const auth = Buffer.from(`${APP_ID}:${APP_KEY}`).toString("base64");
const axiosInstance = axios.create({
  baseURL: "https://api.enablex.io/video/v2",
  httpsAgent: new https.Agent({ keepAlive: true }),
  headers: {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  },
});

function recordingSettings(meetingUUID) {
  const recorderUrl = process.env.ENABLEX_RECORDER_URL;
  if (!recorderUrl) return { auto_recording: false };
  const key = jwt.sign({ typ: "recorder", uuid: meetingUUID }, process.env.JWT_SECRET, { expiresIn: "2d" });
  return {
    auto_recording: false,
    live_recording: {
      auto_recording: true,
      url: `${recorderUrl.replace(/\/$/, "")}/${meetingUUID}?key=${key}&token=`,
    },
  };
}

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
          ...recordingSettings(meetingUUID),
        },
        sip: { enabled: false },
      };

      const response = await axiosInstance.post("/rooms", roomData);
      return response.data.room;
    } catch (error) {
      console.error("[ENX_CREATE_ROOM] failed", {
        status: error.response?.status,
        url: `${axiosInstance.defaults.baseURL}/rooms`,
        data: error.response?.data,
        message: error.message,
      });
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
      console.error("[ENX_TOKEN] failed", {
        status: error.response?.status,
        url: `${axiosInstance.defaults.baseURL}/rooms/${roomId}/tokens`,
        data: error.response?.data,
        message: error.message,
      });
      throw new Error("Failed to authenticate with EnableX media gateway.");
    }
  }

  static async getRoom(roomId) {
    try {
      const response = await axiosInstance.get(`/rooms/${roomId}`);
      return response.data.room;
    } catch (error) {
      console.error("[ENX_GET_ROOM] failed", {
        status: error.response?.status,
        url: `${axiosInstance.defaults.baseURL}/rooms/${roomId}`,
        data: error.response?.data,
        message: error.message,
      });
      return null;
    }
  }

  static async getArchiveByRoom(roomId) {
    const response = await axiosInstance.get(`/archive/room/${roomId}`);
    return response.data.archive || [];
  }

  static streamRecording(url, range) {
    return axios.get(url, {
      auth: {
        username: process.env.ENABLEX_RECORDING_USER,
        password: process.env.ENABLEX_RECORDING_PASS,
      },
      headers: range ? { Range: range } : {},
      responseType: "stream",
      validateStatus: () => true,
    });
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
