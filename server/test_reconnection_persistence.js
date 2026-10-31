const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const path = require('path');

const PORT = 5005;
const SERVER_URL = `http://localhost:${PORT}`;
const GRACE_PERIOD_MS = 1500; // 1.5 seconds for test suite speed

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

async function runSuite() {
  console.log('====================================================');
  console.log('SChat Browser Disconnection, Reconnection & Room Persistence Test Suite');
  console.log('====================================================\n');

  // Spawn test server with custom port & fast grace period for test
  const serverProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: PORT.toString(),
      RECONNECTION_GRACE_PERIOD_MS: GRACE_PERIOD_MS.toString()
    },
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', (d) => {
    // console.log(`[SERVER]: ${d.toString().trim()}`);
  });
  serverProcess.stderr.on('data', (d) => {
    console.error(`[SERVER ERR]: ${d.toString().trim()}`);
  });

  // Wait for server to start
  await wait(1000);

  try {
    // -------------------------------------------------------------------
    // TEST 1: Reconnection within Grace Period
    // -------------------------------------------------------------------
    console.log('--- TEST 1: Reconnection within Grace Period ---');
    const client1A = createClient();
    let client1AMessages = [];
    client1A.on('message_received', (m) => client1AMessages.push(m));

    await new Promise((resolve) => client1A.on('connect', resolve));
    const join1ARes = await new Promise((resolve) => {
      client1A.emit('join_room', { username: 'Alice', roomCode: 'ROOM_RECONNECT' }, resolve);
    });

    console.log('  1.1 Alice joined room ROOM_RECONNECT:', join1ARes.success);
    const aliceSessionId = join1ARes.sessionId;
    if (!aliceSessionId) throw new Error('Expected Alice to receive a sessionId');

    // Alice sends a message
    await new Promise((resolve) => {
      client1A.emit('send_message', { text: 'Message from Alice before disconnect' }, resolve);
    });
    await wait(200);

    // Simulate browser disconnection (tab close / network drop)
    client1A.disconnect();
    console.log('  1.2 Alice disconnected (simulating browser close/refresh)');
    await wait(400); // 400ms is well within 1500ms grace period

    // Alice reconnects with new socket using existing sessionId
    const client1AReconnected = createClient();
    await new Promise((resolve) => client1AReconnected.on('connect', resolve));

    let reconnectedMessages = [];
    client1AReconnected.on('message_received', (m) => reconnectedMessages.push(m));

    const reconnectRes = await new Promise((resolve) => {
      client1AReconnected.emit(
        'join_room',
        { username: 'Alice', roomCode: 'ROOM_RECONNECT', sessionId: aliceSessionId },
        resolve
      );
    });

    console.log('  1.3 Alice reconnected response success:', reconnectRes.success);
    console.log('  1.4 Reconnected flag is true:', reconnectRes.reconnected === true);
    console.log('  1.5 Session ID preserved:', reconnectRes.sessionId === aliceSessionId);
    console.log('  1.6 Conversation history preserved. Messages count:', reconnectRes.messages.length);

    if (!reconnectRes.reconnected || reconnectRes.sessionId !== aliceSessionId) {
      throw new Error('Reconnection within grace period failed to restore existing session');
    }

    const hadUserMsg = reconnectRes.messages.some((m) => m.text === 'Message from Alice before disconnect');
    if (!hadUserMsg) {
      throw new Error('Previous conversation messages were not restored upon reconnection');
    }

    // Verify no duplicate participant entries
    const aliceEntries = reconnectRes.participants.filter((p) => p.sessionId === aliceSessionId);
    if (aliceEntries.length !== 1) {
      throw new Error(`Expected exactly 1 participant entry for Alice, found: ${aliceEntries.length}`);
    }
    console.log('  1.7 No duplicate participant entry: verified (1 entry)');

    // Verify participant status is 'connected'
    if (aliceEntries[0].status !== 'connected') {
      throw new Error(`Expected participant status 'connected', got: ${aliceEntries[0].status}`);
    }
    console.log('  1.8 Participant status restored to connected');

    // Verify no unnecessary leave or join notification was broadcast
    const unnecessaryNotifications = reconnectedMessages.filter(
      (m) => m.type === 'system' && (m.text.includes('Alice joined') || m.text.includes('Alice left'))
    );
    if (unnecessaryNotifications.length > 0) {
      throw new Error('Unnecessary notification broadcast during reconnection');
    }
    console.log('  1.9 No unnecessary join/leave notifications broadcast on reconnect');
    console.log('[PASS] TEST 1: Reconnection within Grace Period succeeded\n');

    client1AReconnected.disconnect();
    await wait(GRACE_PERIOD_MS + 200);

    // -------------------------------------------------------------------
    // TEST 2: Permanent Disconnection After Grace Period
    // -------------------------------------------------------------------
    console.log('--- TEST 2: Permanent Disconnection After Grace Period ---');
    const client2Bob = createClient();
    const client2Charlie = createClient();
    let charlieMessages = [];
    let charlieParticipants = [];

    await new Promise((resolve) => client2Bob.on('connect', resolve));
    await new Promise((resolve) => client2Charlie.on('connect', resolve));

    client2Charlie.on('message_received', (m) => charlieMessages.push(m));
    client2Charlie.on('participants_update', (d) => (charlieParticipants = d.participants));

    const bobJoin = await new Promise((resolve) => {
      client2Bob.emit('join_room', { username: 'Bob', roomCode: 'ROOM_EXPIRY' }, resolve);
    });
    const charlieJoin = await new Promise((resolve) => {
      client2Charlie.emit('join_room', { username: 'Charlie', roomCode: 'ROOM_EXPIRY' }, resolve);
    });

    console.log('  2.1 Bob and Charlie joined ROOM_EXPIRY');
    const bobSessionId = bobJoin.sessionId;

    // Bob disconnects
    client2Bob.disconnect();
    console.log(`  2.2 Bob disconnected. Waiting ${GRACE_PERIOD_MS + 300}ms for grace period to expire...`);
    await wait(GRACE_PERIOD_MS + 300);

    // Verify Bob is permanently removed from participant list seen by Charlie
    const bobStillInList = charlieParticipants.some((p) => p.sessionId === bobSessionId);
    console.log('  2.3 Bob permanently removed from participant list:', !bobStillInList);
    if (bobStillInList) {
      throw new Error('Bob was not permanently removed after grace period expired');
    }

    // Verify Charlie received the "[Username] left the chat" notification
    const bobLeftMessages = charlieMessages.filter((m) => m.text && m.text.includes('Bob left the chat'));
    console.log('  2.4 Charlie received "Bob left the chat" notification:', bobLeftMessages.length === 1);
    if (bobLeftMessages.length !== 1) {
      throw new Error(`Expected exactly 1 leave message, got ${bobLeftMessages.length}`);
    }

    // Verify expired session cannot reconnect
    const client2BobTryReconnect = createClient();
    await new Promise((resolve) => client2BobTryReconnect.on('connect', resolve));
    const expiredReconnectRes = await new Promise((resolve) => {
      client2BobTryReconnect.emit(
        'join_room',
        { username: 'Bob', roomCode: 'ROOM_EXPIRY', sessionId: bobSessionId },
        resolve
      );
    });

    console.log('  2.5 Expired session rejected by server:', expiredReconnectRes.success === false && expiredReconnectRes.sessionExpired === true);
    if (expiredReconnectRes.success !== false) {
      throw new Error('Server accepted an expired session ID!');
    }
    client2BobTryReconnect.disconnect();
    console.log('[PASS] TEST 2: Permanent Disconnection After Grace Period succeeded\n');

    // -------------------------------------------------------------------
    // TEST 3: Room Persistence Rules
    // -------------------------------------------------------------------
    console.log('--- TEST 3: Room Persistence Rules ---');
    // Charlie is still in ROOM_EXPIRY
    // Verify Charlie can send messages and the room ID remains the same
    await new Promise((resolve) => {
      client2Charlie.emit('send_message', { text: 'Charlie remains in room' }, resolve);
    });
    await wait(200);

    // Another person (Dave) joins ROOM_EXPIRY
    const client3Dave = createClient();
    await new Promise((resolve) => client3Dave.on('connect', resolve));

    const daveJoinRes = await new Promise((resolve) => {
      client3Dave.emit('join_room', { username: 'Dave', roomCode: 'ROOM_EXPIRY' }, resolve);
    });

    console.log('  3.1 Dave joined existing ROOM_EXPIRY:', daveJoinRes.success);
    console.log('  3.2 Room ID preserved unchanged:', daveJoinRes.roomCode === 'ROOM_EXPIRY');

    // Dave should see the previous messages in ROOM_EXPIRY
    const daveSawCharlieMsg = daveJoinRes.messages.some((m) => m.text === 'Charlie remains in room');
    console.log('  3.3 Dave accessed existing conversation history:', daveSawCharlieMsg);
    if (!daveSawCharlieMsg) {
      throw new Error('Dave did not receive existing room conversation history');
    }
    console.log('[PASS] TEST 3: Room Persistence Rules succeeded\n');

    client2Charlie.disconnect();
    client3Dave.disconnect();
    await wait(GRACE_PERIOD_MS + 200);

    // -------------------------------------------------------------------
    // TEST 4: Room Deletion and Cleanup When Last Participant Leaves
    // -------------------------------------------------------------------
    console.log('--- TEST 4: Room Deletion and Cleanup When Last Participant Leaves ---');
    const client4Solo = createClient();
    await new Promise((resolve) => client4Solo.on('connect', resolve));

    await new Promise((resolve) => {
      client4Solo.emit('join_room', { username: 'Solo', roomCode: 'ROOM_CLEANUP' }, resolve);
    });
    await new Promise((resolve) => {
      client4Solo.emit('send_message', { text: 'Old message that must not leak' }, resolve);
    });
    await wait(200);

    // Solo disconnects (starts grace period)
    client4Solo.disconnect();
    console.log(`  4.1 Solo disconnected from ROOM_CLEANUP. Waiting ${GRACE_PERIOD_MS + 300}ms for grace period...`);
    await wait(GRACE_PERIOD_MS + 300);

    // Room should now be completely deleted.
    // Someone connects to ROOM_CLEANUP anew.
    const client4New = createClient();
    await new Promise((resolve) => client4New.on('connect', resolve));
    const newJoinRes = await new Promise((resolve) => {
      client4New.emit('join_room', { username: 'Stranger', roomCode: 'ROOM_CLEANUP' }, resolve);
    });

    console.log('  4.2 Stranger joined ROOM_CLEANUP after deletion');
    const leakedOldMessages = newJoinRes.messages.filter((m) => m.text === 'Old message that must not leak');
    console.log('  4.3 Old messages permanently cleared (none restored):', leakedOldMessages.length === 0);
    if (leakedOldMessages.length > 0) {
      throw new Error('Old room messages were restored after room deletion!');
    }
    console.log('[PASS] TEST 4: Room Deletion and Cleanup succeeded\n');

    client4New.disconnect();
    await wait(GRACE_PERIOD_MS + 200);

    // -------------------------------------------------------------------
    // TEST 5: Explicit Leave
    // -------------------------------------------------------------------
    console.log('--- TEST 5: Explicit Leave Room ---');
    const client5A = createClient();
    const client5B = createClient();
    let client5BMessages = [];
    await new Promise((resolve) => client5A.on('connect', resolve));
    await new Promise((resolve) => client5B.on('connect', resolve));
    client5B.on('message_received', (m) => client5BMessages.push(m));

    await new Promise((resolve) => {
      client5A.emit('join_room', { username: 'Leaver', roomCode: 'ROOM_EXPLICIT' }, resolve);
    });
    await new Promise((resolve) => {
      client5B.emit('join_room', { username: 'Observer', roomCode: 'ROOM_EXPLICIT' }, resolve);
    });

    // Leaver explicitly calls leave_room
    const leaveRes = await new Promise((resolve) => {
      client5A.emit('leave_room', resolve);
    });
    console.log('  5.1 Leaver emitted leave_room:', leaveRes.success);
    await wait(200);

    const leaverLeaveMsg = client5BMessages.filter((m) => m.text && m.text.includes('Leaver left the chat'));
    console.log('  5.2 Observer received "Leaver left the chat":', leaverLeaveMsg.length === 1);
    if (leaverLeaveMsg.length !== 1) {
      throw new Error('Explicit leave notification not received');
    }
    client5A.disconnect();
    client5B.disconnect();
    await wait(GRACE_PERIOD_MS + 200);
    console.log('[PASS] TEST 5: Explicit Leave Room succeeded\n');

    // -------------------------------------------------------------------
    // TEST 6: Multiple Participants with Identical Usernames
    // -------------------------------------------------------------------
    console.log('--- TEST 6: Multiple Participants with Identical Usernames ---');
    const client6Clone1 = createClient();
    const client6Clone2 = createClient();

    await new Promise((resolve) => client6Clone1.on('connect', resolve));
    await new Promise((resolve) => client6Clone2.on('connect', resolve));

    let clone2Participants = [];
    client6Clone2.on('participants_update', (d) => (clone2Participants = d.participants));

    const joinClone1 = await new Promise((resolve) => {
      client6Clone1.emit('join_room', { username: 'SameName', roomCode: 'ROOM_CLONES' }, resolve);
    });
    const joinClone2 = await new Promise((resolve) => {
      client6Clone2.emit('join_room', { username: 'SameName', roomCode: 'ROOM_CLONES' }, resolve);
    });

    console.log('  6.1 Two users joined with username "SameName"');
    console.log('  6.2 Clone 1 session ID:', joinClone1.sessionId);
    console.log('  6.3 Clone 2 session ID:', joinClone2.sessionId);

    if (joinClone1.sessionId === joinClone2.sessionId) {
      throw new Error('Identical usernames were assigned identical session IDs!');
    }
    await wait(200);

    console.log('  6.4 Total participants seen:', clone2Participants.length);
    if (clone2Participants.length !== 2) {
      throw new Error(`Expected 2 participants with same username, got: ${clone2Participants.length}`);
    }

    // Disconnect Clone 1 only
    client6Clone1.disconnect();
    console.log('  6.5 Clone 1 disconnected');
    await wait(300);

    const clone1Status = clone2Participants.find((p) => p.sessionId === joinClone1.sessionId)?.status;
    const clone2Status = clone2Participants.find((p) => p.sessionId === joinClone2.sessionId)?.status;
    console.log('  6.6 Clone 1 status:', clone1Status, '| Clone 2 status:', clone2Status);

    if (clone1Status !== 'disconnected' || clone2Status !== 'connected') {
      throw new Error('One participant disconnect erroneously affected other participant with same username');
    }

    // Clone 1 reconnects
    const client6Clone1Reconnected = createClient();
    await new Promise((resolve) => client6Clone1Reconnected.on('connect', resolve));
    const clone1ReconnectRes = await new Promise((resolve) => {
      client6Clone1Reconnected.emit(
        'join_room',
        { username: 'SameName', roomCode: 'ROOM_CLONES', sessionId: joinClone1.sessionId },
        resolve
      );
    });

    console.log('  6.7 Clone 1 reconnected successfully:', clone1ReconnectRes.reconnected);
    await wait(200);

    const reconnectedClone1Status = clone2Participants.find((p) => p.sessionId === joinClone1.sessionId)?.status;
    if (reconnectedClone1Status !== 'connected') {
      throw new Error('Clone 1 failed to restore status to connected');
    }
    console.log('  6.8 Both participants are back to connected');
    console.log('[PASS] TEST 6: Multiple Participants with Identical Usernames succeeded\n');

    client6Clone1Reconnected.disconnect();
    client6Clone2.disconnect();
    await wait(GRACE_PERIOD_MS + 200);

    // -------------------------------------------------------------------
    // TEST 7: Simultaneous Disconnection & Race Condition Guard
    // -------------------------------------------------------------------
    console.log('--- TEST 7: Fast Reconnect Race Condition Guard ---');
    const client7Old = createClient();
    await new Promise((resolve) => client7Old.on('connect', resolve));

    const join7Res = await new Promise((resolve) => {
      client7Old.emit('join_room', { username: 'Racer', roomCode: 'ROOM_RACE' }, resolve);
    });
    const racerSessionId = join7Res.sessionId;

    // Simulate fast page reload: New socket connects and claims session BEFORE old socket disconnect fires
    const client7New = createClient();
    await new Promise((resolve) => client7New.on('connect', resolve));

    let raceParticipants = [];
    client7New.on('participants_update', (d) => (raceParticipants = d.participants));

    const raceReconnectRes = await new Promise((resolve) => {
      client7New.emit(
        'join_room',
        { username: 'Racer', roomCode: 'ROOM_RACE', sessionId: racerSessionId },
        resolve
      );
    });
    console.log('  7.1 New socket reconnected before old socket disconnect:', raceReconnectRes.success);

    // Now old socket disconnects
    client7Old.disconnect();
    console.log('  7.2 Stale old socket disconnected');
    await wait(500);

    // Participant should still be 'connected' (NOT marked as disconnected)
    const racerInList = raceParticipants.find((p) => p.sessionId === racerSessionId);
    console.log('  7.3 Racer status remains connected:', racerInList?.status === 'connected');
    if (racerInList?.status !== 'connected') {
      throw new Error('Stale socket disconnect erroneously marked active session as disconnected!');
    }

    client7New.disconnect();
    console.log('[PASS] TEST 7: Race Condition Guard succeeded\n');

    console.log('====================================================');
    console.log('ALL 7 PERSISTENCE & RECONNECTION TESTS PASSED PERFECTLY!');
    console.log('====================================================');
  } finally {
    serverProcess.kill();
  }
}

runSuite().catch((err) => {
  console.error('\n[FAIL] Test suite failed:', err);
  process.exit(1);
});
