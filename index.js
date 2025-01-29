import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { Pool } from "pg";
import dotenv from "dotenv";

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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Create tables
const createTables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      interest VARCHAR(255) NOT NULL
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

// API to store user interest
app.post("/api/users", async (req, res) => {
  const { username, interest } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO users (username, interest) VALUES ($1, $2) RETURNING *",
      [username, interest]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API to find a match
app.get("/api/match/:interest", async (req, res) => {
  const { interest } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE interest = $1 LIMIT 2",
      [interest]
    );
    if (result.rows.length === 2) {
      await pool.query(
        "INSERT INTO matches (user1_id, user2_id) VALUES ($1, $2)",
        [result.rows[0].id, result.rows[1].id]
      );
      res.json({ match: result.rows });
    } else {
      res.json({ message: "Waiting for a match" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WebSocket signaling for WebRTC
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);
  });

  socket.on("offer", ({ roomId, sdp }) => {
    socket.to(roomId).emit("offer", { sdp });
  });

  socket.on("answer", ({ roomId, sdp }) => {
    socket.to(roomId).emit("answer", { sdp });
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", { candidate });
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
