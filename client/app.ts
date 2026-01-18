import { SocketClient } from './net/SocketClient';
import { OperationStore } from './state/OperationStore';
import { CanvasRenderer } from './canvas/CanvasRenderer';
import { InputHandler } from './input/InputHandler';
import { Point } from '../shared/types';
import { v4 as uuidv4 } from 'uuid';


// ==========================================
// Configuration & State
// ==========================================

// Get Room ID from URL query param
const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get('roomId');

// If no room ID, generate one and redirect
if (!roomId) {
    roomId = uuidv4();
    window.location.search = `?roomId=${roomId}`;
    throw new Error('Redirecting to new room...'); // Stop execution
}

const ROOM_ID = roomId;

// Current user state
let currentColor = '#000000';
let currentSize = 5;
let currentStrokeId: string | null = null;

// ==========================================
// Health Check Service
// ==========================================

class HealthCheckService {
    private maxRetries = 10;
    private baseDelay = 1000; // 1 second
    private maxDelay = 30000; // 30 seconds
    private currentAttempt = 0;

    constructor(private serverUrl: string, private statusElement: HTMLElement) {}

    private updateStatus(message: string, isConnecting: boolean = false) {
        this.statusElement.innerHTML = isConnecting 
            ? `<span style="color: orange;">🔄 ${message}</span>`
            : `<span style="color: red;">❌ ${message}</span>`;
    }

    private updateStatusSuccess(message: string) {
        this.statusElement.innerHTML = `<span style="color: green;">✅ ${message}</span>`;
    }

    private calculateDelay(): number {
        // Exponential backoff with jitter
        const exponential = Math.min(this.baseDelay * Math.pow(2, this.currentAttempt), this.maxDelay);
        const jitter = Math.random() * 0.3 * exponential; // Add 0-30% jitter
        return Math.floor(exponential + jitter);
    }

    public async waitForServer(): Promise<void> {
        this.updateStatus(`Checking server health...`, true);
        
        while (this.currentAttempt < this.maxRetries) {
            try {
                const response = await fetch(`${this.serverUrl}/health`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(5000) // 5 second timeout
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 'ok') {
                        this.updateStatusSuccess('Server ready');
                        return; // Success!
                    }
                }
                
                throw new Error(`Health check failed: ${response.status}`);
            } catch (error) {
                this.currentAttempt++;
                const delay = this.calculateDelay();
                
                if (this.currentAttempt >= this.maxRetries) {
                    this.updateStatus(`Server offline (tried ${this.maxRetries} times). <button onclick="location.reload()" style="margin-left: 8px; padding: 4px 8px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;">Retry</button>`);
                    throw new Error('Max health check retries exceeded');
                }

                const nextRetryIn = Math.ceil(delay / 1000);
                this.updateStatus(`Server starting up... retrying in ${nextRetryIn}s (attempt ${this.currentAttempt}/${this.maxRetries})`, true);
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    public reset() {
        this.currentAttempt = 0;
    }
}

// ==========================================
// Initialization
// ==========================================

// DOM Elements
const baseCanvas = document.getElementById('base-layer') as HTMLCanvasElement;
const liveCanvas = document.getElementById('live-layer') as HTMLCanvasElement;
const cursorCanvas = document.getElementById('cursor-layer') as HTMLCanvasElement;
const inputLayer = document.getElementById('input-layer') as HTMLDivElement;
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;
const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
const penBtn = document.getElementById('pen-btn') as HTMLButtonElement;
const eraserBtn = document.getElementById('eraser-btn') as HTMLButtonElement;
const sizeSlider = document.getElementById('size-slider') as HTMLInputElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

// Room UI
const createRoomBtn = document.getElementById('create-room-btn') as HTMLButtonElement;
const joinRoomBtn = document.getElementById('join-room-btn') as HTMLButtonElement;
const joinRoomInput = document.getElementById('join-room-input') as HTMLInputElement;
const shareBtn = document.getElementById('share-btn') as HTMLButtonElement;

// Components
// Components
// Access process.env directly so bundlers (Parcel/Vite) can replace it at build time
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
console.log('Connecting to server:', SERVER_URL);
const socketClient = new SocketClient(SERVER_URL, ROOM_ID);
const operationStore = new OperationStore();
const canvasRenderer = new CanvasRenderer(baseCanvas, liveCanvas, cursorCanvas);

// ==========================================
// Wiring: Input -> Socket & Renderer
// ==========================================

const inputHandler = new InputHandler(inputLayer, {
    onStart: (points: Point[]) => {
        // 1. Generate a new Stroke ID
        currentStrokeId = uuidv4();
        const startPoint = points[0]; // We expect at least one point

        // 2. Optimistically render locally
        canvasRenderer.renderLiveStroke(points, currentColor, currentSize);

        // 3. Emit to server
        socketClient.emitStrokeStart(currentStrokeId, currentColor, currentSize, startPoint);

        // If there are more points (rare for onStart, but possible with batching), emit them too
        if (points.length > 1) {
            const rest = points.slice(1);
            socketClient.emitStrokeMove(currentStrokeId, rest);
        }
    },
    onMove: (points: Point[]) => {
        const id = currentStrokeId;
        if (!id) return;

        // 1. Optimistically render locally (append to live stroke)
        liveStrokePoints.push(...points);

        // We need to render ALL live strokes, not just this one, to avoid clearing others
        renderAllLiveStrokes();

        // 2. Emit to server (just the new points)
        socketClient.emitStrokeMove(id, points);
    },
    onEnd: () => {
        const id = currentStrokeId;
        if (!id) return;

        // 1. Emit end
        socketClient.emitStrokeEnd(id);

        // 2. Clear live stroke state locally
        liveStrokePoints = [];
        currentStrokeId = null;

        // Re-render to clear the local stroke from live layer (it will be added to history via server op)
        renderAllLiveStrokes();
    }
});

// Cursor Tracking (Local -> Server)
inputLayer.addEventListener('pointermove', (e) => {
    // Throttle? Maybe not needed for local network, but good practice.
    // For now, raw events.
    const rect = inputLayer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    socketClient.emitCursorMove(x, y);
});

// Local state for the current live stroke (to support full redraws)
let liveStrokePoints: Point[] = [];

// ==========================================
// Wiring: Socket -> Store & Renderer
// ==========================================

socketClient.onSync((ops) => {
    console.log('Received SYNC', ops.length);
    operationStore.setOperations(ops);
    canvasRenderer.renderHistory(operationStore.getSnapshot());
    statusDiv.textContent = 'Connected';
    statusDiv.style.backgroundColor = 'rgba(0, 128, 0, 0.7)';
});

socketClient.onError((err) => {
    statusDiv.textContent = 'Connection Failed';
    statusDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
    console.error('Connection failed:', err);
});

socketClient.onOperation((op) => {
    console.log('Received OP', op.type);
    operationStore.addOperation(op);
    canvasRenderer.renderHistory(operationStore.getSnapshot());
});

socketClient.onUndo((op) => {
    console.log('Received UNDO', op.id);
    operationStore.removeOperation(op.id);
    canvasRenderer.renderHistory(operationStore.getSnapshot());
});

socketClient.onRedo((op) => {
    console.log('Received REDO', op.type);
    operationStore.addOperation(op);
    canvasRenderer.renderHistory(operationStore.getSnapshot());
});

// Remote Live Drawing
const remoteStrokes = new Map<string, { points: Point[], color: string, size: number }>();

socketClient.onStrokeStart((userId, id, color, size, startPoint) => {
    remoteStrokes.set(id, { points: [startPoint], color, size });
    renderAllLiveStrokes();
});

socketClient.onStrokeMove((userId, id, points) => {
    const stroke = remoteStrokes.get(id);
    if (stroke) {
        stroke.points.push(...points);
        renderAllLiveStrokes();
    }
});

socketClient.onStrokeEnd((userId, id) => {
    remoteStrokes.delete(id);
    renderAllLiveStrokes();
});

// Remote Cursors
const remoteCursors = new Map<string, { x: number, y: number, color: string }>();

socketClient.onCursorMove((userId, x, y, color) => {
    remoteCursors.set(userId, { x, y, color });
    canvasRenderer.renderCursors(remoteCursors);
});

function renderAllLiveStrokes() {
    const strokesToRender: { points: Point[], color: string, size: number }[] = [];

    // Add local stroke if it exists
    if (liveStrokePoints.length > 0) {
        strokesToRender.push({
            points: liveStrokePoints,
            color: currentColor,
            size: currentSize
        });
    }

    // Add remote strokes
    for (const stroke of remoteStrokes.values()) {
        strokesToRender.push(stroke);
    }

    canvasRenderer.renderLiveStrokes(strokesToRender);
}

// ==========================================
// Wiring: UI
// ==========================================

// ==========================================
// Tool Management
// ==========================================

function setTool(tool: 'pen' | 'eraser') {
    if (tool === 'pen') {
        currentColor = colorPicker.value;
        penBtn.classList.add('active');
        eraserBtn.classList.remove('active');
        inputLayer.style.cursor = 'crosshair';
    } else {
        currentColor = '#f0f0f0'; // Match background
        penBtn.classList.remove('active');
        eraserBtn.classList.add('active');
        inputLayer.style.cursor = 'cell'; // Square cursor for eraser
    }
}

undoBtn.addEventListener('click', () => {
    socketClient.emitUndo();
});

redoBtn.addEventListener('click', () => {
    socketClient.emitRedo();
});

colorPicker.addEventListener('change', (e) => {
    // Picking a color automatically switches to Pen
    setTool('pen');
});

penBtn.addEventListener('click', () => {
    setTool('pen');
});

eraserBtn.addEventListener('click', () => {
    setTool('eraser');
});

sizeSlider.addEventListener('change', (e) => {
    currentSize = parseInt((e.target as HTMLInputElement).value, 10);
});

// Room Controls
createRoomBtn.addEventListener('click', () => {
    const newId = uuidv4();
    window.location.href = `/?roomId=${newId}`;
});

joinRoomBtn.addEventListener('click', () => {
    const id = joinRoomInput.value.trim();
    if (id) {
        window.location.href = `/?roomId=${id}`;
    }
});

shareBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
        const originalText = shareBtn.textContent;
        shareBtn.textContent = 'Copied!';
        setTimeout(() => {
            shareBtn.textContent = originalText;
        }, 2000);
    });
});

// ==========================================
// Start
// ==========================================

async function initializeApp() {
    try {
        // Initialize health check service
        const healthCheck = new HealthCheckService(SERVER_URL, statusDiv);
        
        // Wait for server to be ready (with retries and backoff)
        await healthCheck.waitForServer();
        
        // Server is ready, now connect WebSocket
        statusDiv.innerHTML = `<span style="color: green;">✅ Connecting to room...</span>`;
        socketClient.connect();
        
        // Setup input handling
        inputHandler.attach();
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        // Status is already updated by healthCheck service
    }
}

// Handle socket connection events
socketClient.onConnect(() => {
    statusDiv.innerHTML = `<span style="color: green;">✅ Connected to room: ${ROOM_ID}</span>`;
});

socketClient.onError((error) => {
    console.error('WebSocket error:', error);
    statusDiv.innerHTML = `<span style="color: red;">❌ Connection lost. <button onclick="location.reload()" style="margin-left: 8px; padding: 4px 8px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;">Reconnect</button></span>`;
});

// Start the application
initializeApp();

// Handle resize
window.addEventListener('resize', () => {
    canvasRenderer.resize(window.innerWidth, window.innerHeight);
    canvasRenderer.renderHistory(operationStore.getSnapshot());
});

// Initial resize
canvasRenderer.resize(window.innerWidth, window.innerHeight);
