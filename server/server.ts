import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { DrawingState } from './drawing-state';
import {
    ClientMessage,
    ClientMessageType,
    ServerMessageType,
    ServerMessage,
    Point,
    Stroke,
    ClientCanvasOperation
} from '../shared/types';

// ==========================================
// 1. Server Setup
// ==========================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for this demo
        methods: ["GET", "POST"]
    }
});

// ==========================================
// 2. State Management
// ==========================================

// Map of roomId -> Authoritative DrawingState
const rooms = new Map<string, DrawingState>();

// Helper to get or create state for a room
function getRoomState(roomId: string): DrawingState {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new DrawingState());
    }
    return rooms.get(roomId)!;
}

// Buffer for active strokes being streamed.
// We need this to reconstruct the full Stroke object when STROKE_END arrives.
// Key: socketId -> Partial Stroke Data
interface ActiveStrokeBuffer {
    id: string;
    color: string;
    size: number;
    points: Point[];
}
const activeStrokes = new Map<string, ActiveStrokeBuffer>();

// ==========================================
// 3. Socket.io Logic
// ==========================================

io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    // 3.1. Handshake & Room Join
    // Client MUST provide roomId in query params
    const roomId = socket.handshake.query.roomId as string;
    if (!roomId) {
        console.error(`Socket ${socket.id} missing roomId, disconnecting.`);
        socket.disconnect();
        return;
    }

    socket.join(roomId);
    const state = getRoomState(roomId);

    // 3.2. Initial Sync
    // Send the full authoritative history to the new client
    const syncMsg: ServerMessage = {
        type: ServerMessageType.SYNC,
        roomId,
        operations: state.getSnapshot()
    };
    socket.emit('message', syncMsg);

    // 3.3. Message Handling
    socket.on('message', (msg: ClientMessage) => {
        // Defensive check: Ensure message belongs to the joined room
        if (msg.roomId !== roomId) {
            console.warn(`Socket ${socket.id} sent message for wrong room ${msg.roomId}`);
            return;
        }

        switch (msg.type) {
            // --- Streaming Drawing Events ---

            case ClientMessageType.STROKE_START: {
                // FIX #2: Improve active stroke buffering safety
                // Key by socketId AND strokeId to handle overlapping strokes or race conditions
                const bufferKey = `${socket.id}:${msg.id}`;

                // Initialize buffer for this user's stroke
                activeStrokes.set(bufferKey, {
                    id: msg.id,
                    color: msg.color,
                    size: msg.size,
                    points: [msg.startPoint]
                });

                // Broadcast start to others (for real-time visual)
                const broadcastMsg: ServerMessage = {
                    type: ServerMessageType.BROADCAST_STROKE_START,
                    roomId,
                    userId: socket.id,
                    id: msg.id,
                    color: msg.color,
                    size: msg.size,
                    startPoint: msg.startPoint
                };
                socket.to(roomId).emit('message', broadcastMsg);
                break;
            }

            case ClientMessageType.STROKE_MOVE: {
                // FIX #2: Use composite key
                const bufferKey = `${socket.id}:${msg.id}`;
                const buffer = activeStrokes.get(bufferKey);

                // FIX #3: Add defensive validation for stroke event order
                if (!buffer) {
                    console.warn(`Socket ${socket.id} sent STROKE_MOVE for unknown stroke ${msg.id}`);
                    return; // Gracefully ignore
                }

                buffer.points.push(...msg.points);

                // Broadcast move to others
                const broadcastMsg: ServerMessage = {
                    type: ServerMessageType.BROADCAST_STROKE_MOVE,
                    roomId,
                    userId: socket.id,
                    id: msg.id,
                    points: msg.points
                };
                socket.to(roomId).emit('message', broadcastMsg);
                break;
            }

            case ClientMessageType.STROKE_END: {
                // FIX #2: Use composite key
                const bufferKey = `${socket.id}:${msg.id}`;
                const buffer = activeStrokes.get(bufferKey);

                // FIX #3: Add defensive validation for stroke event order
                if (!buffer) {
                    console.warn(`Socket ${socket.id} sent STROKE_END for unknown stroke ${msg.id}`);
                    return; // Gracefully ignore
                }

                // 1. Construct the full Stroke object
                const stroke: Stroke = {
                    id: buffer.id,
                    color: buffer.color,
                    size: buffer.size,
                    points: buffer.points
                };

                // 2. Create the Client Operation
                const op: ClientCanvasOperation = {
                    id: msg.id, // Use stroke ID as op ID for simplicity, or generate new UUID
                    type: 'ADD_STROKE',
                    stroke: stroke
                };

                // 3. Commit to Authoritative State
                const serverOp = state.pushOperation(op);

                // 4. Broadcast the Authoritative Operation (with SEQ)
                // This tells clients: "This stroke is now officially part of history"
                const opMsg: ServerMessage = {
                    type: ServerMessageType.BROADCAST_OPERATION,
                    roomId,
                    operation: serverOp
                };
                io.to(roomId).emit('message', opMsg);

                // 5. Broadcast End (to stop the streaming visual)
                const endMsg: ServerMessage = {
                    type: ServerMessageType.BROADCAST_STROKE_END,
                    roomId,
                    userId: socket.id,
                    id: msg.id
                };
                socket.to(roomId).emit('message', endMsg);

                // 6. Cleanup buffer
                activeStrokes.delete(bufferKey);
                break;
            }

            // --- Undo/Redo ---

            case ClientMessageType.UNDO: {
                const undoneOp = state.undo();
                if (undoneOp) {
                    // FIX #1: Fix UNDO broadcast semantics
                    // Broadcast the full undone operation
                    const undoMsg: ServerMessage = {
                        type: ServerMessageType.BROADCAST_UNDO,
                        roomId,
                        operation: undoneOp
                    };
                    io.to(roomId).emit('message', undoMsg);
                }
                break;
            }
            case ClientMessageType.REDO: {
                const redoneOp = state.redo();
                if (redoneOp) {
                    const redoMsg: ServerMessage = {
                        type: ServerMessageType.BROADCAST_REDO,
                        roomId,
                        operation: redoneOp
                    };
                    io.to(roomId).emit('message', redoMsg);
                }
                break;
            }

            // --- Cursor ---

            case ClientMessageType.CURSOR_MOVE: {
                const cursorMsg: ServerMessage = {
                    type: ServerMessageType.BROADCAST_CURSOR,
                    roomId,
                    userId: socket.id,
                    x: msg.x,
                    y: msg.y,
                    color: '#000000' // In a real app, we'd store user profiles
                };
                socket.to(roomId).emit('message', cursorMsg);
                break;
            }
        }
    });

    // 3.4. Disconnect Handling
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        // Cleanup all active strokes for this user
        for (const key of activeStrokes.keys()) {
            if (key.startsWith(`${socket.id}:`)) {
                activeStrokes.delete(key);
            }
        }
    });
});

// ==========================================
// 4. Start Server
// ==========================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
