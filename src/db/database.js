// src/db/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Define the path for the database file within the src/db directory
const dbPath = path.resolve(__dirname, 'bot_database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    initializeDb();
  }
});

const initializeDb = () => {
  const usersTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      telegram_username TEXT,
      first_name TEXT,
      gender TEXT,
      age INTEGER,
      latitude REAL,
      longitude REAL,
      interested_in TEXT, -- 'male', 'female', 'both'
      onboarding_complete INTEGER DEFAULT 0,
      reputation_score INTEGER DEFAULT 100,
      is_banned INTEGER DEFAULT 0,
      ban_until TEXT,     -- ISO 8601 date string
      last_seen TEXT,     -- ISO 8601 date string
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Trigger to update 'updated_at' timestamp
  const updateUserTimestampTrigger = `
    CREATE TRIGGER IF NOT EXISTS update_users_updated_at
    AFTER UPDATE ON users
    FOR EACH ROW
    BEGIN
      UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE user_id = OLD.user_id;
    END;
  `;

  db.serialize(() => {
    db.run(usersTableQuery, (err) => {
      if (err) {
        console.error("Error creating users table", err.message);
      } else {
        console.log("Users table created or already exists.");
        // Create the trigger after table creation
        db.run(updateUserTimestampTrigger, (triggerErr) => {
          if (triggerErr) {
            console.error("Error creating update_users_updated_at trigger", triggerErr.message);
          } else {
            console.log("update_users_updated_at trigger created or already exists.");
          }
        });
      }
    });
  });
};

// --- User Management Functions ---

// Get or Create User: Finds a user by ID, or creates them if they don't exist.
// Updates last_seen and user details (username, first_name) on every call.
const getOrCreateUser = (telegramUser) => {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    const query = `
      INSERT INTO users (user_id, telegram_username, first_name, last_seen, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        telegram_username = excluded.telegram_username,
        first_name = excluded.first_name,
        last_seen = excluded.last_seen,
        updated_at = excluded.updated_at
      RETURNING *;
    `;

    db.get(query, [
        telegramUser.id,
        telegramUser.username,
        telegramUser.first_name,
        now,
        now,  // for created_at if new
        now   // for updated_at
    ], function(err, row) {
      if (err) {
        console.error('Error in getOrCreateUser:', err.message);
        return reject(err);
      }
      // If an existing row was updated, the 'this.changes' might be 0 if values were the same.
      // The RETURNING * clause ensures we always get the row.
      // If new row, SQLite populates 'this.lastID' but RETURNING is more robust.
      if (row) {
        resolve(row);
      } else {
        // Fallback: if RETURNING somehow fails or is not supported in a specific scenario, try fetching.
        // This is less likely with modern SQLite versions.
        db.get("SELECT * FROM users WHERE user_id = ?", [telegramUser.id], (fetchErr, fetchRow) => {
            if (fetchErr) {
                console.error('Error fetching user after insert/update in getOrCreateUser:', fetchErr.message);
                return reject(fetchErr);
            }
            resolve(fetchRow);
        });
      }
    });

        const sessionsTableQuery = `
          CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            user1_id INTEGER NOT NULL,
            user2_id INTEGER NOT NULL,
            start_time TEXT DEFAULT CURRENT_TIMESTAMP,
            end_time TEXT,
            FOREIGN KEY (user1_id) REFERENCES users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (user2_id) REFERENCES users(user_id) ON DELETE CASCADE
          );
        `;

        const reportsTableQuery = `
          CREATE TABLE IF NOT EXISTS reports (
            report_id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_id INTEGER NOT NULL,
            reported_user_id INTEGER NOT NULL,
            session_id TEXT,
            reason TEXT,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (reporter_id) REFERENCES users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (reported_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE SET NULL
          );
        `;

        db.run(sessionsTableQuery, (err) => {
          if (err) console.error("Error creating sessions table", err.message);
          else console.log("Sessions table created or already exists.");
        });

        db.run(reportsTableQuery, (err) => {
          if (err) console.error("Error creating reports table", err.message);
          else console.log("Reports table created or already exists.");
        });
  });
};

// Update user onboarding data
const updateUserOnboardingData = (userId, { gender, age, latitude, longitude, interested_in }) => {
  return new Promise((resolve, reject) => {
    const query = `
      UPDATE users
      SET gender = ?, age = ?, latitude = ?, longitude = ?, interested_in = ?, onboarding_complete = 1
      WHERE user_id = ?
      RETURNING *;
    `;
    db.get(query, [gender, age, latitude, longitude, interested_in, userId], (err, row) => {
      if (err) {
        console.error('Error updating user onboarding data:', err.message);
        return reject(err);
      }
      resolve(row);
    });
  });
};

// Update specific user fields (e.g., gender, age, location, interest)
// fieldToUpdate: 'gender', 'age', 'latitude', 'longitude', 'interested_in'
// value: the new value for the field
// For location, fieldToUpdate can be 'location' and value an object { latitude, longitude }
const updateUserField = (userId, fieldToUpdate, value) => {
    return new Promise((resolve, reject) => {
        let query;
        let params;

        if (fieldToUpdate === 'location') {
            query = `UPDATE users SET latitude = ?, longitude = ? WHERE user_id = ? RETURNING *`;
            params = [value.latitude, value.longitude, userId];
        } else {
            // Ensure the field name is safe to use in a query (prevent SQL injection for field names)
            const allowedFields = ['gender', 'age', 'interested_in', 'telegram_username', 'first_name', 'onboarding_complete', 'reputation_score', 'is_banned', 'ban_until'];
            if (!allowedFields.includes(fieldToUpdate)) {
                return reject(new Error('Invalid field to update: ' + fieldToUpdate));
            }
            query = `UPDATE users SET ${fieldToUpdate} = ? WHERE user_id = ? RETURNING *`;
            params = [value, userId];
        }

        db.get(query, params, (err, row) => {
            if (err) {
                console.error(`Error updating user field ${fieldToUpdate}:`, err.message);
                return reject(err);
            }
            resolve(row);
        });
    });
};

// Get user by ID
const getUser = (userId) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE user_id = ?", [userId], (err, row) => {
            if (err) {
                console.error('Error getting user:', err.message);
                return reject(err);
            }
            resolve(row);
        });
    });
};


module.exports = {
  db, // Export db for direct use if needed, e.g., for closing connection gracefully
  initializeDb,
  getOrCreateUser,
  updateUserOnboardingData,
  updateUserField,
  getUser,
};

// --- Session Management Functions ---
const createSession = (user1Id, user2Id) => {
  return new Promise((resolve, reject) => {
    // Implementation later
    reject(new Error("createSession not implemented"));
  });
};

const endSession = (sessionId) => {
  return new Promise((resolve, reject) => {
    // Implementation later
    reject(new Error("endSession not implemented"));
  });
};

const getActiveSessionForUser = (userId) => {
  return new Promise((resolve, reject) => {
    // Implementation later
    reject(new Error("getActiveSessionForUser not implemented"));
  });
};

// --- Report Management Functions ---
const createReport = (reporterId, reportedUserId, sessionId, reason) => {
  return new Promise((resolve, reject) => {
    // Implementation later
    reject(new Error("createReport not implemented"));
  });
};

module.exports = {
  db, // Export db for direct use if needed, e.g., for closing connection gracefully
  initializeDb,
  getOrCreateUser,
  updateUserOnboardingData,
  updateUserField,
  getUser,
  createSession,
  endSession,
  getActiveSessionForUser,
  createReport,
};
