const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { pool } = require("../config/db");
const EnableXService = require("../enablex/EnableXService");

const MAX_WAIT_MS = 2 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;
const SIGNED_URL_TTL_S = 60 * 60;

const bucket = process.env.R2_BUCKET;
const r2 = bucket
    ? new S3Client({
          region: "auto",
          endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          forcePathStyle: true,
          credentials: {
              accessKeyId: process.env.R2_ACCESS_KEY_ID,
              secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
          },
      })
    : null;

async function resolveFromArchive(row) {
    const archive = await EnableXService.getArchiveByRoom(row.enablex_room_id);
    const files = archive
        .map((a) => ({ conf_num: a.conf_num, url: (a.live_recording?.[0] || a.transcoded?.[0])?.url }))
        .filter((f) => f.url);
    const waitedTooLong = Date.now() - new Date(row.ended_at).getTime() > MAX_WAIT_MS;
    const status = files.length ? "ready" : waitedTooLong ? "none" : "processing";
    if (status === "processing") return;
    await pool.query("UPDATE meeting_recordings SET status = $1, files = $2::jsonb WHERE id = $3", [
        status,
        JSON.stringify(files),
        row.id,
    ]);
    Object.assign(row, { status, files });
}

async function copyToR2(row) {
    for (const file of row.files) {
        if (file.key) continue;
        const source = await EnableXService.streamRecording(file.url);
        if (source.status !== 200) {
            source.data.destroy();
            throw new Error(`EnableX returned ${source.status} for conf ${file.conf_num}`);
        }
        const key = `recordings/${row.meeting_id}/${file.conf_num}.mp4`;
        await r2.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: source.data,
                ContentLength: Number(source.headers["content-length"]),
                ContentType: "video/mp4",
            })
        );
        file.key = key;
        await pool.query("UPDATE meeting_recordings SET files = $1::jsonb WHERE id = $2", [
            JSON.stringify(row.files),
            row.id,
        ]);
        console.log(`[recordings] stored ${key}`);
    }
    await pool.query("UPDATE meeting_recordings SET status = 'stored' WHERE id = $1", [row.id]);
    row.status = "stored";
}

let sweeping = false;

async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
        const { rows } = await pool.query(
            "SELECT id, meeting_id, enablex_room_id, status, files, ended_at FROM meeting_recordings WHERE status IN ('processing', 'ready')"
        );
        for (const row of rows) {
            try {
                if (row.status === "processing") await resolveFromArchive(row);
                if (row.status === "ready" && r2) await copyToR2(row);
            } catch (e) {
                console.warn(`[recordings] sweep failed for recording ${row.id}:`, e.message);
            }
        }
    } finally {
        sweeping = false;
    }
}

const RecordingService = {
    startSweeper() {
        if (!r2) console.warn("[recordings] R2 not configured — recordings stay on EnableX");
        sweep().catch((e) => console.warn("[recordings] sweep error:", e.message));
        setInterval(() => sweep().catch((e) => console.warn("[recordings] sweep error:", e.message)), SWEEP_INTERVAL_MS);
    },

    async listForMeeting(meetingId) {
        const { rows } = await pool.query(
            "SELECT id, status, files, ended_at FROM meeting_recordings WHERE meeting_id = $1 AND status <> 'none' ORDER BY ended_at DESC",
            [meetingId]
        );
        return rows.map((r) => ({ ...r, status: r.status === "processing" ? "processing" : "ready" }));
    },

    async getFile(recordingId, confNum) {
        const { rows } = await pool.query("SELECT files FROM meeting_recordings WHERE id = $1", [recordingId]);
        return rows[0]?.files.find((f) => f.conf_num === confNum) || null;
    },

    signedUrl(key) {
        if (!r2) return null;
        return getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: SIGNED_URL_TTL_S });
    },
};

module.exports = RecordingService;
