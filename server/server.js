const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || '*';
const RECONNECTION_GRACE_PERIOD_MS = parseInt(process.env.RECONNECTION_GRACE_PERIOD_MS, 10) || 5000; // 5 seconds grace period

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

// In-memory temporary room store
// rooms: Map<roomCode, {
//   code: string,
//   messages: Array<{ id, sessionId, senderId, username, text, timestamp, type: 'user' | 'system' }>,
//   participants: Map<sessionId, {
//     sessionId: string,
//     username: string,
//     socketId: string | null,
//     joinedAt: string,
//     status: 'connected' | 'disconnected',
//     disconnectTimer: Timeout | null
//   }>
// }>
const rooms = new Map();

// Map socket.id -> { roomCode: string, sessionId: string }
const socketToSession = new Map();

function getOrCreateRoom(roomCode) {
  const normalized = roomCode.trim();
  if (!rooms.has(normalized)) {
    rooms.set(normalized, {
      code: normalized,
      messages: [],
      participants: new Map()
    });
    console.log(`[Room: ${normalized}] Created new empty room.`);
  }
  return rooms.get(normalized);
}

function getSanitizedParticipants(room) {
  // Returns array of participant objects safe for client consumption
  return Array.from(room.participants.values()).map((p) => ({
    id: p.sessionId, // use unique sessionId as id for UI keys
    sessionId: p.sessionId,
    username: p.username,
    status: p.status,
    joinedAt: p.joinedAt
  }));
}

function getConnectedCount(room) {
  let count = 0;
  for (const p of room.participants.values()) {
    if (p.status === 'connected') count++;
  }
  return count;
}

function broadcastParticipantsUpdate(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const participants = getSanitizedParticipants(room);
  const connectedCount = getConnectedCount(room);

  io.to(roomCode).emit('participants_update', {
    count: connectedCount,
    totalSessions: participants.length,
    participants
  });
}

function deleteRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  // Clear any and all pending timers across all participants
  for (const participant of room.participants.values()) {
    if (participant.disconnectTimer) {
      clearTimeout(participant.disconnectTimer);
      participant.disconnectTimer = null;
    }
  }

  // Clear socket mappings for any sockets in this room
  for (const [sockId, sessionInfo] of socketToSession.entries()) {
    if (sessionInfo.roomCode === roomCode) {
      socketToSession.delete(sockId);
    }
  }

  room.participants.clear();
  room.messages = [];
  rooms.delete(roomCode);
  console.log(`[Room: ${roomCode}] Room empty. Permanently deleted room and cleared all messages from memory.`);
}

function deleteRoomIfEmpty(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  // A room is only empty if it has ZERO participants (no active and no disconnected in grace period)
  if (room.participants.size === 0) {
    deleteRoom(roomCode);
  }
}

function handlePermanentDisconnection(roomCode, sessionId) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const participant = room.participants.get(sessionId);
  if (!participant) return;

  // Verify they are still disconnected (they didn't reconnect in time)
  if (participant.status === 'disconnected') {
    const username = participant.username;

    // Clear timer reference
    if (participant.disconnectTimer) {
      clearTimeout(participant.disconnectTimer);
      participant.disconnectTimer = null;
    }

    // Permanently remove participant session
    room.participants.delete(sessionId);
    console.log(`[Room: ${roomCode}] Grace period expired for ${username} (${sessionId}). Session permanently removed.`);

    // Broadcast leave notification ONCE
    const leaveMsg = {
      id: crypto.randomUUID(),
      sessionId: 'system',
      senderId: 'system',
      username: 'System',
      text: `${username} left the chat`,
      timestamp: new Date().toISOString(),
      type: 'system'
    };
    room.messages.push(leaveMsg);

    io.to(roomCode).emit('message_received', leaveMsg);
    broadcastParticipantsUpdate(roomCode);

    // If that was the last participant, permanently delete the room
    deleteRoomIfEmpty(roomCode);
  }
}

function handleExplicitLeave(socket, callback) {
  const sessionInfo = socketToSession.get(socket.id);
  if (!sessionInfo) {
    if (typeof callback === 'function') callback({ success: true });
    return;
  }

  const { roomCode, sessionId } = sessionInfo;
  socketToSession.delete(socket.id);
  socket.leave(roomCode);

  const room = rooms.get(roomCode);
  if (room) {
    const participant = room.participants.get(sessionId);
    if (participant) {
      // Cancel any pending timer
      if (participant.disconnectTimer) {
        clearTimeout(participant.disconnectTimer);
        participant.disconnectTimer = null;
      }

      const username = participant.username;
      room.participants.delete(sessionId);
      console.log(`[Room: ${roomCode}] ${username} (${sessionId}) explicitly left.`);

      // Broadcast leave message
      const leaveMsg = {
        id: crypto.randomUUID(),
        sessionId: 'system',
        senderId: 'system',
        username: 'System',
        text: `${username} left the chat`,
        timestamp: new Date().toISOString(),
        type: 'system'
      };
      room.messages.push(leaveMsg);

      io.to(roomCode).emit('message_received', leaveMsg);
      broadcastParticipantsUpdate(roomCode);

      // Clean up room if empty
      deleteRoomIfEmpty(roomCode);
    }
  }

  if (typeof callback === 'function') {
    callback({ success: true });
  }
}

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // Join Room or Reconnect Existing Session
  socket.on('join_room', ({ username, roomCode, sessionId }, callback) => {
    const cleanUsername = (username || '').trim();
    const cleanRoomCode = (roomCode || '').trim();

    if (!cleanUsername || !cleanRoomCode) {
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Username and Room Code are required.' });
      }
      return;
    }

    // Case 1: Reconnecting an existing session within the 5s grace period
    if (sessionId) {
      const existingRoom = rooms.get(cleanRoomCode);
      if (existingRoom && existingRoom.participants.has(sessionId)) {
        const existingParticipant = existingRoom.participants.get(sessionId);

        // Cancel the pending 5s disconnection timer immediately!
        if (existingParticipant.disconnectTimer) {
          clearTimeout(existingParticipant.disconnectTimer);
          existingParticipant.disconnectTimer = null;
          console.log(`[Room: ${cleanRoomCode}] Canceled 5s disconnect timer for ${existingParticipant.username} (${sessionId})`);
        }

        // If old socket existed in mapping, clean it up
        if (existingParticipant.socketId && existingParticipant.socketId !== socket.id) {
          socketToSession.delete(existingParticipant.socketId);
        }

        // Restore participant status and socket ID
        existingParticipant.socketId = socket.id;
        existingParticipant.status = 'connected';
        if (cleanUsername) {
          existingParticipant.username = cleanUsername; // update username if changed
        }

        socketToSession.set(socket.id, { roomCode: cleanRoomCode, sessionId });
        socket.join(cleanRoomCode);

        console.log(`[Room: ${cleanRoomCode}] Session RESTORED for ${existingParticipant.username} (${sessionId}). Active: ${getConnectedCount(existingRoom)}`);

        // Acknowledge reconnection to client with full history (no duplicate join notification)
        if (typeof callback === 'function') {
          callback({
            success: true,
            reconnected: true,
            sessionId,
            roomCode: cleanRoomCode,
            username: existingParticipant.username,
            participants: getSanitizedParticipants(existingRoom),
            messages: existingRoom.messages
          });
        }

        // Update participant list for everyone
        broadcastParticipantsUpdate(cleanRoomCode);
        return;
      } else {
        // Session ID provided, but session expired or room no longer exists
        console.log(`[Room: ${cleanRoomCode}] Reconnection failed: Session ${sessionId} expired or not found.`);
        if (typeof callback === 'function') {
          callback({
            success: false,
            sessionExpired: true,
            error: 'Session expired or room no longer exists.'
          });
        }
        return;
      }
    }

    // Case 2: New participant joining the room (no sessionId provided)
    const room = getOrCreateRoom(cleanRoomCode);
    const newSessionId = crypto.randomUUID();
    const newParticipant = {
      sessionId: newSessionId,
      username: cleanUsername,
      socketId: socket.id,
      joinedAt: new Date().toISOString(),
      status: 'connected',
      disconnectTimer: null
    };

    room.participants.set(newSessionId, newParticipant);
    socketToSession.set(socket.id, { roomCode: cleanRoomCode, sessionId: newSessionId });
    socket.join(cleanRoomCode);

    // Broadcast system join message
    const joinMsg = {
      id: crypto.randomUUID(),
      sessionId: 'system',
      senderId: 'system',
      username: 'System',
      text: `${cleanUsername} joined the chat`,
      timestamp: new Date().toISOString(),
      type: 'system'
    };
    room.messages.push(joinMsg);

    console.log(`[Room: ${cleanRoomCode}] ${cleanUsername} (${newSessionId}) joined as new participant. Total sessions: ${room.participants.size}`);

    // Acknowledge joiner with full initial state
    if (typeof callback === 'function') {
      callback({
        success: true,
        reconnected: false,
        sessionId: newSessionId,
        roomCode: cleanRoomCode,
        username: cleanUsername,
        participants: getSanitizedParticipants(room),
        messages: room.messages
      });
    }

    // Broadcast join message and updated participants
    io.to(cleanRoomCode).emit('message_received', joinMsg);
    broadcastParticipantsUpdate(cleanRoomCode);
  });

  // Send Message
  socket.on('send_message', ({ text }, callback) => {
    const sessionInfo = socketToSession.get(socket.id);
    if (!sessionInfo) {
      if (typeof callback === 'function') callback({ success: false, error: 'Not connected to a room' });
      return;
    }

    const { roomCode, sessionId } = sessionInfo;
    const room = rooms.get(roomCode);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'Room does not exist' });
      return;
    }

    const participant = room.participants.get(sessionId);
    if (!participant) {
      if (typeof callback === 'function') callback({ success: false, error: 'Session not found' });
      return;
    }

    const cleanText = (text || '').trim();
    if (!cleanText) {
      if (typeof callback === 'function') callback({ success: false, error: 'Message cannot be empty' });
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      sessionId,
      senderId: socket.id,
      username: participant.username,
      text: cleanText,
      timestamp: new Date().toISOString(),
      type: 'user'
    };

    room.messages.push(message);

    // Broadcast to everyone in room
    io.to(roomCode).emit('message_received', message);

    if (typeof callback === 'function') {
      callback({ success: true, messageId: message.id });
    }
  });

  // Clear Chat
  socket.on('clear_chat', (callback) => {
    const sessionInfo = socketToSession.get(socket.id);
    if (!sessionInfo) {
      if (typeof callback === 'function') callback({ success: false, error: 'Not in a room' });
      return;
    }

    const { roomCode, sessionId } = sessionInfo;
    const room = rooms.get(roomCode);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
      return;
    }

    const participant = room.participants.get(sessionId);
    const username = participant ? participant.username : 'Someone';

    // Clear all messages
    room.messages = [];

    const clearMsg = {
      id: crypto.randomUUID(),
      sessionId: 'system',
      senderId: 'system',
      username: 'System',
      text: `${username} cleared the chat`,
      timestamp: new Date().toISOString(),
      type: 'system'
    };
    room.messages.push(clearMsg);

    // Broadcast chat cleared event with notification
    io.to(roomCode).emit('chat_cleared', {
      systemMessage: clearMsg
    });

    console.log(`[Room: ${roomCode}] Chat cleared by ${username}`);

    if (typeof callback === 'function') {
      callback({ success: true });
    }
  });

  // Explicit Leave Room
  socket.on('leave_room', (callback) => {
    handleExplicitLeave(socket, callback);
  });

  // Browser Disconnection (Tab close, refresh, network drop)
  socket.on('disconnect', () => {
    const sessionInfo = socketToSession.get(socket.id);
    if (!sessionInfo) return;

    const { roomCode, sessionId } = sessionInfo;
    socketToSession.delete(socket.id);

    const room = rooms.get(roomCode);
    if (!room) return;

    const participant = room.participants.get(sessionId);
    if (!participant) return;

    // RACE CONDITION GUARD:
    // If this session has already reconnected with another socket (e.g. faster page reload or simultaneous connection),
    // do not disconnect the participant or start the disconnect timer.
    if (participant.socketId && participant.socketId !== socket.id) {
      console.log(`[Disconnect Ignored] Socket ${socket.id} closed, but session ${sessionId} is active on socket ${participant.socketId}`);
      return;
    }

    // Mark as temporarily disconnected
    participant.status = 'disconnected';
    participant.socketId = null;

    console.log(`[Disconnect] ${participant.username} (${sessionId}) disconnected from ${roomCode}. Starting ${RECONNECTION_GRACE_PERIOD_MS / 1000}s timer...`);

    // Broadcast updated online count (they are temporarily offline)
    broadcastParticipantsUpdate(roomCode);

    // Start 5-second reconnection timer
    if (participant.disconnectTimer) {
      clearTimeout(participant.disconnectTimer);
    }

    participant.disconnectTimer = setTimeout(() => {
      handlePermanentDisconnection(roomCode, sessionId);
    }, RECONNECTION_GRACE_PERIOD_MS);
  });
});

server.listen(PORT, () => {
  console.log(`SChat backend listening on port ${PORT}`);
});
