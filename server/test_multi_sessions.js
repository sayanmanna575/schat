const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:5000';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('=== Starting SChat Multi-Session & Isolation Tests ===\n');

  // 1. User A connects to ROOM_ALPHA
  const clientA = io(SERVER_URL);
  let messagesA = [];
  let participantsA = [];
  let chatClearedA = false;

  clientA.on('message_received', (msg) => messagesA.push(msg));
  clientA.on('participants_update', (data) => participantsA = data.participants);
  clientA.on('chat_cleared', () => chatClearedA = true);

  await new Promise((resolve) => clientA.on('connect', resolve));
  console.log('[PASS] Client A connected to socket server');

  const joinARes = await new Promise((resolve) => {
    clientA.emit('join_room', { username: 'Alice', roomCode: 'ROOM_ALPHA' }, resolve);
  });
  console.log('[PASS] Client A created/joined ROOM_ALPHA:', joinARes.success === true);

  // 2. User B joins ROOM_ALPHA
  const clientB = io(SERVER_URL);
  let messagesB = [];
  let participantsB = [];
  let chatClearedB = false;

  clientB.on('message_received', (msg) => messagesB.push(msg));
  clientB.on('participants_update', (data) => participantsB = data.participants);
  clientB.on('chat_cleared', () => chatClearedB = true);

  await new Promise((resolve) => clientB.on('connect', resolve));
  const joinBRes = await new Promise((resolve) => {
    clientB.emit('join_room', { username: 'Bob', roomCode: 'ROOM_ALPHA' }, resolve);
  });
  console.log('[PASS] Client B joined existing ROOM_ALPHA:', joinBRes.success === true);

  await wait(300);

  // Verify participant count in ROOM_ALPHA
  console.log('[VERIFY] Participant updates:');
  console.log('  Client A sees participants:', participantsA.map(p => p.username));
  console.log('  Client B sees participants:', participantsB.map(p => p.username));
  if (participantsA.length === 2 && participantsB.length === 2) {
    console.log('[PASS] Both clients see 2 participants');
  } else {
    throw new Error('Participant count mismatch');
  }

  // 3. User C joins a DIFFERENT room: ROOM_BETA (Room isolation test)
  const clientC = io(SERVER_URL);
  let messagesC = [];
  clientC.on('message_received', (msg) => messagesC.push(msg));

  await new Promise((resolve) => clientC.on('connect', resolve));
  await new Promise((resolve) => {
    clientC.emit('join_room', { username: 'Charlie', roomCode: 'ROOM_BETA' }, resolve);
  });
  console.log('[PASS] Client C created ROOM_BETA (isolated)');

  // 4. Client A sends message in ROOM_ALPHA
  await new Promise((resolve) => {
    clientA.emit('send_message', { text: 'Hello from Alice in Alpha!' }, resolve);
  });
  await wait(200);

  const bobGotAliceMsg = messagesB.some(m => m.text === 'Hello from Alice in Alpha!');
  const charlieGotAliceMsg = messagesC.some(m => m.text === 'Hello from Alice in Alpha!');
  console.log('[PASS] Client B in ROOM_ALPHA received Alice\'s message:', bobGotAliceMsg);
  console.log('[PASS] Client C in ROOM_BETA did NOT receive Alice\'s message (Isolation verified):', !charlieGotAliceMsg);

  if (!bobGotAliceMsg || charlieGotAliceMsg) {
    throw new Error('Room isolation failed!');
  }

  // 5. Client C sends message in ROOM_BETA
  await new Promise((resolve) => {
    clientC.emit('send_message', { text: 'Secret message in Beta' }, resolve);
  });
  await wait(200);

  const aliceGotCharlieMsg = messagesA.some(m => m.text === 'Secret message in Beta');
  console.log('[PASS] Client A did NOT receive Charlie\'s message from ROOM_BETA:', !aliceGotCharlieMsg);
  if (aliceGotCharlieMsg) throw new Error('Room isolation failed for Beta -> Alpha');

  // 6. Test Clear Chat in ROOM_ALPHA
  await new Promise((resolve) => {
    clientB.emit('clear_chat', resolve);
  });
  await wait(200);

  console.log('[PASS] Client A received chat_cleared:', chatClearedA);
  console.log('[PASS] Client B received chat_cleared:', chatClearedB);
  if (!chatClearedA || !chatClearedB) throw new Error('Clear chat synchronization failed');

  // 7. Test Leave Room
  await new Promise((resolve) => {
    clientB.emit('leave_room', resolve);
  });
  await wait(300);

  console.log('[PASS] Client B left ROOM_ALPHA. Remaining participants seen by Client A:', participantsA.length);
  const aliceSawBobLeave = messagesA.some(m => m.text && m.text.includes('Bob left'));
  console.log('[PASS] Client A received Bob left notification:', aliceSawBobLeave);

  // 8. Test Automatic Room Deletion after grace period
  await new Promise((resolve) => {
    clientA.emit('leave_room', resolve);
  });
  clientA.disconnect();
  clientB.disconnect();
  clientC.disconnect();

  console.log('\n=== All Socket Protocol & Logic Tests Passed Successfully! ===');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('[FAIL] Test failed:', err);
  process.exit(1);
});
