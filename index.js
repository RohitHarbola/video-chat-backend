import pkg from "pg";
const { Pool } = pkg;
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import cosineSimilarity from "cosine-similarity";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Create tables if they don’t exist
const createTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        interests TEXT[] NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        user1_id INT REFERENCES users(id),
        user2_id INT REFERENCES users(id),
        UNIQUE(user1_id, user2_id)
      );
    `);
    console.log("✅ Database tables checked/created.");
  } catch (error) {
    console.error("❌ Error creating tables:", error);
  }
};
createTables();

// Store user interests in the database
app.post("/api/interests", async (req, res) => {
  const { userId, username, interests } = req.body;
  if (!userId || !username || !interests) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const interestArray = interests.split(",").map((i) => i.trim().toLowerCase());

    await pool.query(
      `INSERT INTO users (id, username, interests) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET interests = $3`,
      [userId, username, interestArray]
    );

    res.json({ success: true, message: "Interests saved successfully" });
  } catch (err) {
    console.error("❌ Error saving interests:", err);
    res.status(500).json({ error: err.message });
  }
});

// Match users based on cosine similarity
app.get("/api/match/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const userResult = await pool.query("SELECT interests FROM users WHERE id = $1", [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userInterests = userResult.rows[0].interests;
    const allUsers = await pool.query("SELECT id, interests FROM users WHERE id != $1", [userId]);

    let bestMatch = null;
    let highestScore = -1;

    for (const row of allUsers.rows) {
      const matchInterests = row.interests;
      const score = cosineSimilarity(
        userInterests.map((i) => (matchInterests.includes(i) ? 1 : 0)),
        matchInterests.map((i) => (userInterests.includes(i) ? 1 : 0))
      );

      if (score > highestScore) {
        highestScore = score;
        bestMatch = row.id;
      }
    }

    if (bestMatch) {
      res.json({ matchedUser: bestMatch });
    } else {
      res.json({ message: "No matches found" });
    }
  } catch (err) {
    console.error("❌ Error finding match:", err);
    res.status(500).json({ error: err.message });
  }
});

// WebRTC Signaling
io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  socket.on("join-room", ({ roomId, userId }) => {
    socket.join(roomId);
    socket.broadcast.to(roomId).emit("user-connected", userId);
  });

  socket.on("offer", (data) => {
    socket.broadcast.to(data.roomId).emit("offer", data);
  });

  socket.on("answer", (data) => {
    socket.broadcast.to(data.roomId).emit("answer", data);
  });

  socket.on("ice-candidate", (data) => {
    socket.broadcast.to(data.roomId).emit("ice-candidate", data);
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
