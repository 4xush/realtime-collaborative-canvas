import { ServerCanvasOperation } from '../../shared/types';

/**
 * Manages the local mirror of the server's authoritative operation history.
 * 
 * RESPONSIBILITIES:
 * - Stores an ordered list of ServerCanvasOperation.
 * - Provides methods to mutate the list based on server messages (SYNC, OP, UNDO).
 * - Exposes a read-only snapshot for rendering.
 * 
 * CONSTRAINTS:
 * - Deterministic behavior only.
 * - No business logic (undo/redo decisions happen on server).
 */
export class OperationStore {
    private operations: ServerCanvasOperation[] = [];

    /**
     * Replaces the entire operation history.
     * Used when receiving the initial SYNC message from the server.
     * 
     * @param ops The full authoritative history.
     */
    public setOperations(ops: ServerCanvasOperation[]) {
        // Create a shallow copy to ensure we own the array
        this.operations = [...ops];
    }

    /**
     * Appends a new operation to the history.
     * Used when receiving BROADCAST_OPERATION or BROADCAST_REDO.
     * 
     * @param op The new operation to append.
     */
    public addOperation(op: ServerCanvasOperation) {
        this.operations.push(op);
    }

    /**
     * Removes an operation by its ID.
     * Used when receiving BROADCAST_UNDO.
     * 
     * @param id The ID of the operation to remove.
     */
    public removeOperation(id: string) {
        // Filter out the operation with the matching ID.
        this.operations = this.operations.filter(op => op.id !== id);
    }

    /**
     * Returns a read-only snapshot of the current operations.
     * Used by the renderer.
     */
    public getSnapshot(): ReadonlyArray<ServerCanvasOperation> {
        return this.operations;
    }
}
