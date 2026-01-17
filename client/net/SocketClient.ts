import { io, Socket } from 'socket.io-client';
import {
    ClientMessage,
    ClientMessageType,
    ServerMessage,
    ServerMessageType,
    Point,
    ServerCanvasOperation
} from '../../shared/types';

/**
 * Handles all client-side WebSocket communication.
 * 
 * RESPONSIBILITIES:
 * - Manages the Socket.io connection.
 * - Provides type-safe methods to emit client messages.
 * - Provides methods to register callbacks for server messages.
 * 
 * CONSTRAINTS:
 * - No application logic (just a protocol wrapper).
 * - Type-safe.
 */
export class SocketClient {
    private socket: Socket;

    constructor(url: string, private roomId: string) {
        this.socket = io(url, {
            autoConnect: false,
            query: { roomId }
        });

        this.socket.on('connect_error', (err) => {
            console.error('Socket connection error:', err);
        });
    }

    public onError(callback: (err: Error) => void) {
        this.socket.on('connect_error', callback);
    }

    public connect() {
        this.socket.connect();
    }

    public disconnect() {
        this.socket.disconnect();
    }

    // ==========================================
    // Emitters (Client -> Server)
    // ==========================================

    public emitStrokeStart(id: string, color: string, size: number, startPoint: Point) {
        const msg: ClientMessage = {
            type: ClientMessageType.STROKE_START,
            roomId: this.roomId,
            id,
            color,
            size,
            startPoint
        };
        this.socket.emit('message', msg);
    }

    public emitStrokeMove(id: string, points: Point[]) {
        const msg: ClientMessage = {
            type: ClientMessageType.STROKE_MOVE,
            roomId: this.roomId,
            id,
            points
        };
        this.socket.emit('message', msg);
    }

    public emitStrokeEnd(id: string) {
        const msg: ClientMessage = {
            type: ClientMessageType.STROKE_END,
            roomId: this.roomId,
            id
        };
        this.socket.emit('message', msg);
    }

    public emitUndo() {
        const msg: ClientMessage = {
            type: ClientMessageType.UNDO,
            roomId: this.roomId
        };
        this.socket.emit('message', msg);
    }

    public emitRedo() {
        const msg: ClientMessage = {
            type: ClientMessageType.REDO,
            roomId: this.roomId
        };
        this.socket.emit('message', msg);
    }

    public emitCursorMove(x: number, y: number) {
        const msg: ClientMessage = {
            type: ClientMessageType.CURSOR_MOVE,
            roomId: this.roomId,
            x,
            y
        };
        this.socket.emit('message', msg);
    }

    // ==========================================
    // Listeners (Server -> Client)
    // ==========================================

    public onSync(callback: (ops: ServerCanvasOperation[]) => void) {
        this.socket.on('message', (msg: ServerMessage) => {
            if (msg.type === ServerMessageType.SYNC) {
                callback(msg.operations);
            }
        });
    }

    public onOperation(callback: (op: ServerCanvasOperation) => void) {
        this.socket.on('message', (msg: ServerMessage) => {
            if (msg.type === ServerMessageType.BROADCAST_OPERATION) {
                callback(msg.operation);
            }
        });
    }

    public onUndo(callback: (op: ServerCanvasOperation) => void) {
        this.socket.on('message', (msg: ServerMessage) => {
            if (msg.type === ServerMessageType.BROADCAST_UNDO) {
                callback(msg.operation);
            }
        });
    }

    public onRedo(callback: (op: ServerCanvasOperation) => void) {
        this.socket.on('message', (msg: ServerMessage) => {
            if (msg.type === ServerMessageType.BROADCAST_REDO) {
                callback(msg.operation);
            }
        });
    }

    public onStrokeStart(callback: (userId: string, id: string, color: string, size: number, startPoint: Point) => void) {
        this.socket.on('message', (msg: ServerMessage) => {
            if (msg.type === ServerMessageType.BROADCAST_STROKE_START) {
                callback(msg.userId, msg.id, msg.color, msg.size, msg.startPoint);
            }
        });
    }

    public onStrokeMove(callback: (userId: string, id: string, points: Point[]) => void) {
        this.socket.on('message', (msg: ServerMessage) => {
            if (msg.type === ServerMessageType.BROADCAST_STROKE_MOVE) {
                callback(msg.userId, msg.id, msg.points);
            }
        });
    }

    public onStrokeEnd(callback: (userId: string, id: string) => void) {
        this.socket.on('message', (msg: ServerMessage) => {
            if (msg.type === ServerMessageType.BROADCAST_STROKE_END) {
                callback(msg.userId, msg.id);
            }
        });
    }

    public onCursorMove(callback: (userId: string, x: number, y: number, color: string) => void) {
        this.socket.on('message', (msg: ServerMessage) => {
            if (msg.type === ServerMessageType.BROADCAST_CURSOR) {
                callback(msg.userId, msg.x, msg.y, msg.color);
            }
        });
    }
}
