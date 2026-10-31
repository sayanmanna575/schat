import React, { useState, useEffect, useRef } from 'react';
import { Users, Send, LogOut, Trash2, X, MessageSquare } from 'lucide-react';
import ClearConfirmModal from './ClearConfirmModal';

function formatTimestamp(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function ChatRoom({
  username,
  roomCode,
  participants,
  messages,
  onSendMessage,
  onClearChat,
  onLeaveRoom,
  currentSocketId
}) {
  const [inputText, setInputText] = useState('');
  const [isMobileMembersOpen, setIsMobileMembersOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const handleConfirmClear = () => {
    setIsClearModalOpen(false);
    onClearChat();
  };

  return (
    <div className="h-screen w-screen flex bg-navy-950 text-slate-100 overflow-hidden select-none">
      {/* ================= LEFT SIDEBAR (Desktop) ================= */}
      <aside className="hidden md:flex flex-col w-64 lg:w-72 bg-navy-900 border-r border-navy-800 p-5 flex-shrink-0 justify-between">
        <div className="flex flex-col min-h-0">
          {/* Logo */}
          <div className="flex items-center justify-between pb-4 border-b border-navy-800">
            <h1 className="text-xl font-bold tracking-tight text-white">
              SChat<span className="text-cyan-accent">.</span>
            </h1>
          </div>

          {/* Room Info */}
          <div className="py-4 border-b border-navy-800">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
              Room Code
            </div>
            <div className="text-sm font-mono font-medium text-cyan-accent truncate">
              {roomCode}
            </div>

            <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-accent"></span>
              </span>
              <span>{participants.length} {participants.length === 1 ? 'participant' : 'participants'} online</span>
            </div>
          </div>

          {/* Connected Members List */}
          <div className="flex-1 py-4 flex flex-col min-h-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
              Participants ({participants.length})
            </div>
            <div className="overflow-y-auto space-y-1.5 pr-1 flex-1">
              {participants.map((p) => {
                const isMe = p.id === currentSocketId;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                      isMe
                        ? 'bg-navy-800/80 text-white border border-navy-700/60'
                        : 'text-slate-300 hover:bg-navy-800/40'
                    }`}
                  >
                    <span className="truncate flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-accent/80 flex-shrink-0"></span>
                      <span className="truncate">{p.username}</span>
                    </span>
                    {isMe && (
                      <span className="text-[10px] text-cyan-accent uppercase tracking-wider font-semibold">
                        You
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Leave Room Button */}
        <div className="pt-4 border-t border-navy-800">
          <button
            type="button"
            onClick={onLeaveRoom}
            id="leave-room-btn"
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium text-slate-400 hover:text-rose-400 bg-navy-850 hover:bg-navy-800 border border-navy-750 transition"
          >
            <LogOut size={14} />
            <span>Leave Room</span>
          </button>
        </div>
      </aside>

      {/* ================= MOBILE MEMBERS DRAWER ================= */}
      {isMobileMembersOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden bg-black/60 backdrop-blur-xs">
          <div className="w-64 max-w-[80%] bg-navy-900 border-r border-navy-800 h-full p-4 flex flex-col justify-between">
            <div className="flex flex-col min-h-0">
              <div className="flex items-center justify-between pb-3 border-b border-navy-800">
                <h2 className="text-base font-bold text-white">
                  SChat<span className="text-cyan-accent">.</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setIsMobileMembersOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="py-3 border-b border-navy-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">
                  Room Code
                </div>
                <div className="text-xs font-mono font-medium text-cyan-accent truncate">
                  {roomCode}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                  <span className="h-2 w-2 rounded-full bg-cyan-accent"></span>
                  <span>{participants.length} online</span>
                </div>
              </div>

              <div className="flex-1 py-3 overflow-y-auto space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
                  Members
                </div>
                {participants.map((p) => {
                  const isMe = p.id === currentSocketId;
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs ${
                        isMe ? 'bg-navy-800 text-white' : 'text-slate-300'
                      }`}
                    >
                      <span className="truncate">{p.username}</span>
                      {isMe && <span className="text-[10px] text-cyan-accent">You</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={onLeaveRoom}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-rose-400 bg-navy-800 border border-navy-700"
            >
              <LogOut size={14} />
              <span>Leave Room</span>
            </button>
          </div>

          <div className="flex-1" onClick={() => setIsMobileMembersOpen(false)} />
        </div>
      )}

      {/* ================= MAIN CHAT AREA ================= */}
      <main className="flex-1 flex flex-col h-full bg-navy-950 min-w-0">
        {/* Chat Header */}
        <header className="h-14 px-4 md:px-6 border-b border-navy-800 bg-navy-900/70 backdrop-blur-xs flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile toggle button */}
            <button
              type="button"
              id="mobile-members-toggle"
              onClick={() => setIsMobileMembersOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white bg-navy-800 border border-navy-700 flex items-center gap-1.5 text-xs"
              title="View participants"
            >
              <Users size={15} />
              <span className="text-[11px]">{participants.length}</span>
            </button>

            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white truncate">
                  {roomCode}
                </span>
                <span className="hidden sm:inline-block w-1.5 h-1.5 rounded-full bg-cyan-accent"></span>
                <span className="hidden sm:inline-block text-xs text-slate-400 font-normal">
                  {participants.length} online
                </span>
              </div>
            </div>
          </div>

          {/* CLEAR CHAT Button */}
          <button
            type="button"
            id="clear-chat-btn"
            onClick={() => setIsClearModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider text-slate-400 hover:text-rose-400 bg-navy-800/80 hover:bg-navy-800 border border-navy-700 hover:border-rose-500/30 transition active:scale-95"
          >
            <Trash2 size={13} />
            <span>Clear Chat</span>
          </button>
        </header>

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3 min-h-0">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs text-center select-none">
              <MessageSquare size={24} className="mb-2 text-slate-600 opacity-60" />
              <span>No messages yet in this room</span>
            </div>
          ) : (
            messages.map((msg) => {
              // System notifications (joined, left, chat cleared)
              if (msg.type === 'system') {
                return (
                  <div
                    key={msg.id}
                    className="flex items-center justify-center my-3 select-none"
                  >
                    <div className="text-[11px] text-slate-400 bg-navy-900/90 border border-navy-800 px-3 py-1 rounded-full flex items-center gap-2">
                      <span>{msg.text}</span>
                      <span className="text-[9px] text-slate-500">
                        {formatTimestamp(msg.timestamp)}
                      </span>
                    </div>
                  </div>
                );
              }

              const isMe = msg.senderId === currentSocketId || msg.username === username;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  {/* Sender metadata */}
                  <div
                    className={`flex items-center gap-1.5 text-[11px] mb-1 px-1 ${
                      isMe ? 'flex-row-reverse text-slate-400' : 'text-slate-400'
                    }`}
                  >
                    <span className={`font-medium ${isMe ? 'text-cyan-bright' : 'text-cyan-accent'}`}>
                      {isMe ? 'You' : msg.username}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed max-w-[85%] md:max-w-[70%] break-words select-text ${
                      isMe
                        ? 'bg-cyan-600 text-white rounded-tr-xs shadow-xs'
                        : 'bg-navy-850 text-slate-100 rounded-tl-xs border border-navy-750 shadow-xs'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input Bottom Area */}
        <div className="p-3 md:p-4 border-t border-navy-800 bg-navy-900/60 flex-shrink-0">
          <form
            onSubmit={handleSend}
            className="flex items-center gap-2 max-w-4xl mx-auto"
          >
            <input
              ref={inputRef}
              type="text"
              id="message-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              autoComplete="off"
              className="flex-1 bg-navy-900 text-slate-100 placeholder-slate-500 text-sm px-4 py-2.5 rounded-xl border border-navy-700 focus:border-cyan-accent focus:outline-none focus:ring-1 focus:ring-cyan-accent/30 transition select-text"
            />
            <button
              type="submit"
              id="send-message-btn"
              disabled={!inputText.trim()}
              className="bg-cyan-accent hover:bg-cyan-bright disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 p-2.5 rounded-xl transition flex items-center justify-center flex-shrink-0 shadow-xs active:scale-95"
              title="Send message"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </main>

      {/* Confirmation Modal for Clearing Chat */}
      <ClearConfirmModal
        isOpen={isClearModalOpen}
        onConfirm={handleConfirmClear}
        onCancel={() => setIsClearModalOpen(false)}
      />
    </div>
  );
}
