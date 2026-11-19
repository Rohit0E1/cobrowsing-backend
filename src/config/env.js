module.exports = function validateEnv() {
    if (!process.env.JWT_SECRET) {
        throw new Error("[STARTUP] JWT_SECRET environment variable is required");
    }
    if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
        throw new Error("[STARTUP] Either DATABASE_URL or DB_HOST/DB_USER/DB_NAME/DB_PASSWORD/DB_PORT are required");
    }
    if (!process.env.APP_URL) {
        console.warn("[STARTUP] WARNING: APP_URL not set — room links will use http://localhost:3000");
    }
    if (!process.env.WA_API_KEY || !process.env.WA_FROM) {
        console.warn("[STARTUP] WARNING: WhatsApp notifications disabled — WA_API_KEY or WA_FROM not set");
    }
    if (!process.env.ENABLEX_RECORDING_USER || !process.env.ENABLEX_RECORDING_PASS) {
        console.warn("[STARTUP] WARNING: Session recordings cannot be fetched — ENABLEX_RECORDING_USER or ENABLEX_RECORDING_PASS not set");
    }
    if (!process.env.R2_BUCKET || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        console.warn("[STARTUP] WARNING: R2 not configured — recordings stay on EnableX (deleted after ~3 days)");
    }
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn("[STARTUP] WARNING: Email notifications disabled — EMAIL_USER or EMAIL_PASS not set");
    }
};
