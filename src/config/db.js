const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool(
    process.env.DATABASE_URL
        ? {
              connectionString: process.env.DATABASE_URL,
              ssl: { rejectUnauthorized: false },
              max: 20,
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 10000,
          }
        : {
              user: process.env.DB_USER,
              host: process.env.DB_HOST,
              database: process.env.DB_NAME,
              password: process.env.DB_PASSWORD,
              port: process.env.DB_PORT,
              max: 20,
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 10000,
          }
);

pool.on("connect", () => {
    console.log("[DB] Postgres connected");
});

pool.on("error", (err) => {
    console.error("[DB] Unexpected pool error:", err);
});

const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                phone VARCHAR(50),
                password_hash VARCHAR(255) NOT NULL,
                project_ids JSONB DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255),
                slides JSONB DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS meetings (
                id SERIAL PRIMARY KEY,
                uuid VARCHAR(255) UNIQUE NOT NULL,
                moderator_id INTEGER REFERENCES users(id),
                state JSONB DEFAULT '{}',
                analytics JSONB DEFAULT '{}',
                start_time TIMESTAMPTZ DEFAULT NOW(),
                duration INTEGER,
                meeting_for VARCHAR(255),
                is_active BOOLEAN DEFAULT TRUE,
                completed_at TIMESTAMPTZ,
                enablex_room_id VARCHAR(255),
                recording_url TEXT,
                transcript TEXT
            );

            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meetings' AND column_name='enablex_room_id') THEN
                    ALTER TABLE meetings ADD COLUMN enablex_room_id VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meetings' AND column_name='recording_url') THEN
                    ALTER TABLE meetings ADD COLUMN recording_url TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meetings' AND column_name='transcript') THEN
                    ALTER TABLE meetings ADD COLUMN transcript TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='meetings' AND column_name='notes') THEN
                    ALTER TABLE meetings ADD COLUMN notes JSONB DEFAULT '[]';
                END IF;
            END $$;

            CREATE TABLE IF NOT EXISTS participants (
                id SERIAL PRIMARY KEY,
                meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
                socket_id VARCHAR(255),
                name VARCHAR(255),
                mobile VARCHAR(50),
                role VARCHAR(50),
                joined_at TIMESTAMPTZ DEFAULT NOW(),
                left_at TIMESTAMPTZ,
                location JSONB
            );

            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='participants' AND column_name='location') THEN
                    ALTER TABLE participants ADD COLUMN location JSONB;
                END IF;
            END $$;

            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
                event_id VARCHAR(255),
                name VARCHAR(255),
                time TIMESTAMPTZ DEFAULT NOW(),
                duration INTEGER,
                user_name VARCHAR(255),
                user_mobile VARCHAR(50),
                user_title VARCHAR(255)
            );

            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='user_title') THEN
                    ALTER TABLE events ADD COLUMN user_title VARCHAR(255);
                END IF;
            END $$;

            CREATE INDEX IF NOT EXISTS idx_meetings_uuid ON meetings(uuid);
            CREATE INDEX IF NOT EXISTS idx_events_meeting_id ON events(meeting_id);
            CREATE INDEX IF NOT EXISTS idx_participants_meeting_id ON participants(meeting_id);
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

            CREATE TABLE IF NOT EXISTS scheduled_meetings (
                id SERIAL PRIMARY KEY,
                client_name VARCHAR(255) NOT NULL,
                client_email VARCHAR(255) NOT NULL,
                client_phone VARCHAR(50),
                start_time TIMESTAMPTZ NOT NULL,
                end_time TIMESTAMPTZ NOT NULL,
                status VARCHAR(50) DEFAULT 'scheduled',
                calendar_event_id VARCHAR(255),
                meeting_uuid VARCHAR(255),
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_status ON scheduled_meetings(status);
            CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_start ON scheduled_meetings(start_time);
        `);
        console.log("[DB] Database initialized and indexes verified.");
    } catch (err) {
        console.error("[DB] Initialization error:", err);
        process.exit(1);
    }
};

module.exports = { pool, initDb };
