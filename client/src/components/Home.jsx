import React, { useState } from 'react';

export default function Home({ onConnect, isConnecting, error }) {
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim() || !roomCode.trim()) return;
    onConnect(username.trim(), roomCode.trim());
  };

  return (
    <div className="h-full min-h-full w-full flex items-center justify-center bg-navy-950 px-4 overflow-y-auto">
      <div className="w-full max-w-sm flex flex-col items-center">
        {/* Title */}
        <h1 className="text-3xl font-bold tracking-tight text-white mb-8 select-none">
          SChat<span className="text-cyan-accent">.</span>
        </h1>

        {/* Connection Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-3.5">
          <div>
            <input
              type="text"
              id="username-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              maxLength={24}
              required
              autoFocus
              className="w-full bg-navy-900 text-slate-100 placeholder-slate-500 text-sm px-4 py-3 rounded-lg border border-navy-700 focus:border-cyan-accent focus:outline-none focus:ring-1 focus:ring-cyan-accent/30 transition"
            />
          </div>

          <div>
            <input
              type="text"
              id="roomcode-input"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder="Room Code"
              maxLength={24}
              required
              className="w-full bg-navy-900 text-slate-100 placeholder-slate-500 text-sm px-4 py-3 rounded-lg border border-navy-700 focus:border-cyan-accent focus:outline-none focus:ring-1 focus:ring-cyan-accent/30 transition"
            />
          </div>

          {error && (
            <div className="text-xs text-rose-400 text-center py-1">
              {error}
            </div>
          )}

          <button
            type="submit"
            id="connect-btn"
            disabled={isConnecting || !username.trim() || !roomCode.trim()}
            className="w-full bg-cyan-accent hover:bg-cyan-bright disabled:opacity-50 disabled:cursor-not-allowed text-navy-950 font-semibold text-sm py-3 px-4 rounded-lg tracking-wider uppercase transition shadow-sm active:scale-[0.99]"
          >
            {isConnecting ? 'Connecting...' : '[ CONNECT ]'}
          </button>
        </form>
      </div>
    </div>
  );
}
