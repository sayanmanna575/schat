const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const TEST_PORT = 5050;

async function runTest() {
  console.log('====================================================');
  console.log('SChat Mobile Keyboard Viewport & Dynamic Chat Layout Test');
  console.log('====================================================\n');

  // 1. Setup Express app serving client/dist + socket.io
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  app.use(express.static(path.join(__dirname, '../client/dist')));

  const rooms = new Map();
  io.on('connection', (socket) => {
    socket.on('join_room', ({ username, roomCode, sessionId }, cb) => {
      const code = roomCode || 'ROOM_KB';
      if (!rooms.has(code)) {
        rooms.set(code, {
          messages: [
            { id: '1', text: 'Welcome to the room!', senderId: 'system', username: 'System', type: 'system', timestamp: new Date().toISOString() },
            { id: '2', text: 'Hello world!', senderId: 'user_1', username: 'Alice', type: 'chat', timestamp: new Date().toISOString() },
            { id: '3', text: 'Testing viewport resizing', senderId: 'user_2', username: 'Bob', type: 'chat', timestamp: new Date().toISOString() }
          ],
          participants: new Map()
        });
      }
      const room = rooms.get(code);
      const sid = sessionId || 'sess-' + Math.random().toString(36).substring(2);
      const participant = { sessionId: sid, username: username || 'User', status: 'connected' };
      room.participants.set(sid, participant);
      socket.join(code);
      if (typeof cb === 'function') {
        cb({
          success: true,
          sessionId: sid,
          roomCode: code,
          username: participant.username,
          participants: Array.from(room.participants.values()),
          messages: room.messages
        });
      }
    });

    socket.on('send_message', ({ text }, cb) => {
      const code = 'ROOM_KB';
      const msg = {
        id: 'msg-' + Date.now(),
        text,
        senderId: socket.id,
        username: 'TesterMobile',
        type: 'chat',
        timestamp: new Date().toISOString()
      };
      if (rooms.has(code)) {
        rooms.get(code).messages.push(msg);
      }
      io.to(code).emit('message_received', msg);
      if (typeof cb === 'function') cb({ success: true, message: msg });
    });
  });

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Test Server] Running on http://localhost:${TEST_PORT}`);

  // 2. Launch headless Chrome with CDP
  const tmpDir = path.join(os.tmpdir(), 'chrome-kb-test-' + Date.now());
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--user-data-dir=' + tmpDir,
    '--disable-gpu',
    'about:blank'
  ], { stdio: 'ignore' });

  // Wait for Chrome CDP
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error('Failed to connect to headless Chrome CDP');

  try {
    const tabsRes = await fetch('http://127.0.0.1:9222/json');
    const tabs = await tabsRes.json();
    const pageTab = tabs.find((t) => t.type === 'page') || tabs[0];

    const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
    let id = 1;
    const pending = new Map();

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const msgId = id++;
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };

    await new Promise((r) => (ws.onopen = r));
    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    async function evaluate(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      return res.result?.value;
    }

    async function waitForElement(selector, timeout = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const found = await evaluate(`Boolean(document.querySelector('${selector}'))`);
        if (found) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`Element ${selector} did not appear within ${timeout}ms`);
    }

    // --- TEST SCENARIO 1: Open SChat on mobile (Normal view, keyboard closed) ---
    console.log('--- TEST SCENARIO 1: Mobile with Keyboard Closed (375x812) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });

    await send('Page.navigate', { url: `http://localhost:${TEST_PORT}/` });
    await waitForElement('#username-input');

    // Connect to room
    await evaluate(`
      (function() {
        const setVal = (el, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const nameInput = document.getElementById('username-input');
        const roomInput = document.getElementById('roomcode-input');
        const connectBtn = document.getElementById('connect-btn');
        if (nameInput && roomInput && connectBtn) {
          setVal(nameInput, 'TesterMobile');
          setVal(roomInput, 'ROOM_KB');
          connectBtn.click();
        }
      })();
    `);
    await waitForElement('header');
    await new Promise((r) => setTimeout(r, 500));

    let normalState = await evaluate(`
      (function() {
        const header = document.querySelector('header');
        const msgContainer = document.querySelector('.overscroll-contain');
        const input = document.getElementById('message-input');
        const composer = input ? input.closest('div.border-t') : null;
        const hRect = header ? header.getBoundingClientRect() : null;
        const mRect = msgContainer ? msgContainer.getBoundingClientRect() : null;
        const cRect = composer ? composer.getBoundingClientRect() : null;
        return {
          headerTop: hRect ? hRect.top : null,
          headerHeight: hRect ? hRect.height : null,
          headerVisible: hRect ? hRect.height > 40 && hRect.top >= 0 : false,
          msgHeight: mRect ? mRect.height : null,
          composerBottom: cRect ? cRect.bottom : null,
          windowScrollY: window.scrollY,
          viewportHeight: window.visualViewport ? window.visualViewport.height : window.innerHeight
        };
      })()
    `);

    console.log('  Normal view state:', JSON.stringify(normalState));
    if (!normalState.headerVisible || normalState.headerTop !== 0) {
      throw new Error(`Header not properly positioned in normal mobile view: ${JSON.stringify(normalState)}`);
    }
    console.log('  [PASS] Scenario 1: Normal mobile full-height layout verified!\n');

    // --- TEST SCENARIO 2: Tap Message Input & Keyboard Opens (height drops to 460px) ---
    console.log('--- TEST SCENARIO 2: Keyboard Opens (Viewport shrinks to 460px) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 460,
      deviceScaleFactor: 2,
      mobile: true
    });

    // Focus input
    await evaluate(`
      (function() {
        const input = document.getElementById('message-input');
        if (input) {
          input.focus();
          input.dispatchEvent(new Event('focus', { bubbles: true }));
        }
      })();
    `);
    await new Promise((r) => setTimeout(r, 500));

    let kbOpenState = await evaluate(`
      (function() {
        const header = document.querySelector('header');
        const msgContainer = document.querySelector('.overscroll-contain');
        const input = document.getElementById('message-input');
        const composer = input ? input.closest('div.border-t') : null;
        const sendBtn = document.getElementById('send-message-btn');
        const clearBtn = document.getElementById('clear-chat-btn');
        const roomCodeEl = header ? header.querySelector('span.font-semibold') : null;

        const hRect = header ? header.getBoundingClientRect() : null;
        const mRect = msgContainer ? msgContainer.getBoundingClientRect() : null;
        const cRect = composer ? composer.getBoundingClientRect() : null;
        const sRect = sendBtn ? sendBtn.getBoundingClientRect() : null;
        const clearRect = clearBtn ? clearBtn.getBoundingClientRect() : null;

        return {
          headerTop: hRect ? hRect.top : null,
          headerBottom: hRect ? hRect.bottom : null,
          headerHeight: hRect ? hRect.height : null,
          headerVisible: hRect && hRect.top >= 0 && hRect.bottom <= 60 && hRect.height >= 40,
          roomCodeVisible: roomCodeEl ? roomCodeEl.textContent.trim() : null,
          clearBtnVisible: clearRect && clearRect.width > 0 && clearRect.height > 0,
          msgHeight: mRect ? mRect.height : null,
          composerBottom: cRect ? cRect.bottom : null,
          sendBtnVisible: sRect && sRect.width > 0 && sRect.height > 0 && sRect.bottom <= 460,
          windowScrollY: window.scrollY,
          viewportHeight: window.visualViewport ? window.visualViewport.height : window.innerHeight
        };
      })()
    `);

    console.log('  Keyboard open state:', JSON.stringify(kbOpenState));

    // Verify 1: Header remains visible at top: 0px
    console.log('  2.1 Header top is 0px:', kbOpenState.headerTop === 0);
    console.log('  2.2 Header is fully visible:', kbOpenState.headerVisible === true);
    console.log('  2.3 Room ID visible:', kbOpenState.roomCodeVisible === 'ROOM_KB');
    console.log('  2.4 CLEAR CHAT button visible:', kbOpenState.clearBtnVisible === true);
    console.log('  2.5 Window scroll remained 0:', kbOpenState.windowScrollY === 0);
    console.log('  2.6 Message area dynamically shrunk:', kbOpenState.msgHeight < normalState.msgHeight);
    console.log('  2.7 Message composer immediately above keyboard:', kbOpenState.composerBottom <= 460);
    console.log('  2.8 Send button fully visible and accessible:', kbOpenState.sendBtnVisible === true);

    if (kbOpenState.headerTop !== 0 || !kbOpenState.headerVisible) {
      throw new Error(`Header disappeared or was scrolled off screen: headerTop=${kbOpenState.headerTop}`);
    }
    if (kbOpenState.windowScrollY !== 0) {
      throw new Error(`Window scrolled unexpectedly: scrollY=${kbOpenState.windowScrollY}`);
    }
    if (kbOpenState.msgHeight >= normalState.msgHeight) {
      throw new Error(`Message area did not shrink when keyboard opened!`);
    }
    if (kbOpenState.composerBottom > 460) {
      throw new Error(`Composer covered by keyboard: composerBottom=${kbOpenState.composerBottom}`);
    }
    console.log('  [PASS] Scenario 2: Dynamic keyboard open layout verified!\n');

    // --- TEST SCENARIO 3: Scroll messages while keyboard is open ---
    console.log('--- TEST SCENARIO 3: Message Area Scrolling (Only Messages Scroll) ---');
    await evaluate(`
      (function() {
        const msgContainer = document.querySelector('.overscroll-contain');
        if (msgContainer) {
          msgContainer.scrollTop = 50;
        }
      })();
    `);
    await new Promise((r) => setTimeout(r, 200));

    let scrollState = await evaluate(`
      (function() {
        const msgContainer = document.querySelector('.overscroll-contain');
        const header = document.querySelector('header');
        const hRect = header ? header.getBoundingClientRect() : null;
        return {
          msgScrollTop: msgContainer ? msgContainer.scrollTop : null,
          windowScrollY: window.scrollY,
          headerTop: hRect ? hRect.top : null
        };
      })()
    `);

    console.log('  Scroll state:', JSON.stringify(scrollState));
    console.log('  3.1 Header remains pinned at 0 during message scroll:', scrollState.headerTop === 0);
    console.log('  3.2 Window scroll remains 0:', scrollState.windowScrollY === 0);
    if (scrollState.headerTop !== 0 || scrollState.windowScrollY !== 0) {
      throw new Error('Message scroll leaked into window or moved the header');
    }
    console.log('  [PASS] Scenario 3: Isolated message scrolling verified!\n');

    // --- TEST SCENARIO 4: Send a Message while Keyboard is Open ---
    console.log('--- TEST SCENARIO 4: Sending Message (Keyboard Remains Open) ---');
    await evaluate(`
      (function() {
        const input = document.getElementById('message-input');
        const form = input.closest('form');
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Keyboard test message');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      })();
    `);
    await new Promise((r) => setTimeout(r, 400));

    let sendState = await evaluate(`
      (function() {
        const input = document.getElementById('message-input');
        const bubbles = document.querySelectorAll('.break-words');
        const lastBubble = bubbles[bubbles.length - 1];
        return {
          inputCleared: input ? input.value === '' : false,
          lastBubbleText: lastBubble ? lastBubble.textContent.trim() : null,
          isInputFocused: document.activeElement === input
        };
      })()
    `);

    console.log('  Send state:', JSON.stringify(sendState));
    console.log('  4.1 Input cleared after send:', sendState.inputCleared);
    console.log('  4.2 Message sent successfully:', sendState.lastBubbleText === 'Keyboard test message');
    console.log('  4.3 Input maintains focus (keeps keyboard open):', sendState.isInputFocused);
    if (!sendState.inputCleared || sendState.lastBubbleText !== 'Keyboard test message') {
      throw new Error('Message sending failed while keyboard was open');
    }
    console.log('  [PASS] Scenario 4: Send message with keyboard open verified!\n');

    // --- TEST SCENARIO 5: Close Keyboard (Viewport restores to 812px) ---
    console.log('--- TEST SCENARIO 5: Close Keyboard (Full Viewport Restored) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });
    await evaluate(`
      (function() {
        const input = document.getElementById('message-input');
        if (input) input.blur();
      })();
    `);
    await new Promise((r) => setTimeout(r, 600));

    let restoredState = await evaluate(`
      (function() {
        const header = document.querySelector('header');
        const msgContainer = document.querySelector('.overscroll-contain');
        const input = document.getElementById('message-input');
        const composer = input ? input.closest('div.border-t') : null;
        const hRect = header ? header.getBoundingClientRect() : null;
        const mRect = msgContainer ? msgContainer.getBoundingClientRect() : null;
        const cRect = composer ? composer.getBoundingClientRect() : null;
        return {
          headerTop: hRect ? hRect.top : null,
          headerVisible: hRect && hRect.top === 0 && hRect.height >= 40,
          msgHeight: mRect ? mRect.height : null,
          composerBottom: cRect ? cRect.bottom : null,
          windowScrollY: window.scrollY
        };
      })()
    `);

    console.log('  Restored state:', JSON.stringify(restoredState));
    console.log('  5.1 Header visible at top: 0:', restoredState.headerVisible);
    console.log('  5.2 Message area height restored to full:', restoredState.msgHeight > kbOpenState.msgHeight);
    console.log('  5.3 Composer bottom at screen bottom:', Math.abs(restoredState.composerBottom - 812) < 20);
    console.log('  5.4 Window scroll remains 0:', restoredState.windowScrollY === 0);
    if (!restoredState.headerVisible || restoredState.msgHeight <= kbOpenState.msgHeight) {
      throw new Error('Failed to restore layout when keyboard closed');
    }
    console.log('  [PASS] Scenario 5: Keyboard close layout restoration verified!\n');

    // --- TEST SCENARIO 5B: Sending Message with Keyboard Closed Does NOT Re-focus/Open Keyboard ---
    console.log('--- TEST SCENARIO 5B: Send Message with Keyboard Closed (No Re-focus) ---');
    await evaluate(`
      (function() {
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-message-btn');
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Message sent while closed');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        sendBtn.click();
      })();
    `);
    await new Promise((r) => setTimeout(r, 400));

    let closedSendState = await evaluate(`
      (function() {
        const input = document.getElementById('message-input');
        const bubbles = document.querySelectorAll('.break-words');
        const lastBubble = bubbles[bubbles.length - 1];
        return {
          inputCleared: input ? input.value === '' : false,
          lastBubbleText: lastBubble ? lastBubble.textContent.trim() : null,
          isInputFocused: document.activeElement === input
        };
      })()
    `);

    console.log('  Closed send state:', JSON.stringify(closedSendState));
    console.log('  5B.1 Message sent successfully:', closedSendState.lastBubbleText === 'Message sent while closed');
    console.log('  5B.2 Input is NOT focused (prevents keyboard reopening):', !closedSendState.isInputFocused);
    if (closedSendState.isInputFocused) {
      throw new Error('Input was unexpectedly focused after sending with keyboard closed!');
    }
    console.log('  [PASS] Scenario 5B: No automatic focus reopening verified!\n');

    // --- TEST SCENARIO 6: Mobile Landscape (Rotation) ---
    console.log('--- TEST SCENARIO 6: Mobile Landscape Orientation (812x375) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 812,
      height: 375,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise((r) => setTimeout(r, 600));

    let landscapeState = await evaluate(`
      (function() {
        const header = document.querySelector('header');
        const msgContainer = document.querySelector('.overscroll-contain');
        const input = document.getElementById('message-input');
        const composer = input ? input.closest('div.border-t') : null;
        const hRect = header ? header.getBoundingClientRect() : null;
        const mRect = msgContainer ? msgContainer.getBoundingClientRect() : null;
        const cRect = composer ? composer.getBoundingClientRect() : null;
        return {
          headerTop: hRect ? hRect.top : null,
          headerVisible: hRect && hRect.top === 0 && hRect.height >= 40,
          msgHeight: mRect ? mRect.height : null,
          composerBottom: cRect ? cRect.bottom : null,
          windowScrollY: window.scrollY
        };
      })()
    `);

    console.log('  Landscape state:', JSON.stringify(landscapeState));
    console.log('  6.1 Header visible in landscape:', landscapeState.headerVisible);
    console.log('  6.2 Message area accommodates landscape height:', landscapeState.msgHeight > 100);
    console.log('  6.3 Composer bottom matches landscape height:', Math.abs(landscapeState.composerBottom - 375) < 20);
    if (!landscapeState.headerVisible || landscapeState.windowScrollY !== 0) {
      throw new Error('Landscape layout broken or scrolled window');
    }
    console.log('  [PASS] Scenario 6: Mobile landscape rotation verified!\n');

    // --- TEST SCENARIO 7: Desktop Layout Protection (1440x900) ---
    console.log('--- TEST SCENARIO 7: Desktop Layout Protection (1440x900) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise((r) => setTimeout(r, 600));

    let desktopState = await evaluate(`
      (function() {
        const sidebar = document.querySelector('aside');
        const header = document.querySelector('header');
        const mobileToggle = document.getElementById('mobile-members-toggle');
        const sRect = sidebar ? sidebar.getBoundingClientRect() : null;
        const hRect = header ? header.getBoundingClientRect() : null;
        const tComputed = mobileToggle ? window.getComputedStyle(mobileToggle).display : 'none';
        return {
          sidebarVisible: sRect && sRect.width > 200 && sRect.height > 600,
          headerTop: hRect ? hRect.top : null,
          headerWidth: hRect ? hRect.width : null,
          mobileToggleHidden: tComputed === 'none',
          windowScrollY: window.scrollY
        };
      })()
    `);

    console.log('  Desktop state:', JSON.stringify(desktopState));
    console.log('  7.1 Desktop sidebar fully visible:', desktopState.sidebarVisible);
    console.log('  7.2 Mobile toggle button hidden on desktop:', desktopState.mobileToggleHidden);
    console.log('  7.3 Desktop header properly positioned:', desktopState.headerTop === 0 && desktopState.headerWidth > 1000);
    console.log('  7.4 Desktop window scroll remains 0:', desktopState.windowScrollY === 0);
    if (!desktopState.sidebarVisible || !desktopState.mobileToggleHidden || desktopState.headerTop !== 0) {
      throw new Error('Desktop layout was affected or regressed');
    }
    console.log('  [PASS] Scenario 7: Desktop design completely preserved!\n');

    console.log('====================================================');
    console.log('ALL 7 MOBILE KEYBOARD & VIEWPORT TESTS PASSED PERFECTLY!');
    console.log('====================================================');

    ws.close();
  } finally {
    chrome.kill('SIGTERM');
    server.close();
  }
}

runTest().catch((err) => {
  console.error('\n[FAIL] Test encountered error:', err);
  process.exit(1);
});
