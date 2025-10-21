const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const morgan = require("morgan");
const config = require("./config/config");
const middleware = require("./middleware/middleware");
const questionRoutes = require("./routes/questionRoutes");

// ✅ Connect MongoDB
config.connectDB();

const app = express();
const server = http.createServer(app);

// ✅ Middleware setup
app.use(cors());

app.use(express.json());
app.use(morgan("dev"));
app.use(express.static("public"));
app.use(middleware.setTestTeam);

// ✅ Initialize Socket.IO with proper CORS
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // must match frontend origin
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ✅ Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("✅ New Socket connected:", socket.id);

  // Send a welcome message immediately after connect
  socket.emit("serverMessage", "Connection established successfully!");

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

// ✅ API routes
app.use(
  "/api/questions",
  (req, res, next) => {
    req.io = io; // attach io to every request
    next();
  },
  questionRoutes
);

// ✅ Start server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ✅ Export for testing or other modules
module.exports = { app, server, io };
