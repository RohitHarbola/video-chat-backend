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
      username VARCHAR(255) UNIQUE NOT NULL,
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

// Helper function to calculate cosine similarity between two vectors
const cosineSimilarity = (vecA, vecB) => {
  // Create sets of unique interests
  const allInterests = new Set([...vecA, ...vecB]);
  const interestMapA = {};
  const interestMapB = {};

  // Map each interest to its frequency in each user's list
  allInterests.forEach((interest) => {
    interestMapA[interest] = vecA.filter((x) => x === interest).length;
    interestMapB[interest] = vecB.filter((x) => x === interest).length;
  });

  // Compute the dot product
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  Object.keys(allInterests).forEach((interest) => {
    dotProduct += interestMapA[interest] * interestMapB[interest];
    magnitudeA += interestMapA[interest] ** 2;
    magnitudeB += interestMapB[interest] ** 2;
  });

  // Calculate the cosine similarity
  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
};

// Route to store user interests
app.post("/api/interests", async (req, res) => {
  const { username, interests } = req.body;

  console.log("Received data:", req.body); // Log request data for debugging

  if (!username || !interests || !Array.isArray(interests) || interests.length === 0) {
    return res.status(400).json({ error: "Username and interests are required and should be a valid array." });
  }

  try {
    await pool.query(
      `INSERT INTO users (username, interests) VALUES ($1, $2)
      ON CONFLICT (username) DO UPDATE SET interests = EXCLUDED.interests`,
      [username, JSON.stringify(interests)] // Store interests as JSON array
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error storing interests:", err.message);
    res.status(500).json({ error: err.message });
  }
});

//match username based on cosine similarity
app.get("/api/match/:username", async (req, res) => {
  const { username } = req.params;

  try {
    // Fetch the current user's interests using 'username'
    const userResult = await pool.query("SELECT interests FROM users WHERE username = $1", [username]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userInterests = JSON.parse(userResult.rows[0].interests);

    // Fetch all users excluding the current one using 'username'
    const allUsers = await pool.query("SELECT username, interests FROM users WHERE username != $1", [username]);

    let bestMatch = null;
    let highestScore = -1;

    // Compare the current user with all other users
    for (const row of allUsers.rows) {
      const matchInterests = JSON.parse(row.interests);
      const score = cosineSimilarity(userInterests, matchInterests);

      if (score > highestScore) {
        highestScore = score;
        bestMatch = row.username; // Using 'username' instead of 'id'
      }
    }

    if (bestMatch) {
      res.json({ matchedUser: bestMatch, score: highestScore });
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
  //disconnect call
  socket.on("disconnect-call", ({ roomId }) => {
  socket.to(roomId).emit("disconnect-call");
  console.log(`Call disconnected in room: ${roomId}`);
});

});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
