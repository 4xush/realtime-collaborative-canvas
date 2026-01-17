# Real-Time Collaborative Drawing Canvas

A real-time, multi-user drawing application where multiple users can draw simultaneously on a shared canvas with live synchronization, global undo/redo, and deterministic state management.

This project focuses on **correct real-time architecture**, **canvas performance**, and **server-authoritative state**, rather than UI polish.

---

## 🚀 Features

* 🖌️ Freehand drawing with adjustable color and stroke size
* 👥 Multi-user real-time collaboration
* 🔄 Global undo / redo (shared across all users)
* 🧠 Server-authoritative operation history
* ⚡ Live stroke streaming (sub-100ms perception)
* 🔗 Room-based canvas sharing via URL
* 📐 High-DPI (Retina) canvas support
* 🖱️ Pointer events (mouse + touch)

---

## 🧩 Architecture Overview

* **Canvas is a render target, not state**
* **All shared state is modeled as operations**
* **Server assigns global ordering**
* **Clients deterministically replay operations**

For full details, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 🛠️ Tech Stack

### Frontend

* TypeScript
* HTML Canvas (raw Canvas API)
* Socket.io Client
* Pointer Events API

### Backend

* Node.js
* Express
* Socket.io (WebSockets)

---

## 📦 Project Structure

```
collaborative-canvas/
├── client/
│   ├── canvas/           # Canvas rendering logic
│   ├── input/            # Pointer input handling
│   ├── net/              # WebSocket client
│   ├── state/            # Operation store
│   ├── app.ts            # Application glue
│   └── index.html
│
├── server/
│   ├── server.ts         # WebSocket + Express server
│   └── drawing-state.ts  # Authoritative canvas state
│
├── shared/
│   └── types.ts          # Shared protocol & data models
│
├── README.md
└── ARCHITECTURE.md
```

---

## ▶️ Getting Started

### Prerequisites

* Node.js (v18+ recommended)
* npm

---

### 1️⃣ Install Dependencies

You need to install dependencies for both the server and the client.

**Server:**
```bash
cd server
npm install
```

**Client:**
```bash
cd client
npm install
```

---

### 2️⃣ Start the Server

```bash
cd server
npm start
```

Server runs on:

```
http://localhost:3000
```

---

### 3️⃣ Start the Client

In a separate terminal:

```bash
cd client
npm start
```

Client runs on:

```
http://localhost:1234
```

*(Exact port may vary depending on your dev setup.)*

---

## 🧪 Testing Multi-User Collaboration

### Basic Collaboration
1. Open the client URL (`http://localhost:1234`).
2. You will be automatically redirected to a new room (e.g., `/?roomId=...`).
3. Copy the URL and open it in a second window.
4. Draw in one window — strokes appear live in the other.

### Using Room Controls
* **New Canvas**: Click "New Canvas" to generate a fresh room.
* **Join Room**: Paste a Room ID and click "Join" to switch rooms.
* **Share**: Click "Share" to copy the current room link.

### Verification
* Users in **different rooms** cannot see each other's drawings.
* **Undo / Redo** applies only to the current room.
* Refreshing the page restores the room's history.

---

## ⏱️ Time Spent

Approximate time spent:

* Architecture & design: **4–5 hours**
* Backend implementation: **4 hours**
* Client rendering & input: **5–6 hours**
* Debugging & refinement: **3–4 hours**
* Documentation: **1–2 hours**

**Total:** ~18–21 hours

---

## ⚠️ Known Limitations

* No persistence (state resets on server restart)
* No authentication or user permissions
* No shape tools (freehand drawing only)
* No operation snapshotting (full replay on undo/redo)
* Pressure data captured but not yet used for stroke width

These were intentionally deferred to focus on **correct real-time synchronization and architecture**.

---

## 🧠 Design Decisions Worth Noting

* Global undo/redo handled **only by the server**
* Redo creates a **new operation** (not time travel)
* Live strokes rendered separately from committed history
* No drawing libraries used — raw Canvas API only

---

## 📌 Demo Notes

* Works in modern browsers (Chrome, Firefox, Safari)
* Touch input supported via Pointer Events
* Optimized for responsiveness over visual polish

---
