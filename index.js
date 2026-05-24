require("dotenv").config();
const validateEnv = require("./src/config/env");
validateEnv();

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const { Server } = require("socket.io");
const express = require("express");
const cors = require("cors");

const { initDb, pool } = require("./src/config/db");
const meetingHandler = require("./src/socket/meetingHandler");
const analyticsHandler = require("./src/socket/analyticsHandler");
const keepAlive = require("./src/keepAlive");

const authRouter = require("./src/routes/auth");
const meetingsRouter = require("./src/routes/meetings");
const eventsRouter = require("./src/routes/events");
const projectsRouter = require("./src/routes/projects");
const enablexRouter = require("./src/enablex/enablexRoutes");
const scheduleRouter = require("./src/routes/schedule");

const app = express();

app.set('trust proxy', true);

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
  }),
);
app.use(express.json());

// Health endpoint (required for self-ping and DB warmup)
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'db error', error: err.message });
  }
});

// API Routes
app.use("/auth", authRouter);
app.use("/api/v1/meetings", meetingsRouter);
app.use("/api/v1/events", eventsRouter);
app.use("/api/v1/enablex", enablexRouter);
app.use("/projects", projectsRouter);
app.use("/api/v1/schedule", scheduleRouter);

// Use HTTPS if SSL certs exist (production), fall back to HTTP (local dev with ngrok)
const sslKeyPath = process.env.SSL_KEY || "./certs/server.key";
const sslCertPath = process.env.SSL_CERT || "./certs/server.cert";
const useSSL = fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath);

let server;
if (useSSL) {
  server = https.createServer(
    { key: fs.readFileSync(sslKeyPath), cert: fs.readFileSync(sslCertPath) },
    app,
  );
  console.log("[Propley] SSL enabled — running HTTPS");
} else {
  server = http.createServer(app);
  console.log(
    "[Propley] No SSL certs found — running HTTP (use ngrok or reverse proxy for WebRTC)",
  );
}
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
  },
});

io.on("connection", (socket) => {
  meetingHandler(io, socket);
  analyticsHandler(io, socket);
});

const startServer = async () => {
    await initDb();
    const port = process.env.PORT || 5001;
    server.listen(port, () => {
        console.log(`[AUUM] Server active on port ${port}`);

        // Start keep-alive only in production
        if (process.env.RENDER_EXTERNAL_URL) {
            keepAlive(`${process.env.RENDER_EXTERNAL_URL}/health`);
        }
    });
};

startServer();
