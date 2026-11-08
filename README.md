# SChat – Minimal Real-Time Chat Website

A minimal, fast, and modern real-time messaging application with zero logins, no database persistence, and temporary in-memory room management.

* **Frontend**: React, Vite, Tailwind CSS, Lucide React, Socket.IO Client
* **Backend**: Node.js, Express.js, Socket.IO
* **Storage**: In-memory volatile room and message storage (automatic purge when rooms become inactive)

---

## Project Structure

```text
schat/
├── client/                 # React + Vite frontend
│   ├── src/
│   │   ├── components/     # Home, ChatRoom, ClearConfirmModal
│   │   ├── App.jsx         # Socket event wiring & screen state
│   │   ├── socket.js       # Socket.IO client instance
│   │   └── main.jsx
│   ├── vite.config.js      # Dev proxy configuration
│   └── package.json
├── server/                 # Express + Socket.IO backend
│   ├── server.js           # In-memory room manager & socket handlers
│   ├── test_multi_sessions.js # Multi-client test suite
│   └── package.json
├── package.json            # Root workspace scripts (runs both concurrently)
└── README.md
```

---

## Local Development Setup

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* [npm](https://www.npmjs.com/) (v9 or higher)
* [Git](https://git-scm.com/)

### 2. Install Dependencies

From the project root:
```bash
npm install
cd server && npm install
cd ../client && npm install
cd ..
```

### 3. Run Locally

To run both frontend and backend concurrently with one command:
```bash
npm run dev
```

* **Frontend**: `http://localhost:5173`
* **Backend**: `http://localhost:5000`

---

## Step-by-Step Production Deployment

Deploy the **Backend on Render** first so you have the server URL to provide to the **Frontend on Vercel**.

---

### Step 1: Deploy Backend to Render

1. Push your project to a GitHub repository.
2. Sign in to [Render](https://render.com).
3. On the Render Dashboard, click **New +** and select **Web Service**.
4. Connect your GitHub repository.
5. Configure the Web Service settings:
   * **Name**: `schat-backend` (or your preferred name)
   * **Region**: Choose the region closest to your users (e.g., Singapore, Frankfurt, Oregon)
   * **Root Directory**: `server`
   * **Environment**: `Node`
   * **Build Command**: `npm install`
   * **Start Command**: `node server.js`
   * **Instance Type**: `Free`
6. Under **Environment Variables**, add:
   * `PORT`: `5000` (Render binds automatically, but good to define)
   * `NODE_ENV`: `production`
   * `CLIENT_URL`: `*` (allows connections from your future Vercel domain)
7. Click **Create Web Service**.
8. Wait for the build and deployment to finish. Once live, copy your backend URL:
   ```text
   https://schat-backend-xxxx.onrender.com
   ```
   *(You can verify it by opening `https://schat-backend-xxxx.onrender.com/health` in your browser. It should return `{"status":"healthy", ...}`).*

---

### Step 2: Deploy Frontend to Vercel

1. Sign in to [Vercel](https://vercel.com).
2. Click **Add New...** → **Project**.
3. Import your `schat` GitHub repository.
4. In the **Configure Project** screen:
   * **Project Name**: `schat` (or your preferred name)
   * **Framework Preset**: `Vite`
   * **Root Directory**: Click **Edit** and select the `client` directory.
   * **Build Command**: `npm run build` (default)
   * **Output Directory**: `dist` (default)
   * **Install Command**: `npm install` (default)
5. Expand the **Environment Variables** section and add:
   * **Key**: `VITE_BACKEND_URL`
   * **Value**: Your Render backend URL from Step 1 (e.g., `https://schat-backend-xxxx.onrender.com`)
   > **Note**: Do not include a trailing slash in `VITE_BACKEND_URL`.
6. Click **Deploy**.
7. Vercel will build the client and provide your live URL (e.g., `https://schat.vercel.app`).

---

### Step 3: (Recommended) Tighten CORS on Render

Now that your frontend is live:
1. Go back to your [Render Dashboard](https://dashboard.render.com).
2. Select your `schat-backend` service.
3. Go to **Environment** settings.
4. Update `CLIENT_URL` to match your Vercel URL:
   ```text
   CLIENT_URL = https://schat.vercel.app
   ```
5. Click **Save Changes** (Render will automatically re-deploy with the new restriction).

---

## Alternative: Deploy Backend on Railway

If you prefer using Railway instead of Render:
1. Create a project on [Railway](https://railway.app).
2. Deploy from GitHub repo and set **Root Directory** to `/server`.
3. Build command: `npm install`. Start command: `node server.js`.
4. Generate a public domain under service settings (e.g., `https://schat-backend.up.railway.app`).
5. Use this domain as `VITE_BACKEND_URL` in Vercel.

---

## Verifying the Deployment

1. Open your live Vercel URL in **two different browser tabs/windows** or on your phone and laptop.
2. Tab 1:
   * Enter Username: `Alex`
   * Enter Room Code: `ALPHA`
   * Click **[ CONNECT ]**
3. Tab 2:
   * Enter Username: `Jordan`
   * Enter Room Code: `ALPHA`
   * Click **[ CONNECT ]**
4. Test interactions:
   * Send a message from `Alex` → Verify `Jordan` receives it immediately.
   * Check participant count in both tabs displays `2`.
   * Click **CLEAR CHAT** from one tab → Verify all messages clear for both users with a minimal system notification.
   * Click **Leave Room** → Verify user returns to Homepage and remaining user receives leave notification.

---

## Troubleshooting & Tips

* **Render Free Tier Spin-down**: On Render's free tier, the backend sleeps after 15 minutes of inactivity. The first connection after a pause may take 30–50 seconds to wake up.
* **WebSocket Fallback**: The client is configured with `transports: ['websocket', 'polling']`. If WebSocket connections are restricted on certain networks or proxies, it will smoothly fall back to HTTP long-polling.
* **In-Memory Retention**: Rooms and message histories exist strictly in server memory. When the last participant leaves a room, a 5-second grace period is triggered. If nobody rejoins within 5 seconds, the room and all messages are permanently wiped.
