import pkg from "pg";
const { Pool } = pkg;
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(cors());
app.use(express.json());

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Create tables with correct column names
const createTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      interests TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      user1_id INT REFERENCES users(id),
      user2_id INT REFERENCES users(id)
    );
  `);
};

createTables();


app.post("/api/interests", async (req, res) => {
  const { username, interests } = req.body;

  if (!username || !interests) {
    return res.status(400).json({ error: "Username and interests are required" });
  }

  try {
    // Convert interests string into an array
    const interestArray = interests.split(",").map((word) => word.trim().toLowerCase());

    // Insert user and return the ID
    const result = await pool.query(
      `INSERT INTO users (username, interests) VALUES ($1, $2) RETURNING id`,
      [username, JSON.stringify(interestArray)]
    );

    res.json({ success: true, userId: result.rows[0].id });
  } catch (err) {
    console.error("Error storing interests:", err.message);
    res.status(500).json({ error: err.message });
  }
});



// Match users based on cosine similarity
app.get("/api/match/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const userResult = await pool.query("SELECT interests FROM users WHERE id = $1", [userId]);

    if (userResult.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const userInterests = JSON.parse(userResult.rows[0].interests);

    const allUsers = await pool.query("SELECT id, interests FROM users WHERE id != $1", [userId]);

    let bestMatch = null;
    let highestScore = -1;

    for (const row of allUsers.rows) {
      const matchInterests = JSON.parse(row.interests);
      const score = cosineSimilarity(userInterests, matchInterests);
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
    console.error("Error finding match:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// WebRTC Signaling
io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, userId }) => {
    socket.join(roomId);
    socket.broadcast.to(roomId).emit("user-connected", userId);
  });

  socket.on("offer", (data) => socket.broadcast.to(data.roomId).emit("offer", data));
  socket.on("answer", (data) => socket.broadcast.to(data.roomId).emit("answer", data));
  socket.on("ice-candidate", (data) => socket.broadcast.to(data.roomId).emit("ice-candidate", data));

  socket.on("disconnect", () => console.log("User disconnected"));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
