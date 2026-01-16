import { ServerCanvasOperation, Stroke, Point } from '../../shared/types';

/**
 * Handles the rendering logic for the collaborative canvas.
 * 
 * ARCHITECTURE:
 * We use a dual-layer strategy for performance:
 * 1.  **Base Layer**: Contains the "committed" state (history). Only re-rendered when
 *     history changes (undo/redo/sync).
 * 2.  **Live Layer**: Contains "active" strokes (users currently drawing). Cleared and
 *     re-drawn frequently (every frame or mouse event).
 * 
 * This separation ensures that a user drawing a new line doesn't trigger a re-render
 * of thousands of existing strokes.
 */
export class CanvasRenderer {
    private baseCtx: CanvasRenderingContext2D;
    private liveCtx: CanvasRenderingContext2D;
    private width: number = 0;
    private height: number = 0;

    constructor(
        private baseCanvas: HTMLCanvasElement,
        private liveCanvas: HTMLCanvasElement
    ) {
        // We assume 2D context is available.
        this.baseCtx = this.baseCanvas.getContext('2d')!;
        this.liveCtx = this.liveCanvas.getContext('2d')!;

        // Optimize for crisp lines
        this.baseCtx.lineCap = 'round';
        this.baseCtx.lineJoin = 'round';
        this.liveCtx.lineCap = 'round';
        this.liveCtx.lineJoin = 'round';
    }

    /**
     * Resizes both canvas layers, handling High-DPI (Retina) displays.
     * This ensures text and lines look sharp on modern screens.
     */
    public resize(width: number, height: number) {
        this.width = width;
        this.height = height;

        const dpr = window.devicePixelRatio || 1;

        // 1. Set the CSS size (layout size)
        this.baseCanvas.style.width = `${width}px`;
        this.baseCanvas.style.height = `${height}px`;
        this.liveCanvas.style.width = `${width}px`;
        this.liveCanvas.style.height = `${height}px`;

        // 2. Set the internal bitmap size (scaled by DPR)
        this.baseCanvas.width = width * dpr;
        this.baseCanvas.height = height * dpr;
        this.liveCanvas.width = width * dpr;
        this.liveCanvas.height = height * dpr;

        // 3. Scale the context so drawing operations use logical pixels
        this.baseCtx.scale(dpr, dpr);
        this.liveCtx.scale(dpr, dpr);

        // Reset context properties after resize (they get cleared)
        this.baseCtx.lineCap = 'round';
        this.baseCtx.lineJoin = 'round';
        this.liveCtx.lineCap = 'round';
        this.liveCtx.lineJoin = 'round';
    }

    /**
     * Renders the authoritative history onto the base layer.
     * This is an expensive operation (O(N) where N is total strokes), so call sparingly.
     * 
     * @param operations The full authoritative history from the server.
     */
    public renderHistory(operations: ReadonlyArray<ServerCanvasOperation>) {
        // Clear the base layer
        this.baseCtx.clearRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);

        // 1. Fold operations to get the final state of strokes
        // We need to track which strokes are currently "added" and not "removed".
        const visibleStrokes = new Map<string, Stroke>();

        for (const op of operations) {
            if (op.type === 'ADD_STROKE') {
                visibleStrokes.set(op.stroke.id, op.stroke);
            } else if (op.type === 'REMOVE_STROKE') {
                visibleStrokes.delete(op.strokeId);
            }
        }

        // 3. Draw each visible stroke
        for (const stroke of visibleStrokes.values()) {
            this.drawStroke(this.baseCtx, stroke.points, stroke.color, stroke.size);
        }
    }

    /**
     * Renders multiple live strokes (local and remote) onto the live layer.
     * This clears the live layer first.
     */
    public renderLiveStrokes(strokes: { points: Point[], color: string, size: number }[]) {
        this.clearLive();

        for (const stroke of strokes) {
            if (stroke.points.length > 0) {
                this.drawStroke(this.liveCtx, stroke.points, stroke.color, stroke.size);
            }
        }
    }

    /**
     * Renders a single live stroke (in-progress) onto the live layer.
     * NOTE: This clears the entire live layer! Use renderLiveStrokes for multi-user.
     */
    public renderLiveStroke(points: Point[], color: string, size: number) {
        this.clearLive();
        this.drawStroke(this.liveCtx, points, color, size);
    }

    /**
     * Clears the live layer.
     * Called when a stroke ends or is cancelled.
     */
    public clearLive() {
        this.liveCtx.clearRect(0, 0, this.width, this.height);
    }

    /**
     * Core drawing routine using Quadratic Bezier curves for smoothing.
     * 
     * Algorithm:
     * Instead of connecting points with straight lines (which look jagged),
     * we use the midpoints between captured events as control points for
     * quadratic curves. This creates a smooth, organic feel.
     */
    protected drawStroke(
        ctx: CanvasRenderingContext2D,
        points: Point[],
        color: string,
        size: number
    ) {
        if (points.length === 0) return;

        ctx.strokeStyle = color;
        ctx.lineWidth = size;
        ctx.beginPath();

        // Case 1: Single point (a dot)
        if (points.length === 1) {
            const p = points[0];
            ctx.fillStyle = color;
            ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        // Case 2: Multiple points (a curve)
        // Move to the first point
        ctx.moveTo(points[0].x, points[0].y);

        // Draw quadratic curves between points
        // We stop at length - 1 because we need pairs of points
        for (let i = 1; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            // The control point is p1 (the captured event)
            // The end point of the curve is the midpoint between p1 and p2
            const midPoint = {
                x: (p1.x + p2.x) / 2,
                y: (p1.y + p2.y) / 2
            };

            ctx.quadraticCurveTo(p1.x, p1.y, midPoint.x, midPoint.y);
        }

        // Connect the last segment with a straight line
        // (or we could use the last point as a control point, but this is standard)
        const lastPoint = points[points.length - 1];
        ctx.lineTo(lastPoint.x, lastPoint.y);

        ctx.stroke();
    }
}
