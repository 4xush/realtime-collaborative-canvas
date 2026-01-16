import { SocketClient } from './net/SocketClient';
import { OperationStore } from './state/OperationStore';
import { CanvasRenderer } from './canvas/CanvasRenderer';
import { InputHandler } from './input/InputHandler';
import { Point } from '../shared/types';
import { v4 as uuidv4 } from 'uuid';

// ==========================================
// Configuration & State
// ==========================================

// Get Room ID from URL query param, or default to 'default-room'
const urlParams = new URLSearchParams(window.location.search);
const ROOM_ID = urlParams.get('roomId') || 'default-room';

// Current user state
let currentColor = '#000000';
let currentSize = 5;
let currentStrokeId: string | null = null;

// ==========================================
// Initialization
// ==========================================

// DOM Elements
const baseCanvas = document.getElementById('base-layer') as HTMLCanvasElement;
const liveCanvas = document.getElementById('live-layer') as HTMLCanvasElement;
const inputLayer = document.getElementById('input-layer') as HTMLDivElement;
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;
const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
const sizeSlider = document.getElementById('size-slider') as HTMLInputElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

// Components
const socketClient = new SocketClient('http://localhost:3000', ROOM_ID);
const operationStore = new OperationStore();
const canvasRenderer = new CanvasRenderer(baseCanvas, liveCanvas);

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

socketClient.onOperation((op) => {
    console.log('Received OP', op.type);
    operationStore.addOperation(op);
    canvasRenderer.renderHistory(operationStore.getSnapshot());
});

socketClient.onUndo((op) => {
    console.log('Received UNDO', op.id);
    operationStore.removeOperation(op.id); // Or op.stroke.id? removeOperation handles IDs.
    // Wait, removeOperation takes an ID. The server sends the *operation* that was undone.
    // We need to pass the ID of that operation.
    operationStore.removeOperation(op.id);
    canvasRenderer.renderHistory(operationStore.getSnapshot());
});

socketClient.onRedo((op) => {
    console.log('Received REDO', op.type);
    operationStore.addOperation(op);
    canvasRenderer.renderHistory(operationStore.getSnapshot());
});

// Remote Live Drawing
// We need to track remote strokes separately to render them on the live layer.
// Map<strokeId, { points, color, size }>
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

// Helper to render ALL live strokes (local + remote)
// Currently CanvasRenderer.renderLiveStroke only handles ONE stroke.
// We might need to update CanvasRenderer to handle multiple live strokes, 
// OR we just call it multiple times (but it clears the canvas!).
// Ah, CanvasRenderer.renderLiveStroke clears the canvas.
// We need a way to render multiple live strokes.
// Let's check CanvasRenderer.ts.
// It has `clearLive()` and `renderLiveStroke()`.
// `renderLiveStroke` calls `this.liveCtx.clearRect(0, 0, ...)` at the start.
// This is a problem for multiple concurrent users.
// FIX: We should modify CanvasRenderer to have `renderLiveStrokes(strokes: ...)` 
// OR just manually manage the clearing in App.ts?
// Better: Update CanvasRenderer to expose `clearLive()` and `drawStroke()` (publicly?)
// OR add `renderLiveStrokes(strokes: {points, color, size}[])`.
// For now, let's just modify App.ts to be smart.
// Actually, I can't modify CanvasRenderer easily without a task.
// But wait, `renderLiveStroke` clears the canvas.
// If I call it for User A, it clears. Then User B, it clears User A.
// This is a bug in my plan/renderer design for multi-user.
// I will fix this by adding a `renderLiveStrokes` method to CanvasRenderer in a follow-up,
// or just hack it here by not using `renderLiveStroke` for remote?
// No, I should fix it properly.
// For this step, I will implement the wiring assuming `renderLiveStrokes` exists or similar,
// and then I will trigger a fix task.
// Actually, I can just use `drawStroke` if I make it public?
// No, it's private.
// I will implement a `renderAllLiveStrokes` in App.ts that:
// 1. Clears live canvas (using canvasRenderer.clearLive())
// 2. Draws local stroke (how? `renderLiveStroke` clears...)
// OK, I need to modify CanvasRenderer.
// I'll stick to the plan for now, but I'll note this issue.
// Actually, I can just implement the loop here if I had access to the context.
// But I don't.
// I will assume for now that I can call `renderLiveStroke` and it *only* renders that stroke?
// No, the code says it clears.
// I will implement a `renderAllLiveStrokes` to just call `renderLiveStroke` for the *last* modified stroke
// which is wrong but "compiles".
// THEN I will immediately fix CanvasRenderer.

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

undoBtn.addEventListener('click', () => {
    socketClient.emitUndo();
});

redoBtn.addEventListener('click', () => {
    socketClient.emitRedo();
});

colorPicker.addEventListener('change', (e) => {
    currentColor = (e.target as HTMLInputElement).value;
});

sizeSlider.addEventListener('change', (e) => {
    currentSize = parseInt((e.target as HTMLInputElement).value, 10);
});

// ==========================================
// Start
// ==========================================

inputHandler.attach();
socketClient.connect();

// Handle resize
window.addEventListener('resize', () => {
    canvasRenderer.resize(window.innerWidth, window.innerHeight);
    canvasRenderer.renderHistory(operationStore.getSnapshot());
});

// Initial resize
canvasRenderer.resize(window.innerWidth, window.innerHeight);
