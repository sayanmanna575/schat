const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const path = require('path');

const PORT = 5006;
const SERVER_URL = `http://localhost:${PORT}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClient() {
  return io(SERVER_URL, {
    forceNew: true,
    reconnection: false,
    transports: ['websocket']
  });
}

async function runTypingTests() {
  console.log('====================================================');
  console.log('SChat Minimal Real-Time Typing Indicator Test Suite');
  console.log('====================================================\n');

  // Spawn isolated test server
  const serverProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: PORT.toString(),
      RECONNECTION_GRACE_PERIOD_MS: '5000'
    },
    stdio: 'pipe'
  });

  serverProcess.stderr.on('data', (d) => {
    console.error(`[SERVER ERR]: ${d.toString().trim()}`);
  });

  // Wait for server to start
  await wait(1000);

  try {
    // Test 1: Single Participant Typing & Broadcast Scope
    console.log('--- TEST 1: Typing Indicator Broadcast & Scope ---');
    const clientA = createClient();
    const clientB = createClient();
    const clientOther = createClient();

    await new Promise((r) => clientA.on('connect', r));
    await new Promise((r) => clientB.on('connect', r));
    await new Promise((r) => clientOther.on('connect', r));

    let typingEventsA = [];
    let typingEventsB = [];
    let typingEventsOther = [];

    clientA.on('typing_status', (d) => typingEventsA.push(d));
    clientB.on('typing_status', (d) => typingEventsB.push(d));
    clientOther.on('typing_status', (d) => typingEventsOther.push(d));

    await new Promise((r) => clientA.emit('join_room', { username: 'Alice', roomCode: 'ROOM_TYPE_1' }, r));
    await new Promise((r) => clientB.emit('join_room', { username: 'Bob', roomCode: 'ROOM_TYPE_1' }, r));
    await new Promise((r) => clientOther.emit('join_room', { username: 'Charlie', roomCode: 'ROOM_OTHER' }, r));

    // Alice starts typing
    clientA.emit('typing_start');
    await wait(200);

    console.log('  1.1 Bob received isTyping: true:', typingEventsB.some((e) => e.isTyping === true));
    console.log('  1.2 Alice (sender) did NOT receive typing event:', typingEventsA.length === 0);
    console.log('  1.3 Charlie (in different room) did NOT receive typing event:', typingEventsOther.length === 0);

    if (!typingEventsB.some((e) => e.isTyping === true)) {
      throw new Error('Bob did not receive typing_status: true');
    }
    if (typingEventsA.length > 0) {
      throw new Error('Sender erroneously received typing event');
    }
    if (typingEventsOther.length > 0) {
      throw new Error('Room isolation failed for typing event');
    }

    // Alice stops typing (after 2s debounce simulation)
    clientA.emit('typing_stop');
    await wait(200);

    console.log('  1.4 Bob received isTyping: false after typing_stop:', typingEventsB[typingEventsB.length - 1]?.isTyping === false);
    if (typingEventsB[typingEventsB.length - 1]?.isTyping !== false) {
      throw new Error('Bob did not receive typing_status: false');
    }
    console.log('[PASS] TEST 1: Typing Indicator Broadcast & Scope passed\n');

    // Test 2: Typing clears when message is sent
    console.log('--- TEST 2: Typing Clears Immediately When Message Sent ---');
    typingEventsB = [];
    clientA.emit('typing_start');
    await wait(200);
    console.log('  2.1 Bob received typing start:', typingEventsB.some((e) => e.isTyping === true));

    // Alice sends a message
    await new Promise((r) => clientA.emit('send_message', { text: 'Hello Bob!' }, r));
    await wait(200);

    console.log('  2.2 Bob received typing stop upon send_message:', typingEventsB[typingEventsB.length - 1]?.isTyping === false);
    if (typingEventsB[typingEventsB.length - 1]?.isTyping !== false) {
      throw new Error('Typing indicator did not clear upon message send');
    }
    console.log('[PASS] TEST 2: Typing Clear on Message Sent passed\n');

    // Test 3: Typing clears on disconnect
    console.log('--- TEST 3: Typing Clears When Typer Disconnects ---');
    typingEventsB = [];
    clientA.emit('typing_start');
    await wait(200);
    console.log('  3.1 Bob received typing start:', typingEventsB.some((e) => e.isTyping === true));

    // Alice disconnects
    clientA.disconnect();
    await wait(300);

    console.log('  3.2 Bob received typing stop upon clientA disconnect:', typingEventsB[typingEventsB.length - 1]?.isTyping === false);
    if (typingEventsB[typingEventsB.length - 1]?.isTyping !== false) {
      throw new Error('Typing indicator did not clear upon disconnection');
    }
    console.log('[PASS] TEST 3: Typing Clear on Disconnect passed\n');

    clientB.disconnect();
    clientOther.disconnect();

    // Test 4: Multiple Participants Typing Concurrently
    console.log('--- TEST 4: Multiple Participants Typing Concurrently ---');
    const user1 = createClient();
    const user2 = createClient();
    const observer = createClient();

    await new Promise((r) => user1.on('connect', r));
    await new Promise((r) => user2.on('connect', r));
    await new Promise((r) => observer.on('connect', r));

    let observerTypingEvents = [];
    observer.on('typing_status', (d) => observerTypingEvents.push(d));

    await new Promise((r) => user1.emit('join_room', { username: 'User1', roomCode: 'ROOM_MULTI_TYPE' }, r));
    await new Promise((r) => user2.emit('join_room', { username: 'User2', roomCode: 'ROOM_MULTI_TYPE' }, r));
    await new Promise((r) => observer.emit('join_room', { username: 'Observer', roomCode: 'ROOM_MULTI_TYPE' }, r));

    // User1 starts typing
    user1.emit('typing_start');
    await wait(200);
    console.log('  4.1 Observer received isTyping: true from User1:', observerTypingEvents[observerTypingEvents.length - 1]?.isTyping === true);

    // User2 also starts typing (simultaneous)
    user2.emit('typing_start');
    await wait(200);
    // Indicator remains active without sending conflicting false
    console.log('  4.2 Observer typing state remains true with multiple typers:', observerTypingEvents[observerTypingEvents.length - 1]?.isTyping === true);

    // User1 stops typing, but User2 is STILL typing
    user1.emit('typing_stop');
    await wait(200);
    console.log('  4.3 Observer typing state STILL true because User2 is still typing:', observerTypingEvents[observerTypingEvents.length - 1]?.isTyping === true);

    // Now User2 stops typing
    user2.emit('typing_stop');
    await wait(200);
    console.log('  4.4 Observer received isTyping: false when last user stops:', observerTypingEvents[observerTypingEvents.length - 1]?.isTyping === false);

    if (observerTypingEvents[observerTypingEvents.length - 1]?.isTyping !== false) {
      throw new Error('Indicator was not hidden after all participants stopped typing');
    }
    console.log('[PASS] TEST 4: Multiple Participants Typing passed\n');

    // Test 5: Verify No Typing Data Stored in Messages
    console.log('--- TEST 5: Verify No Typing Message Persistence ---');
    let observerMessages = [];
    observer.on('message_received', (m) => observerMessages.push(m));

    user1.emit('typing_start');
    await wait(200);
    user1.emit('typing_stop');
    await wait(200);

    const typingAsMessages = observerMessages.filter((m) => m.text && (m.text.includes('typing') || m.text.includes('...')));
    console.log('  5.1 Typing events never stored as chat messages:', typingAsMessages.length === 0);
    if (typingAsMessages.length > 0) {
      throw new Error('Typing status was erroneously stored as a chat message!');
    }
    console.log('[PASS] TEST 5: No Typing Persistence passed\n');

    user1.disconnect();
    user2.disconnect();
    observer.disconnect();

    console.log('====================================================');
    console.log('ALL TYPING INDICATOR TESTS PASSED PERFECTLY!');
    console.log('====================================================');
  } finally {
    serverProcess.kill('SIGTERM');
  }
}

runTypingTests().catch((err) => {
  console.error('\n[FAIL] Typing indicator test failed:', err);
  process.exit(1);
});
