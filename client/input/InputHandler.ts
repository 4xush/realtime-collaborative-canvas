import { Point } from '../../shared/types';

interface InputHandlerCallbacks {
    onStart: (points: Point[]) => void;
    onMove: (points: Point[]) => void;
    onEnd: () => void;
}

/**
 * Handles pointer input for the canvas.
 * 
 * FEATURES:
 * - **Pointer Events**: Unified handling for mouse and touch.
 * - **Batching**: Uses requestAnimationFrame to batch 'move' events, preventing
 *   network flooding and rendering bottlenecks.
 * - **Jitter Filtering**: Ignores points that are too close to the previous point.
 */
export class InputHandler {
    private isDrawing = false;
    private activePoints: Point[] = [];
    private lastPoint: Point | null = null;
    private rafId: number | null = null;

    // Configuration
    private readonly JITTER_THRESHOLD = 2; // pixels

    constructor(
        private target: HTMLElement,
        private callbacks: InputHandlerCallbacks
    ) {
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.loop = this.loop.bind(this);
    }

    /**
     * Attaches event listeners to the target element.
     */
    public attach() {
        this.target.addEventListener('pointerdown', this.handlePointerDown);
        this.target.addEventListener('pointermove', this.handlePointerMove);
        this.target.addEventListener('pointerup', this.handlePointerUp);
        this.target.addEventListener('pointerleave', this.handlePointerUp);
        this.target.addEventListener('pointercancel', this.handlePointerUp);

        // Prevent default touch actions (scrolling)
        this.target.style.touchAction = 'none';
    }

    /**
     * Detaches event listeners.
     */
    public detach() {
        this.target.removeEventListener('pointerdown', this.handlePointerDown);
        this.target.removeEventListener('pointermove', this.handlePointerMove);
        this.target.removeEventListener('pointerup', this.handlePointerUp);
        this.target.removeEventListener('pointerleave', this.handlePointerUp);
        this.target.removeEventListener('pointercancel', this.handlePointerUp);
    }

    private handlePointerDown(e: PointerEvent) {
        if (!e.isPrimary) return; // Ignore multi-touch for now

        this.isDrawing = true;
        this.target.setPointerCapture(e.pointerId);

        const point = this.createPoint(e);
        this.lastPoint = point;

        // Emit start immediately
        this.callbacks.onStart([point]);

        // Start the batching loop
        this.rafId = requestAnimationFrame(this.loop);
    }

    private handlePointerMove(e: PointerEvent) {
        if (!this.isDrawing) return;

        const point = this.createPoint(e);

        // Jitter Filter: Ignore if too close to the last captured point
        // Note: We check against lastPoint, which is updated only when we accept a point.
        if (this.lastPoint && this.getDistance(this.lastPoint, point) < this.JITTER_THRESHOLD) {
            return;
        }

        this.activePoints.push(point);
        this.lastPoint = point;
    }

    private handlePointerUp(e: PointerEvent) {
        if (!this.isDrawing) return;

        this.isDrawing = false;

        if (this.target.hasPointerCapture(e.pointerId)) {
            this.target.releasePointerCapture(e.pointerId);
        }

        // Flush any remaining points
        if (this.activePoints.length > 0) {
            this.callbacks.onMove(this.activePoints);
            this.activePoints = [];
        }

        // Emit end
        this.callbacks.onEnd();

        // Stop the loop
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        this.lastPoint = null;
    }

    /**
     * The batching loop.
     * Runs every frame to flush buffered points.
     */
    private loop() {
        if (!this.isDrawing) return;

        if (this.activePoints.length > 0) {
            // Send a copy of the array and clear the buffer
            this.callbacks.onMove([...this.activePoints]);
            this.activePoints = [];
        }

        this.rafId = requestAnimationFrame(this.loop);
    }

    private createPoint(e: PointerEvent): Point {
        // Get coordinates relative to the target element
        const rect = this.target.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            p: e.pressure !== 0.5 ? e.pressure : 0.5, // 0.5 is default for mouse
            t: Date.now()
        };
    }

    private getDistance(p1: Point, p2: Point): number {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}
