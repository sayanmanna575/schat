const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || '*';
const GRACE_PERIOD_MS = 15000; // 15 seconds grace period for accidental disconnects

app.use(cors());
app.use(express.json());

// Basic health check route
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeRooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL === '*' ? '*' : [CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST']
  }
});

// In-memory temporary storage
// rooms: Map<roomCode, {
//   code: string,
//   messages: Array<{ id, senderId, username, text, timestamp, type: 'user' | 'system' }>,
//   participants: Map<socketId, { id: string, username: string, joinedAt: string }>,
//   cleanupTimer: Timeout | null
// }>
const rooms = new Map();

// Map socketId -> { roomCode, username }
const socketToUser = new Map();

function getOrCreateRoom(roomCode) {
  const normalized = roomCode.trim();
  if (!rooms.has(normalized)) {
    rooms.set(normalized, {
      code: normalized,
      messages: [],
      participants: new Map(),
      cleanupTimer: null
    });
  }
  const room = rooms.get(normalized);
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
    console.log(`[Room: ${normalized}] Reconnection detected - canceled cleanup timer.`);
  }
  return room;
}

function handleUserLeave(socket) {
  const userInfo = socketToUser.get(socket.id);
  if (!userInfo) return;

  const { roomCode, username } = userInfo;
  const room = rooms.get(roomCode);

  socketToUser.delete(socket.id);
  socket.leave(roomCode);

  if (room) {
    room.participants.delete(socket.id);

    // Create system notification for user leave
    const leaveMsg = {
      id: crypto.randomUUID(),
      senderId: 'system',
      username: 'System',
      text: `${username} left the chat`,
      timestamp: new Date().toISOString(),
      type: 'system'
    };
    room.messages.push(leaveMsg);

    // Notify remaining participants
    io.to(roomCode).emit('message_received', leaveMsg);
    io.to(roomCode).emit('participants_update', {
      count: room.participants.size,
      participants: Array.from(room.participants.values())
    });

    console.log(`[Room: ${roomCode}] ${username} left. Participants remaining: ${room.participants.size}`);

    // If room is empty, start grace period before permanent in-memory wipe
    if (room.participants.size === 0) {
      console.log(`[Room: ${roomCode}] Room empty. Starting ${GRACE_PERIOD_MS / 1000}s grace timer...`);
      room.cleanupTimer = setTimeout(() => {
        // If still empty after grace period, purge room completely
        const currentRoom = rooms.get(roomCode);
        if (currentRoom && currentRoom.participants.size === 0) {
          rooms.delete(roomCode);
          console.log(`[Room: ${roomCode}] Purged room and all messages from memory.`);
        }
      }, GRACE_PERIOD_MS);
    }
  }
}

io.on('connection', (socket) => {
  console.log(`[Connection] Socket connected: ${socket.id}`);

  // Join or Create Room
  socket.on('join_room', ({ username, roomCode }, callback) => {
    const cleanUsername = (username || '').trim();
    const cleanRoomCode = (roomCode || '').trim();

    if (!cleanUsername || !cleanRoomCode) {
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Username and Room Code are required.' });
      }
      return;
    }

    // Leave any previous room if exists
    handleUserLeave(socket);

    const room = getOrCreateRoom(cleanRoomCode);
    const participantInfo = {
      id: socket.id,
      username: cleanUsername,
      joinedAt: new Date().toISOString()
    };

    room.participants.set(socket.id, participantInfo);
    socketToUser.set(socket.id, { roomCode: cleanRoomCode, username: cleanUsername });

    socket.join(cleanRoomCode);

    // System join message
    const joinMsg = {
      id: crypto.randomUUID(),
      senderId: 'system',
      username: 'System',
      text: `${cleanUsername} joined the chat`,
      timestamp: new Date().toISOString(),
      type: 'system'
    };
    room.messages.push(joinMsg);

    console.log(`[Room: ${cleanRoomCode}] ${cleanUsername} (${socket.id}) joined. Total: ${room.participants.size}`);

    // Acknowledge joiner with full initial state
    if (typeof callback === 'function') {
      callback({
        success: true,
        roomCode: cleanRoomCode,
        username: cleanUsername,
        participants: Array.from(room.participants.values()),
        messages: room.messages
      });
    }

    // Broadcast join message to everyone in the room
    io.to(cleanRoomCode).emit('message_received', joinMsg);

    // Broadcast updated participant list and count
    io.to(cleanRoomCode).emit('participants_update', {
      count: room.participants.size,
      participants: Array.from(room.participants.values())
    });
  });

  // Send Message
  socket.on('send_message', ({ text }, callback) => {
    const userInfo = socketToUser.get(socket.id);
    if (!userInfo) {
      if (typeof callback === 'function') callback({ success: false, error: 'Not connected to a room' });
      return;
    }

    const { roomCode, username } = userInfo;
    const room = rooms.get(roomCode);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'Room does not exist' });
      return;
    }

    const cleanText = (text || '').trim();
    if (!cleanText) {
      if (typeof callback === 'function') callback({ success: false, error: 'Message cannot be empty' });
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      senderId: socket.id,
      username,
      text: cleanText,
      timestamp: new Date().toISOString(),
      type: 'user'
    };

    room.messages.push(message);

    // Broadcast to everyone in room (including sender)
    io.to(roomCode).emit('message_received', message);

    if (typeof callback === 'function') {
      callback({ success: true, messageId: message.id });
    }
  });

  // Clear Chat
  socket.on('clear_chat', (callback) => {
    const userInfo = socketToUser.get(socket.id);
    if (!userInfo) {
      if (typeof callback === 'function') callback({ success: false, error: 'Not in a room' });
      return;
    }

    const { roomCode, username } = userInfo;
    const room = rooms.get(roomCode);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
      return;
    }

    // Clear all messages
    room.messages = [];

    const clearMsg = {
      id: crypto.randomUUID(),
      senderId: 'system',
      username: 'System',
      text: `${username} cleared the chat`,
      timestamp: new Date().toISOString(),
      type: 'system'
    };
    room.messages.push(clearMsg);

    // Broadcast chat cleared event with the notification
    io.to(roomCode).emit('chat_cleared', {
      systemMessage: clearMsg
    });

    console.log(`[Room: ${roomCode}] Chat cleared by ${username}`);

    if (typeof callback === 'function') {
      callback({ success: true });
    }
  });

  // Leave Room
  socket.on('leave_room', (callback) => {
    handleUserLeave(socket);
    if (typeof callback === 'function') {
      callback({ success: true });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[Disconnect] Socket disconnected: ${socket.id}`);
    handleUserLeave(socket);
  });
});

server.listen(PORT, () => {
  console.log(`SChat backend listening on port ${PORT}`);
});
