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
                slides JSONB DEFAULT '[]',
                city VARCHAR(255),
                status VARCHAR(50) DEFAULT 'active'
            );

            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='city') THEN
                    ALTER TABLE projects ADD COLUMN city VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='status') THEN
                    ALTER TABLE projects ADD COLUMN status VARCHAR(50) DEFAULT 'active';
                END IF;
            END $$;

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
                user_title VARCHAR(255),
                meta JSONB DEFAULT '{}'
            );

            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='user_title') THEN
                    ALTER TABLE events ADD COLUMN user_title VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='meta') THEN
                    ALTER TABLE events ADD COLUMN meta JSONB DEFAULT '{}';
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
                client_city VARCHAR(255),
                project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                start_time TIMESTAMPTZ NOT NULL,
                end_time TIMESTAMPTZ NOT NULL,
                status VARCHAR(50) DEFAULT 'scheduled',
                calendar_event_id VARCHAR(255),
                meeting_uuid VARCHAR(255),
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scheduled_meetings' AND column_name='client_city') THEN
                    ALTER TABLE scheduled_meetings ADD COLUMN client_city VARCHAR(255);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scheduled_meetings' AND column_name='project_id') THEN
                    ALTER TABLE scheduled_meetings ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
                END IF;
            END $$;

            CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_status ON scheduled_meetings(status);
            CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_start ON scheduled_meetings(start_time);
            CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_client_email ON scheduled_meetings(client_email);
            CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_client_phone ON scheduled_meetings(client_phone);

            CREATE TABLE IF NOT EXISTS clients (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                city VARCHAR(255),
                status VARCHAR(50) DEFAULT 'Active',
                deal_stage VARCHAR(50) DEFAULT 'inquiry',
                lead_source VARCHAR(255),
                assigned_advisor_id VARCHAR(255),
                last_meeting VARCHAR(255),
                deal_price NUMERIC(15, 2),
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_email ON clients(LOWER(email));
            CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_phone ON clients(phone) WHERE phone IS NOT NULL;
            DROP INDEX IF EXISTS idx_clients_email;

            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='deal_price') THEN
                    ALTER TABLE clients ADD COLUMN deal_price NUMERIC(15, 2);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scheduled_meetings' AND column_name='client_id') THEN
                    ALTER TABLE scheduled_meetings ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
                END IF;
            END $$;

            CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_client_id ON scheduled_meetings(client_id);
        `);

        await pool.query(
            `INSERT INTO projects (name, slides, status)
             SELECT $1, $2::jsonb, 'active'
             WHERE NOT EXISTS (SELECT 1 FROM projects)`,
            [
                "Luxury Portfolio Spotlight",
                JSON.stringify([
                    "/newSlides/Welcome.html",
                    "/newSlides/Slide-7.html",
                    "/newSlides/Slide-Trust.html",
                    "/newSlides/Slide-Portfolio.html",
                    "/newSlides/Slide-2.html",
                    "/newSlides/locationMapSlide1.html",
                    "/newSlides/Slide-3.html",
                    "/newSlides/Slide-3-2.html",
                    "/newSlides/Slide-4.html",
                    "/newSlides/howToReach.html",
                    "/newSlides/Slide-Ultimate.html",
                    "/newSlides/Slide-Marriott.html",
                    "/newSlides/Slide-Helipad.html",
                    "/newSlides/Slide-6.html",
                    "/newSlides/Slide-9.html",
                    "/newSlides/Slide-5.html",
                    "/newSlides/Slide-10.html",
                    "/newSlides/Slide-14.html",
                    "/newSlides/Slide-13.html",
                    "/newSlides/Slide-Retail.html",
                    "/newSlides/Slide-Airbnb.html",
                    "/newSlides/Slide-18.html",
                    "/newSlides/Slide-Quiz.html",
                    "/newSlides/plotViewer.html",
                    "/newSlides/Slide-BuyNow.html",
                    "/newSlides/Slide-PaymentSchedule.html",
                    "/newSlides/Slide-Thanks.html",
                ]),
            ]
        );

        console.log("[DB] Database initialized and indexes verified.");
    } catch (err) {
        console.error("[DB] Initialization error:", err);
        process.exit(1);
    }
};

module.exports = { pool, initDb };
