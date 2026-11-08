const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');

const TEST_PORT = 5050;

async function runResponsiveTests() {
  console.log('====================================================');
  console.log('SChat Responsive Viewports & Header Visibility Test');
  console.log('====================================================\n');

  // 1. Setup Express app serving the client dist build + socket.io
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  app.use(express.static(path.join(__dirname, '../client/dist')));

  // In-memory socket room handlers (compatible with SChat)
  const rooms = new Map();
  io.on('connection', (socket) => {
    socket.on('join_room', ({ username, roomCode, sessionId }, cb) => {
      const code = roomCode || 'ROOM1';
      if (!rooms.has(code)) {
        rooms.set(code, { messages: [], participants: new Map() });
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
      if (typeof cb === 'function') cb({ success: true });
    });
  });

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Test Server] Listening on http://localhost:${TEST_PORT}`);

  // 2. Launch headless Chrome with CDP
  const tmpDir = path.join(os.tmpdir(), 'chrome-resp-test-' + Date.now());
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--user-data-dir=' + tmpDir,
    '--disable-gpu',
    'about:blank'
  ], { stdio: 'ignore' });

  // Wait for Chrome to be ready
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
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };

    await new Promise((r) => (ws.onopen = r));
    console.log('[CDP] Connected via WebSocket\n');

    // Viewport matrix
    const viewports = [
      { name: 'Small Mobile (iPhone SE)', width: 320, height: 568, isMobile: true },
      { name: 'Standard Mobile (iPhone X/12)', width: 375, height: 812, isMobile: true },
      { name: 'Large Mobile (iPhone Pro Max)', width: 414, height: 896, isMobile: true },
      { name: 'Mobile Landscape', width: 812, height: 375, isMobile: true },
      { name: 'Tablet Portrait (iPad 768px)', width: 768, height: 1024, isMobile: false },
      { name: 'Tablet Landscape (iPad 1024px)', width: 1024, height: 768, isMobile: false },
      { name: 'Desktop Full (1440x900)', width: 1440, height: 900, isMobile: false }
    ];

    for (const vp of viewports) {
      console.log(`--- Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 2,
        mobile: vp.isMobile
      });

      await send('Page.navigate', { url: `http://localhost:${TEST_PORT}/` });
      
      // Wait for home screen input
      for (let i = 0; i < 30; i++) {
        const r = await send('Runtime.evaluate', { expression: 'Boolean(document.getElementById("username-input"))' });
        if (r.result && r.result.value) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      // Fill in username and room code on home screen
      await send('Runtime.evaluate', {
        expression: `
          (() => {
            const setVal = (el, val) => {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(el, val);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const u = document.getElementById('username-input');
            const r = document.getElementById('roomcode-input');
            if (u && r) {
              setVal(u, 'Tester');
              setVal(r, 'ROOM_${vp.width}');
              document.getElementById('connect-btn').click();
            }
          })()
        `
      });

      // Wait for ChatRoom header
      for (let i = 0; i < 30; i++) {
        const r = await send('Runtime.evaluate', { expression: 'Boolean(document.querySelector("header"))' });
        if (r.result && r.result.value) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      // Evaluate ChatRoom layout
      const layoutRes = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const header = document.querySelector('header');
            const main = document.querySelector('main');
            const aside = document.querySelector('aside');
            const mobileToggle = document.getElementById('mobile-members-toggle');
            const clearBtn = document.getElementById('clear-chat-btn');
            const messageInput = document.getElementById('message-input');
            const messagesContainer = main ? main.querySelector('.overflow-y-auto') : null;

            const getRect = (el) => {
              if (!el) return null;
              const r = el.getBoundingClientRect();
              const cs = window.getComputedStyle(el);
              return {
                top: Math.round(r.top),
                bottom: Math.round(r.bottom),
                left: Math.round(r.left),
                right: Math.round(r.right),
                width: Math.round(r.width),
                height: Math.round(r.height),
                display: cs.display,
                visibility: cs.visibility,
                opacity: cs.opacity
              };
            };

            return {
              windowWidth: window.innerWidth,
              windowHeight: window.innerHeight,
              windowScrollY: window.scrollY,
              header: getRect(header),
              main: getRect(main),
              aside: getRect(aside),
              mobileToggle: getRect(mobileToggle),
              clearBtn: getRect(clearBtn),
              messageInput: getRect(messageInput),
              messagesContainer: getRect(messagesContainer)
            };
          })()
        `,
        returnByValue: true
      });

      const layout = layoutRes.result ? layoutRes.result.value : null;
      if (!layout || !layout.header) {
        throw new Error(`ChatRoom failed to render on ${vp.name}`);
      }

      // Verify Header
      console.log(`  [Header] top: ${layout.header.top}px, height: ${layout.header.height}px, width: ${layout.header.width}px, display: ${layout.header.display}`);
      if (layout.header.top !== 0) {
        throw new Error(`Header top is ${layout.header.top}px (must be 0px at top of viewport)!`);
      }
      if (layout.header.height <= 0 || layout.header.display === 'none') {
        throw new Error(`Header is hidden or has 0 height!`);
      }

      // Verify Window Scroll is 0 (header not pushed away)
      console.log(`  [Window Scroll] scrollY: ${layout.windowScrollY}px`);
      if (layout.windowScrollY !== 0) {
        throw new Error(`Window scroll is non-zero: ${layout.windowScrollY}px`);
      }

      // Verify Clear Chat Button
      if (!layout.clearBtn || layout.clearBtn.width <= 0) {
        throw new Error('Clear Chat button is not visible');
      }
      console.log(`  [Clear Chat Button] visible, width: ${layout.clearBtn.width}px`);

      // Verify Message Input accessible
      if (!layout.messageInput || layout.messageInput.bottom > layout.windowHeight) {
        throw new Error('Message input is cut off or beyond viewport bottom');
      }
      console.log(`  [Message Input] accessible at bottom: ${layout.messageInput.bottom}px (viewport: ${layout.windowHeight}px)`);

      // Verify Responsive Sidebar vs Mobile Toggle
      if (vp.width < 768) {
        // Mobile view: sidebar hidden, mobile toggle visible
        if (layout.aside && layout.aside.display !== 'none' && layout.aside.width > 0) {
          throw new Error('Sidebar should be hidden in normal flow on mobile');
        }
        if (!layout.mobileToggle || layout.mobileToggle.display === 'none' || layout.mobileToggle.width <= 0) {
          throw new Error('Mobile members toggle button is missing or hidden on mobile');
        }
        console.log(`  [Mobile Behavior] Sidebar hidden in flow, toggle button visible (${layout.mobileToggle.width}px)`);

        // Test opening mobile drawer
        await send('Runtime.evaluate', {
          expression: `document.getElementById('mobile-members-toggle').click();`
        });
        await new Promise((r) => setTimeout(r, 300));

        const drawerRes = await send('Runtime.evaluate', {
          expression: `
            (() => {
              const drawer = document.querySelector('.fixed.inset-0.z-50');
              return drawer ? { visible: true, width: drawer.firstElementChild.getBoundingClientRect().width } : { visible: false };
            })()
          `,
          returnByValue: true
        });
        const drawerInfo = drawerRes.result.value;
        if (!drawerInfo.visible) {
          throw new Error('Mobile members drawer did not open on toggle click');
        }
        console.log(`  [Mobile Drawer] Opened successfully (drawer width: ${drawerInfo.width}px)`);

        // Close drawer
        await send('Runtime.evaluate', {
          expression: `document.querySelector('button[aria-label="Close participants list"]').click();`
        });
        await new Promise((r) => setTimeout(r, 200));
      } else {
        // Tablet / Desktop view: sidebar visible, mobile toggle hidden
        if (!layout.aside || layout.aside.display === 'none' || layout.aside.width <= 0) {
          throw new Error('Sidebar should be visible side-by-side on tablet/desktop');
        }
        if (layout.mobileToggle && layout.mobileToggle.display !== 'none' && layout.mobileToggle.width > 0) {
          throw new Error('Mobile toggle should be hidden on tablet/desktop');
        }
        console.log(`  [Desktop/Tablet Behavior] Sidebar visible (${layout.aside.width}px), mobile toggle hidden`);
      }

      console.log(`[PASS] ${vp.name} verified successfully!\n`);
    }

    // Save final mobile screenshot for verification
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '../mobile_verified.png'), Buffer.from(screenshot.data, 'base64'));
    console.log('[Screenshot] Saved mobile_verified.png');

    ws.close();
  } finally {
    chrome.kill();
    server.close();
  }

  console.log('====================================================');
  console.log('ALL VIEWPORT TESTS PASSED PERFECTLY!');
  console.log('====================================================');
}

runResponsiveTests().catch((err) => {
  console.error('\n[FAIL] Responsive viewport test failed:', err);
  process.exit(1);
});

