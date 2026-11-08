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
  sessionId,
  participants,
  messages,
  onSendMessage,
  onClearChat,
  onLeaveRoom,
  currentSocketId,
  isOtherUserTyping,
  onTypingStart,
  onTypingStop
}) {
  const [inputText, setInputText] = useState('');
  const [isMobileMembersOpen, setIsMobileMembersOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() => {
    if (typeof window !== 'undefined' && window.visualViewport) {
      return Math.round(window.visualViewport.height);
    }
    return typeof window !== 'undefined' ? window.innerHeight : null;
  });

  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const isInputFocusedRef = useRef(false);
  const wasFocusedBeforeSendRef = useRef(false);
  const isSendingRef = useRef(false);

  const onlineCount = participants.filter((p) => p.status !== 'disconnected').length;

  // Track whether user was reading earlier messages or is at the latest message
  const handleMessagesScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
  };

  // Track visual viewport height dynamically for keyboard open/close
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;

    const handleViewportUpdate = () => {
      const height = vv ? Math.round(vv.height) : window.innerHeight;
      setViewportHeight(height);
    };

    if (vv) {
      vv.addEventListener('resize', handleViewportUpdate);
    }
    window.addEventListener('resize', handleViewportUpdate);

    handleViewportUpdate();

    return () => {
      if (vv) {
        vv.removeEventListener('resize', handleViewportUpdate);
      }
      window.removeEventListener('resize', handleViewportUpdate);
    };
  }, []);

  // When viewport height changes (e.g. keyboard opens/closes), keep scrolled to bottom if user was near bottom
  useEffect(() => {
    if (messagesContainerRef.current && isNearBottomRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'auto'
      });
    }
  }, [viewportHeight]);

  // Auto-scroll inside messages container when new message arrives or typing changes
  useEffect(() => {
    if (messagesContainerRef.current && isNearBottomRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, isOtherUserTyping]);

  // Clean up typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (onTypingStop) onTypingStop();
    };
  }, [onTypingStop]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputText(val);

    if (val.trim()) {
      if (onTypingStart) onTypingStart();

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Hide indicator after 2 seconds of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        if (onTypingStop) onTypingStop();
      }, 2000);
    } else {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (onTypingStop) onTypingStop();
    }
  };

  const handleInputFocus = () => {
    isInputFocusedRef.current = true;
    wasFocusedBeforeSendRef.current = false;
    isSendingRef.current = false;

    // When user manually taps input, anchor to latest message if already near bottom
    if (messagesContainerRef.current && isNearBottomRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'auto'
      });
    }
  };

  const handleInputBlur = () => {
    // If user tapped Send, do NOT consider keyboard manually dismissed
    if (!isSendingRef.current) {
      isInputFocusedRef.current = false;
      wasFocusedBeforeSendRef.current = false;
    }
  };

  const handleSend = (e) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) {
      isSendingRef.current = false;
      return;
    }

    // Determine if input was actively focused prior to sending
    const wasFocused =
      wasFocusedBeforeSendRef.current ||
      isInputFocusedRef.current ||
      document.activeElement === inputRef.current;

    // Immediately stop typing indicator on send
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (onTypingStop) onTypingStop();

    onSendMessage(inputText.trim());
    setInputText('');

    // Scroll message container to latest message
    isNearBottomRef.current = true;
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }

    // If user was actively typing (keyboard open), keep input focused so keyboard remains open
    // If user had manually dismissed the keyboard (wasFocused === false), do NOT touch focus!
    if (wasFocused && inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
      isInputFocusedRef.current = true;
    }

    // Reset sending flags
    isSendingRef.current = false;
    wasFocusedBeforeSendRef.current = wasFocused;
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      wasFocusedBeforeSendRef.current =
        isInputFocusedRef.current || document.activeElement === inputRef.current;
      handleSend(e);
    }
  };

  const handleConfirmClear = () => {
    setIsClearModalOpen(false);
    onClearChat();
  };

  return (
    <div
      className="w-full max-w-full flex flex-col md:flex-row bg-navy-950 text-slate-100 overflow-hidden select-none h-full md:h-screen"
      style={{
        height: viewportHeight ? `${viewportHeight}px` : '100%',
        maxHeight: viewportHeight ? `${viewportHeight}px` : '100%'
      }}
    >
      {/* ================= LEFT SIDEBAR (Desktop & Tablet) ================= */}
      <aside className="hidden md:flex flex-col w-[clamp(14rem,22vw,18rem)] bg-navy-900 border-r border-navy-800 p-4 lg:p-5 flex-shrink-0 justify-between min-h-0 h-full overflow-hidden">
        <div className="flex flex-col min-h-0 flex-1">
          {/* Logo */}
          <div className="flex items-center justify-between pb-3 lg:pb-4 border-b border-navy-800 flex-shrink-0">
            <h1 className="text-xl font-bold tracking-tight text-white">
              SChat<span className="text-cyan-accent">.</span>
            </h1>
          </div>

          {/* Room Info */}
          <div className="py-3 lg:py-4 border-b border-navy-800 flex-shrink-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
              Room Code
            </div>
            <div className="text-sm font-mono font-medium text-cyan-accent truncate">
              {roomCode}
            </div>

            <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-300">
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-accent"></span>
              </span>
              <span className="truncate">{onlineCount} {onlineCount === 1 ? 'participant' : 'participants'} online</span>
            </div>
          </div>

          {/* Connected Members List */}
          <div className="flex-1 py-3 lg:py-4 flex flex-col min-h-0 overflow-hidden">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex-shrink-0">
              Participants ({participants.length})
            </div>
            <div className="overflow-y-auto space-y-1.5 pr-1 flex-1 min-h-0">
              {participants.map((p) => {
                const isMe = (sessionId && p.sessionId === sessionId) || p.id === currentSocketId;
                const isDisconnected = p.status === 'disconnected';

                return (
                  <div
                    key={p.sessionId || p.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                      isMe
                        ? 'bg-navy-800/80 text-white border border-navy-700/60'
                        : 'text-slate-300 hover:bg-navy-800/40'
                    }`}
                  >
                    <span className="truncate flex items-center gap-2 min-w-0 mr-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          isDisconnected ? 'bg-amber-400 animate-pulse' : 'bg-cyan-accent'
                        }`}
                        title={isDisconnected ? 'Reconnecting...' : 'Online'}
                      />
                      <span className={`truncate ${isDisconnected ? 'text-slate-400 italic' : ''}`}>
                        {p.username}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      {isDisconnected && (
                        <span className="text-[9px] text-amber-400 font-normal">
                          reconnecting
                        </span>
                      )}
                      {isMe && (
                        <span className="text-[10px] text-cyan-accent uppercase tracking-wider font-semibold">
                          You
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Leave Room Button */}
        <div className="pt-3 lg:pt-4 border-t border-navy-800 flex-shrink-0">
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
        <div
          className="fixed inset-0 z-50 flex md:hidden bg-black/60 backdrop-blur-sm"
          style={{ height: viewportHeight ? `${viewportHeight}px` : '100%' }}
        >
          <div className="w-[min(20rem,82vw)] bg-navy-900 border-r border-navy-800 h-full p-4 sm:p-5 flex flex-col justify-between shadow-2xl">
            <div className="flex flex-col min-h-0 flex-1">
              <div className="flex items-center justify-between pb-3 border-b border-navy-800 flex-shrink-0">
                <h2 className="text-base font-bold text-white">
                  SChat<span className="text-cyan-accent">.</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setIsMobileMembersOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-navy-800 transition"
                  aria-label="Close participants list"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="py-3 border-b border-navy-800 flex-shrink-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">
                  Room Code
                </div>
                <div className="text-xs font-mono font-medium text-cyan-accent truncate">
                  {roomCode}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                  <span className="h-2 w-2 rounded-full bg-cyan-accent flex-shrink-0"></span>
                  <span>{onlineCount} {onlineCount === 1 ? 'participant' : 'participants'} online</span>
                </div>
              </div>

              <div className="flex-1 py-3 overflow-y-auto space-y-1 min-h-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex-shrink-0">
                  Members ({participants.length})
                </div>
                {participants.map((p) => {
                  const isMe = (sessionId && p.sessionId === sessionId) || p.id === currentSocketId;
                  const isDisconnected = p.status === 'disconnected';

                  return (
                    <div
                      key={p.sessionId || p.id}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs ${
                        isMe ? 'bg-navy-800 text-white' : 'text-slate-300'
                      }`}
                    >
                      <span className="truncate flex items-center gap-1.5 min-w-0 mr-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            isDisconnected ? 'bg-amber-400' : 'bg-cyan-accent'
                          }`}
                        />
                        <span className={`truncate ${isDisconnected ? 'italic text-slate-400' : ''}`}>
                          {p.username}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 flex-shrink-0">
                        {isDisconnected && <span className="text-[9px] text-amber-400">reconnecting</span>}
                        {isMe && <span className="text-[10px] text-cyan-accent">You</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={onLeaveRoom}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium text-rose-400 bg-navy-800 hover:bg-navy-750 border border-navy-700 transition flex-shrink-0 mt-3"
            >
              <LogOut size={14} />
              <span>Leave Room</span>
            </button>
          </div>

          <div className="flex-1" onClick={() => setIsMobileMembersOpen(false)} />
        </div>
      )}

      {/* ================= MAIN CHAT AREA ================= */}
      <main className="flex-1 flex flex-col h-full min-h-0 min-w-0 bg-navy-950 overflow-hidden">
        {/* Chat Header */}
        <header className="min-h-[3.25rem] py-2.5 px-3 sm:px-4 md:px-6 border-b border-navy-800 bg-navy-900/80 backdrop-blur-sm flex items-center justify-between flex-shrink-0 gap-2 w-full z-10">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            {/* Mobile toggle button */}
            <button
              type="button"
              id="mobile-members-toggle"
              onClick={() => setIsMobileMembersOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white bg-navy-800 hover:bg-navy-750 border border-navy-700 flex items-center gap-1.5 text-xs flex-shrink-0 transition active:scale-95"
              title="View participants"
              aria-label="View participants"
            >
              <Users size={15} />
              <span className="text-[11px] font-medium">{onlineCount}</span>
            </button>

            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs sm:text-sm font-semibold text-white truncate max-w-[140px] sm:max-w-[220px] md:max-w-none">
                  {roomCode}
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-accent flex-shrink-0"></span>
                <span className="text-[11px] sm:text-xs text-slate-400 font-normal truncate">
                  {onlineCount} online
                </span>
              </div>
            </div>
          </div>

          {/* CLEAR CHAT Button */}
          <button
            type="button"
            id="clear-chat-btn"
            onClick={() => setIsClearModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider text-slate-400 hover:text-rose-400 bg-navy-800/80 hover:bg-navy-800 border border-navy-700 hover:border-rose-500/30 transition active:scale-95 flex-shrink-0"
          >
            <Trash2 size={13} />
            <span>Clear<span className="hidden sm:inline"> Chat</span></span>
          </button>
        </header>

        {/* Messages Scroll Area */}
        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 space-y-2.5 sm:space-y-3 min-h-0 w-full overscroll-contain"
        >
          {messages.length === 0 && !isOtherUserTyping ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs text-center select-none py-8">
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
                    className="flex items-center justify-center my-2 sm:my-3 select-none"
                  >
                    <div className="text-[10px] sm:text-[11px] text-slate-400 bg-navy-900/90 border border-navy-800 px-3 py-1 rounded-full flex items-center gap-2 max-w-[90%] text-center">
                      <span className="truncate">{msg.text}</span>
                      <span className="text-[9px] text-slate-500 flex-shrink-0">
                        {formatTimestamp(msg.timestamp)}
                      </span>
                    </div>
                  </div>
                );
              }

              const isMe = (sessionId && msg.sessionId === sessionId) || (currentSocketId && msg.senderId === currentSocketId);

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
                    className={`px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed max-w-[88%] sm:max-w-[80%] md:max-w-[70%] break-words select-text ${
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

          {/* Minimal Real-Time Typing Indicator [...] */}
          {isOtherUserTyping && (
            <div
              id="typing-indicator"
              className="flex flex-col items-start select-none transition-all duration-200"
              aria-label="Another participant is typing"
            >
              <div className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl rounded-tl-xs bg-navy-850 text-slate-100 border border-navy-750 shadow-xs">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          )}
        </div>

        {/* Message Input Bottom Area */}
        <div className="p-2.5 sm:p-3 md:p-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] border-t border-navy-800 bg-navy-900/60 flex-shrink-0 w-full">
          <form
            onSubmit={handleSend}
            className="flex items-center gap-2 max-w-4xl mx-auto w-full"
          >
            <input
              ref={inputRef}
              type="text"
              id="message-input"
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              placeholder="Type a message..."
              autoComplete="off"
              className="flex-1 min-w-0 bg-navy-900 text-slate-100 placeholder-slate-500 text-[16px] sm:text-sm px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-navy-700 focus:border-cyan-accent focus:outline-none focus:ring-1 focus:ring-cyan-accent/30 transition select-text"
            />
            <button
              type="submit"
              id="send-message-btn"
              tabIndex={-1}
              aria-disabled={!inputText.trim()}
              onPointerDown={(e) => {
                const isFocused =
                  isInputFocusedRef.current || document.activeElement === inputRef.current;
                if (isFocused) {
                  wasFocusedBeforeSendRef.current = true;
                  isSendingRef.current = true;
                  e.preventDefault();
                }
              }}
              onMouseDown={(e) => {
                const isFocused =
                  isInputFocusedRef.current || document.activeElement === inputRef.current;
                if (isFocused) {
                  wasFocusedBeforeSendRef.current = true;
                  isSendingRef.current = true;
                  e.preventDefault();
                }
              }}
              className={`bg-cyan-accent text-navy-950 p-2 sm:p-2.5 rounded-xl transition flex items-center justify-center flex-shrink-0 shadow-xs ${
                !inputText.trim()
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-cyan-bright active:scale-95'
              }`}
              title="Send message"
            >
              <Send size={16} className="sm:w-[18px] sm:h-[18px]" />
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
