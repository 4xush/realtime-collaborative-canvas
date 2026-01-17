# ARCHITECTURE.md

**Real-Time Collaborative Drawing Canvas**

---

## 1. High-Level Architecture

This application is a **real-time, multi-user collaborative drawing system** built around a **server-authoritative operation log**.

The core idea is:

> **The canvas is not state.
> The ordered list of operations is the state.**

All clients render their view of the canvas by deterministically replaying the same sequence of operations received from the server.

### Components Overview

```
┌────────────┐
│   Client   │
│            │
│ InputHandler ──┐
│                │
│ CanvasRenderer │
│                │
│ OperationStore │
│                │
│ SocketClient ──┴── WebSocket ── Server
└────────────┘
```

### Key Principles

* **Authoritative Server**: The server is the single source of truth for history.
* **Operation-Based State**: All changes are modeled as immutable operations.
* **Deterministic Rendering**: Clients derive visual state by replaying operations.
* **Low-Latency Streaming**: Stroke events are streamed before final commit for responsiveness.

---

## 2. Data Flow

### 2.1 Drawing a Stroke (Local User)

```
Pointer Input
   ↓
InputHandler
   ↓ (batched points)
SocketClient ──► Server
   ↓
CanvasRenderer (optimistic live rendering)
```

1. `InputHandler` captures pointer events and batches points using `requestAnimationFrame`.
2. The stroke is rendered optimistically on the **live canvas layer**.
3. Stroke events (`START`, `MOVE`, `END`) are streamed to the server.
4. On `END`, the server commits an `ADD_STROKE` operation.

---

### 2.2 Stroke Commit (All Clients)

```
ServerCanvasOperation
        ↓
SocketClient
        ↓
OperationStore
        ↓
CanvasRenderer (base layer re-render)
```

1. The server broadcasts an authoritative `ADD_STROKE` operation (with sequence number).
2. Clients append it to their local `OperationStore`.
3. The base canvas is re-rendered from the updated operation history.
4. The live layer is cleared (stroke is now part of history).

---

### 2.3 Remote User Drawing

Remote users’ strokes are handled similarly, except:

* Streaming events render on the **live layer only**.
* Final commit happens only after the server sends the authoritative operation.

---

## 3. Operation Model

### 3.1 Operation Types

All persistent state changes are represented as **operations**:

* `ADD_STROKE`
* `REMOVE_STROKE`

```ts
ServerCanvasOperation {
  id: string;     // operation ID
  type: 'ADD_STROKE' | 'REMOVE_STROKE';
  stroke?: Stroke;
  strokeId?: string;
  seq: number;    // server-assigned, strictly increasing
}
```

### Why Operations Instead of Pixels?

* Deterministic replay
* Resolution independence
* Correct global undo/redo
* No destructive edits

---

## 4. Undo / Redo Strategy (Global)

Undo/redo is **global and server-controlled**.

### Undo

1. Client sends `C_UNDO`.
2. Server removes the last operation from the history.
3. Server broadcasts the **undone operation**.
4. Clients remove that operation from `OperationStore`.
5. Canvas is re-rendered from remaining operations.

### Redo

1. Client sends `C_REDO`.
2. Server re-applies the operation **with a new sequence number**.
3. Clients append it and re-render.

### Important Design Decision

> **Redo is a new event, not time travel.**

This guarantees:

* Strict ordering
* No sequence conflicts
* Eventual consistency across clients

---

## 5. Conflict Resolution

Conflict resolution is simplified by design:

* The server assigns **global sequence numbers**.
* All operations are processed in order.
* Clients never guess ordering or resolve conflicts locally.

### Overlapping Drawing

* Multiple users drawing in the same area is allowed.
* Final visual result depends solely on operation order.
* Later strokes visually appear on top.

This matches expected behavior in collaborative drawing tools.

---

## 6. Canvas Rendering Strategy

### Layered Canvas Design

```
┌────────────────────────┐
│ Cursor / Overlay Layer │
├────────────────────────┤
│ Live Stroke Layer      │  ← in-progress strokes
├────────────────────────┤
│ Base Layer             │  ← committed history
└────────────────────────┘
```

### Why Layers?

* Avoid full redraws on every mouse move
* Clear live strokes cheaply
* Maintain smooth performance under load

### Rendering Rules

* **Base Layer**: Re-rendered only when history changes.
* **Live Layer**: Cleared and redrawn frequently.
* Canvas never stores state — it only renders.

---

## 7. Real-Time Performance Decisions

### Input Handling

* Pointer Events (mouse + touch unified)
* RAF-based batching (~16ms)
* Jitter filtering (ignore near-duplicate points)

### Networking

* Streaming stroke events for immediacy
* Commit only completed strokes
* Minimal payloads (batched points)

### Rendering

* Incremental drawing for live strokes
* Full replay only on undo/redo or sync
* High-DPI (devicePixelRatio) support

---

## 8. Determinism & Consistency Guarantees

* Server assigns all sequence numbers
* Clients never mutate history independently
* Replaying the same operations always produces the same canvas
* New clients reconstruct state from operation history alone

---

## 9. Known Limitations & Future Improvements

* No snapshotting (full replay on undo/redos)
* No authentication or permissions
* No persistence beyond in-memory server state
* No pressure-based stroke width (pressure captured, not yet used)

These were consciously deferred to keep focus on **core real-time collaboration correctness**.

---

## 10. Summary

This system prioritizes:

* Correctness over shortcuts
* Deterministic shared state
* Clear separation of concerns
* Interview-explainable architecture

The result is a robust foundation that can scale in features without compromising consistency.

---
