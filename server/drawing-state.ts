import { ClientCanvasOperation, ServerCanvasOperation, Stroke } from '../shared/types';

/**
 * Manages the authoritative state of the drawing canvas.
 * 
 * RESPONSIBILITIES:
 * 1.  **Operation Log**: Maintains the strictly ordered history of all operations.
 * 2.  **Global Undo/Redo**: Manages the undo/redo stacks for the entire room.
 * 3.  **State Derivation**: Computes the current set of visible strokes by "folding" operations.
 */
export class DrawingState {
    // The authoritative history of operations that have been applied.
    // MUST be ServerCanvasOperation (with sequence numbers).
    private operations: ServerCanvasOperation[] = [];

    // The stack of operations that have been undone and can be redone.
    // Cleared whenever a new operation is pushed.
    private redoStack: ServerCanvasOperation[] = [];

    // Global sequence number to ensure strict ordering of operations.
    // Essential for conflict resolution if we were to introduce peer-to-peer syncing later,
    // but currently used to give clients a way to detect missing messages.
    private nextSeq: number = 1;

    /**
     * Adds a new operation to the history.
     * This is the "commit" action for any drawing or erasing.
     * 
     * @param op The client draft operation (without sequence number).
     * @returns The authoritative operation with the assigned sequence number.
     */
    public pushOperation(op: ClientCanvasOperation): ServerCanvasOperation {
        // 1. Assign authoritative sequence number
        // We cast to any to spread the properties, then enforce the type return.
        // This effectively "upgrades" the Client op to a Server op.
        const sequencedOp: ServerCanvasOperation = {
            ...op,
            seq: this.nextSeq++
        };

        // 2. Commit to history
        this.operations.push(sequencedOp);

        // 3. Clear redo stack
        // Any new action invalidates the "future" timeline.
        if (this.redoStack.length > 0) {
            this.redoStack = [];
        }

        return sequencedOp;
    }

    /**
     * Undoes the last operation in the global history.
     * 
     * @returns The full undone operation, or null if nothing to undo.
     */
    public undo(): ServerCanvasOperation | null {
        if (this.operations.length === 0) {
            return null;
        }

        // 1. Pop the last operation
        const op = this.operations.pop()!;

        // 2. Push to redo stack
        this.redoStack.push(op);

        // Return full op so clients can remove it locally
        return op;
    }

    /**
     * Redoes the last undone operation.
     * 
     * CRITICAL: We assign a NEW sequence number.
     * A redo is a *new event* in the timeline, not a time-travel back to the old event.
     * This ensures clients always process operations in increasing sequence order.
     * 
     * @returns The operation that was redone (with new seq), or null if nothing to redo.
     */
    public redo(): ServerCanvasOperation | null {
        if (this.redoStack.length === 0) {
            return null;
        }

        // 1. Pop from redo stack
        const op = this.redoStack.pop()!;

        // 2. Assign NEW sequence number
        const resequencedOp: ServerCanvasOperation = {
            ...op,
            seq: this.nextSeq++
        };

        // 3. Push back to history
        this.operations.push(resequencedOp);

        return resequencedOp;
    }

    /**
     * Returns the full operation history.
     * Used for syncing new clients.
     */
    public getSnapshot(): ServerCanvasOperation[] {
        return [...this.operations];
    }

    /**
     * Derives the current visual state of the canvas by replaying history.
     * This is "folding" the operation log into a state.
     * 
     * @returns An array of currently visible strokes.
     */
    public computeVisibleStrokes(): Stroke[] {
        const visibleStrokes = new Map<string, Stroke>();

        for (const op of this.operations) {
            switch (op.type) {
                case 'ADD_STROKE':
                    // Add the stroke to the map.
                    // If ID exists (shouldn't happen in normal flow), it overwrites.
                    visibleStrokes.set(op.stroke.id, op.stroke);
                    break;

                case 'REMOVE_STROKE':
                    // Remove the stroke from the map.
                    // EDGE CASE: If we try to remove a stroke that doesn't exist 
                    // (e.g. it was already undone), this is a no-op.
                    visibleStrokes.delete(op.strokeId);
                    break;
            }
        }

        return Array.from(visibleStrokes.values());
    }
}
