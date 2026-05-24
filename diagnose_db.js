const { pool } = require("./src/config/db");

async function diagnose() {
  try {
    const projects = await pool.query("SELECT * FROM projects");
    console.log("Projects in DB:", projects.rows.length);
    console.log("First Project Slide Samples:", projects.rows[0]?.slides?.slice(0, 3));

    const meetings = await pool.query("SELECT * FROM meetings ORDER BY id DESC LIMIT 3");
    console.log("Recent Meetings:", meetings.rows.map(m => ({ uuid: m.uuid, start: m.start_time, active: m.is_active })));

    const participants = await pool.query("SELECT * FROM participants LIMIT 5");
    console.log("Recent Participants:", participants.rows.length);

    const users = await pool.query("SELECT id, name, email FROM users");
    console.log("Users in DB:", users.rows.length);

  } catch (e) {
    console.error("DIAGNOSTIC ERROR", e);
  } finally {
    process.exit(0);
  }
}

diagnose();
