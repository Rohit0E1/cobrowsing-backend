const { pool } = require("./src/config/db");

const migrate = async () => {
  console.log("Starting Propley Intelligence Migration...");

  const migrationQuery = `
    -- 1. Upgrade Meetings Schema
    ALTER TABLE meetings 
    DROP COLUMN IF EXISTS participants;
    
    ALTER TABLE meetings 
    ALTER COLUMN start_time TYPE TIMESTAMPTZ USING to_timestamp(start_time/1000.0),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

    -- 2. Create Relational Participant Registry
    CREATE TABLE IF NOT EXISTS participants (
      id SERIAL PRIMARY KEY,
      meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
      socket_id VARCHAR(255),
      name VARCHAR(255),
      mobile VARCHAR(50),
      role VARCHAR(50),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      left_at TIMESTAMPTZ
    );

    -- 3. Upgrade Behavioral Events Schema
    ALTER TABLE events 
    ALTER COLUMN time TYPE TIMESTAMPTZ USING to_timestamp(time/1000.0);
    
    -- Ensure Cascade Delete is enabled for clean auditing
    ALTER TABLE events 
    DROP CONSTRAINT IF EXISTS events_meeting_id_fkey;
    
    ALTER TABLE events 
    ADD CONSTRAINT events_meeting_id_fkey 
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE;
  `;

  try {
    await pool.query(migrationQuery);
    console.log(
      "Strategic Migration Successful: Schema upgraded to TIMESTAMPTZ and Participants Registry initialized.",
    );
  } catch (err) {
    console.error("Migration Critical Failure:", err);
  } finally {
    process.exit(0);
  }
};

migrate();
