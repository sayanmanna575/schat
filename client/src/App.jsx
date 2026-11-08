import React, { useState, useEffect, useCallback, useRef } from 'react';
import { socket } from './socket';
import Home from './components/Home';
import ChatRoom from './components/ChatRoom';

const SESSION_STORAGE_KEY = 'schat_session_auth';
const DISCONNECT_STORAGE_KEY = 'schat_disconnected_session';

export default function App() {
  const [inRoom, setInRoom] = useState(false);
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [currentSocketId, setCurrentSocketId] = useState('');
  const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);

  // Refs for tracking active session in socket callbacks
  const activeSessionRef = useRef({ inRoom: false, sessionId: null, username: '', roomCode: '' });

  useEffect(() => {
    activeSessionRef.current = { inRoom, sessionId, username, roomCode };
  }, [inRoom, sessionId, username, roomCode]);

  // Track page unload to support browser/tab close reconnection within 5s grace period
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { inRoom: currentInRoom, sessionId: currentSession, username: currentUser, roomCode: currentRoom } = activeSessionRef.current;
      if (currentInRoom && currentSession && currentUser && currentRoom) {
        try {
          localStorage.setItem(
            DISCONNECT_STORAGE_KEY,
            JSON.stringify({
              sessionId: currentSession,
              username: currentUser,
              roomCode: currentRoom,
              disconnectedAt: Date.now()
            })
          );
        } catch {
          // ignore storage errors
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Handle socket event listeners
  useEffect(() => {
    function onConnect() {
      setCurrentSocketId(socket.id);

      // If socket reconnects and we had an active session, auto-rejoin session
      const { inRoom: wasInRoom, sessionId: currentSession, username: currUser, roomCode: currRoom } = activeSessionRef.current;
      if (wasInRoom && currentSession && currRoom && currUser) {
        console.log('[Socket Reconnected] Restoring session with server...');
        socket.emit('join_room', { username: currUser, roomCode: currRoom, sessionId: currentSession }, (response) => {
          if (response?.success) {
            localStorage.removeItem(DISCONNECT_STORAGE_KEY);
            setParticipants(response.participants || []);
            setMessages(response.messages || []);
          } else {
            // Grace period expired or room deleted
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
            localStorage.removeItem(DISCONNECT_STORAGE_KEY);
            setInRoom(false);
            setSessionId(null);
            setError(response?.error || 'Session expired or room no longer exists.');
          }
        });
      }
    }

    function onMessageReceived(message) {
      setMessages((prev) => [...prev, message]);
    }

    function onParticipantsUpdate(data) {
      if (data?.participants) {
        setParticipants(data.participants);
      }
    }

    function onChatCleared(data) {
      if (data?.systemMessage) {
        setMessages([data.systemMessage]);
      } else {
        setMessages([]);
      }
    }

    function onTypingStatus(data) {
      setIsOtherUserTyping(Boolean(data?.isTyping));
    }

    function onDisconnect(reason) {
      console.log('[Socket Disconnected] Reason:', reason);
      setIsOtherUserTyping(false);
    }

    socket.on('connect', onConnect);
    socket.on('message_received', onMessageReceived);
    socket.on('participants_update', onParticipantsUpdate);
    socket.on('chat_cleared', onChatCleared);
    socket.on('typing_status', onTypingStatus);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('message_received', onMessageReceived);
      socket.off('participants_update', onParticipantsUpdate);
      socket.off('chat_cleared', onChatCleared);
      socket.off('typing_status', onTypingStatus);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const handleConnect = useCallback((targetUsername, targetRoomCode, existingSessionId = null) => {
    setIsConnecting(true);
    setError('');

    const joinAction = () => {
      setCurrentSocketId(socket.id);
      socket.emit(
        'join_room',
        {
          username: targetUsername,
          roomCode: targetRoomCode,
          sessionId: existingSessionId
        },
        (response) => {
          setIsConnecting(false);
          if (response?.success) {
            setUsername(response.username);
            setRoomCode(response.roomCode);
            setSessionId(response.sessionId);
            setParticipants(response.participants || []);
            setMessages(response.messages || []);
            setInRoom(true);

            // Clean up any disconnected flag and save session credentials for refresh
            // Never persist chat messages in storage
            localStorage.removeItem(DISCONNECT_STORAGE_KEY);
            sessionStorage.setItem(
              SESSION_STORAGE_KEY,
              JSON.stringify({
                sessionId: response.sessionId,
                username: response.username,
                roomCode: response.roomCode
              })
            );
          } else {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
            localStorage.removeItem(DISCONNECT_STORAGE_KEY);
            setError(response?.error || 'Failed to connect to room.');
          }
        }
      );
    };

    if (!socket.connected) {
      socket.connect();
      socket.once('connect', () => {
        joinAction();
      });
      socket.once('connect_error', () => {
        setIsConnecting(false);
        setError('Unable to connect to server. Please try again.');
      });
    } else {
      joinAction();
    }
  }, []);

  // Check for existing session token on browser refresh / page load
  useEffect(() => {
    let sessionToRestore = null;

    // 1. Try sessionStorage first (for page refresh, same tab)
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        sessionToRestore = JSON.parse(stored);
      }
    } catch {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }

    // 2. If not found, check localStorage for recently closed tab/browser within 5s grace period
    if (!sessionToRestore) {
      try {
        const storedDisconnect = localStorage.getItem(DISCONNECT_STORAGE_KEY);
        if (storedDisconnect) {
          const parsed = JSON.parse(storedDisconnect);
          const elapsed = Date.now() - (parsed.disconnectedAt || 0);
          if (elapsed < 5000 && parsed.sessionId && parsed.username && parsed.roomCode) {
            sessionToRestore = parsed;
          } else {
            localStorage.removeItem(DISCONNECT_STORAGE_KEY);
          }
        }
      } catch {
        localStorage.removeItem(DISCONNECT_STORAGE_KEY);
      }
    }

    if (sessionToRestore && sessionToRestore.sessionId && sessionToRestore.username && sessionToRestore.roomCode) {
      console.log('[Auto-Restore] Found stored session, reconnecting within grace period...');
      handleConnect(sessionToRestore.username, sessionToRestore.roomCode, sessionToRestore.sessionId);
    }
  }, [handleConnect]);

  const handleSendMessage = useCallback((text) => {
    socket.emit('send_message', { text });
  }, []);

  const handleClearChat = useCallback(() => {
    socket.emit('clear_chat');
  }, []);

  const handleLeaveRoom = useCallback(() => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(DISCONNECT_STORAGE_KEY);
    setIsOtherUserTyping(false);
    socket.emit('typing_stop');
    socket.emit('leave_room', () => {
      setInRoom(false);
      setMessages([]);
      setParticipants([]);
      setRoomCode('');
      setSessionId(null);
      socket.disconnect();
    });
  }, []);

  const handleTypingStart = useCallback(() => {
    socket.emit('typing_start');
  }, []);

  const handleTypingStop = useCallback(() => {
    socket.emit('typing_stop');
  }, []);

  if (inRoom) {
    return (
      <ChatRoom
        username={username}
        roomCode={roomCode}
        sessionId={sessionId}
        participants={participants}
        messages={messages}
        onSendMessage={handleSendMessage}
        onClearChat={handleClearChat}
        onLeaveRoom={handleLeaveRoom}
        currentSocketId={currentSocketId || socket.id}
        isOtherUserTyping={isOtherUserTyping}
        onTypingStart={handleTypingStart}
        onTypingStop={handleTypingStop}
      />
    );
  }

  return (
    <Home
      onConnect={(user, room) => handleConnect(user, room, null)}
      isConnecting={isConnecting}
      error={error}
    />
  );
}
