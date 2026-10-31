import React, { useState, useEffect, useCallback } from 'react';
import { socket } from './socket';
import Home from './components/Home';
import ChatRoom from './components/ChatRoom';

export default function App() {
  const [inRoom, setInRoom] = useState(false);
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [currentSocketId, setCurrentSocketId] = useState('');

  // Handle socket event listeners
  useEffect(() => {
    function onConnect() {
      setCurrentSocketId(socket.id);
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

    function onDisconnect() {
      console.log('Socket disconnected');
    }

    socket.on('connect', onConnect);
    socket.on('message_received', onMessageReceived);
    socket.on('participants_update', onParticipantsUpdate);
    socket.on('chat_cleared', onChatCleared);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('message_received', onMessageReceived);
      socket.off('participants_update', onParticipantsUpdate);
      socket.off('chat_cleared', onChatCleared);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const handleConnect = useCallback((targetUsername, targetRoomCode) => {
    setIsConnecting(true);
    setError('');

    const joinAction = () => {
      setCurrentSocketId(socket.id);
      socket.emit('join_room', { username: targetUsername, roomCode: targetRoomCode }, (response) => {
        setIsConnecting(false);
        if (response?.success) {
          setUsername(response.username);
          setRoomCode(response.roomCode);
          setParticipants(response.participants || []);
          setMessages(response.messages || []);
          setInRoom(true);
        } else {
          setError(response?.error || 'Failed to connect to room.');
        }
      });
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

  const handleSendMessage = useCallback((text) => {
    socket.emit('send_message', { text });
  }, []);

  const handleClearChat = useCallback(() => {
    socket.emit('clear_chat');
  }, []);

  const handleLeaveRoom = useCallback(() => {
    socket.emit('leave_room', () => {
      setInRoom(false);
      setMessages([]);
      setParticipants([]);
      setRoomCode('');
      // Disconnect socket cleanly on leaving
      socket.disconnect();
    });
  }, []);

  if (inRoom) {
    return (
      <ChatRoom
        username={username}
        roomCode={roomCode}
        participants={participants}
        messages={messages}
        onSendMessage={handleSendMessage}
        onClearChat={handleClearChat}
        onLeaveRoom={handleLeaveRoom}
        currentSocketId={currentSocketId || socket.id}
      />
    );
  }

  return (
    <Home
      onConnect={handleConnect}
      isConnecting={isConnecting}
      error={error}
    />
  );
}
