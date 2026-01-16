/**
 * shared/types.ts
 * 
 * Defines the core data model and protocol for the collaborative canvas.
 * 
 * DESIGN DECISIONS:
 * 1.  **Operation-Based History**: We treat the document state as a log of operations 
 *     (ADD_STROKE, REMOVE_STROKE). This ensures:
 *     -   **Deterministic Replay**: Replaying the log from zero always yields the same state.
 *     -   **Pure Undo/Redo**: Undo is simply popping the last operation; Redo is re-pushing it.
 *     -   **No "Soft Deletes"**: We don't mutate strokes to mark them erased. We append a 
 *         REMOVE operation. This keeps history immutable.
 * 
 * 2.  **Streaming Protocol**: To minimize latency, we don't wait for a stroke to finish
 *     before sending it. We stream `START` -> `MOVE`... -> `END` events. This ensures
 *     users see others drawing in real-time (sub-100ms perception).
 * 
 * 3.  **Authoritative Server**: The server assigns global ordering (sequence numbers) to 
 *     operations. This simplifies conflict resolution and ensures all clients eventually 
 *     converge on the same state.
 * 
 * 4.  **Strict Operation Authority**: We separate `ClientCanvasOperation` (draft, no seq)
 *     from `ServerCanvasOperation` (authoritative, required seq). This prevents clients
 *     from spoofing order and ensures type safety in the history log.
 */

// ==========================================
// 1. Core Geometry & Data Models
// ==========================================

/**
 * Represents a single sample point in a stroke.
 * We include pressure for stylus support, enabling variable line width/opacity.
 * Timestamp is vital for replay timing and smoothing algorithms.
 */
export interface Point {
    x: number;         // Canvas coordinate X
    y: number;         // Canvas coordinate Y
    p: number;         // Pressure (0.0 to 1.0), defaults to 0.5 for mouse
    t: number;         // Timestamp (ms) relative to stroke start or epoch
}

/**
 * A completed drawing stroke.
 * This is the data payload for an ADD_STROKE operation.
 */
export interface Stroke {
    id: string;        // UUID, assigned by client to allow optimistic updates
    color: string;     // Hex code or RGBA string
    size: number;      // Base brush thickness
    points: Point[];   // The full sequence of points
}

/**
 * Represents the ephemeral state of a user's cursor.
 * Used for "presence" (showing where other users are hovering).
 */
export interface Cursor {
    userId: string;
    x: number;
    y: number;
    color: string;     // User's identifying color
}

// ==========================================
// 2. History & Operations
// ==========================================

/**
 * Operations sent by the CLIENT.
 * These represent "draft" intentions and do NOT have sequence numbers yet.
 */
export type ClientCanvasOperation =
    | {
        id: string;        // Operation ID (UUID)
        type: 'ADD_STROKE';
        stroke: Stroke;
    }
    | {
        id: string;        // Operation ID (UUID)
        type: 'REMOVE_STROKE';
        strokeId: string;  // The ID of the stroke being removed
    };

/**
 * Operations stored and broadcast by the SERVER.
 * These are AUTHORITATIVE and MUST have a sequence number.
 * The history log consists exclusively of these operations.
 */
export type ServerCanvasOperation =
    | {
        id: string;        // Operation ID (UUID)
        type: 'ADD_STROKE';
        stroke: Stroke;
        seq: number;       // REQUIRED: Server-assigned sequence number
    }
    | {
        id: string;        // Operation ID (UUID)
        type: 'REMOVE_STROKE';
        strokeId: string;  // The ID of the stroke being removed
        seq: number;       // REQUIRED: Server-assigned sequence number
    };

// ==========================================
// 3. WebSocket Protocol (Client -> Server)
// ==========================================

export enum ClientMessageType {
    STROKE_START = 'C_STROKE_START',
    STROKE_MOVE = 'C_STROKE_MOVE',
    STROKE_END = 'C_STROKE_END',
    UNDO = 'C_UNDO',
    REDO = 'C_REDO',
    CURSOR_MOVE = 'C_CURSOR_MOVE',
}

export type ClientMessage =
    | {
        type: ClientMessageType.STROKE_START;
        roomId: string;   // Explicit room context
        id: string;       // Client-generated UUID for the new stroke
        color: string;
        size: number;
        startPoint: Point;
    }
    | {
        type: ClientMessageType.STROKE_MOVE;
        roomId: string;
        id: string;       // Must match the ID sent in STROKE_START
        points: Point[];  // Batch of new points since last message (high-frequency coalescing)
    }
    | {
        type: ClientMessageType.STROKE_END;
        roomId: string;
        id: string;
    }
    | {
        type: ClientMessageType.UNDO;
        roomId: string;
        // No payload; implies "undo the last operation in the global stack"
    }
    | {
        type: ClientMessageType.REDO;
        roomId: string;
        // No payload; implies "redo the last undone operation"
    }
    | {
        type: ClientMessageType.CURSOR_MOVE;
        roomId: string;
        x: number;
        y: number;
    };

// ==========================================
// 4. WebSocket Protocol (Server -> Client)
// ==========================================

export enum ServerMessageType {
    SYNC = 'S_SYNC',
    BROADCAST_STROKE_START = 'S_STROKE_START',
    BROADCAST_STROKE_MOVE = 'S_STROKE_MOVE',
    BROADCAST_STROKE_END = 'S_STROKE_END',
    BROADCAST_OPERATION = 'S_OPERATION', // Unified broadcast for completed ops (Add/Remove)
    BROADCAST_UNDO = 'S_UNDO', // Kept for signaling the "action" of undoing
    BROADCAST_REDO = 'S_REDO',
    BROADCAST_CURSOR = 'S_CURSOR',
}

export type ServerMessage =
    | {
        // Sent on connection to bring client up to speed.
        // Sends the FULL operation history for deterministic replay.
        type: ServerMessageType.SYNC;
        roomId: string;
        operations: ServerCanvasOperation[]; // MUST be authoritative operations
    }
    | {
        // Forwarding a start event to other clients (streaming)
        type: ServerMessageType.BROADCAST_STROKE_START;
        roomId: string;
        userId: string;
        id: string;
        color: string;
        size: number;
        startPoint: Point;
    }
    | {
        // Streaming updates for a live stroke
        type: ServerMessageType.BROADCAST_STROKE_MOVE;
        roomId: string;
        userId: string;
        id: string;
        points: Point[];
    }
    | {
        // Finalizing a stroke. 
        // NOTE: This usually implies an ADD_STROKE operation is now committed to history.
        type: ServerMessageType.BROADCAST_STROKE_END;
        roomId: string;
        userId: string;
        id: string;
    }
    | {
        // Broadcasts a completed operation (ADD or REMOVE) that has been committed.
        // This is the authoritative signal to update the local history stack.
        type: ServerMessageType.BROADCAST_OPERATION;
        roomId: string;
        operation: ServerCanvasOperation; // MUST be authoritative
    }
    | {
        // Global undo occurred. Clients should pop the last operation from their stack.
        // We send the full operation so clients know WHAT was undone (e.g. ADD vs REMOVE).
        type: ServerMessageType.BROADCAST_UNDO;
        roomId: string;
        operation: ServerCanvasOperation;
    }
    | {
        // Global redo occurred. Clients should re-apply the operation.
        type: ServerMessageType.BROADCAST_REDO;
        roomId: string;
        operation: ServerCanvasOperation; // MUST be authoritative (new sequence number)
    }
    | {
        type: ServerMessageType.BROADCAST_CURSOR;
        roomId: string;
        userId: string;
        x: number;
        y: number;
        color: string;
    };
