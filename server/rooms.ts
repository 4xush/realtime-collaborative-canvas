import { DrawingState } from './drawing-state';

// Map of roomId -> Authoritative DrawingState
const rooms = new Map<string, DrawingState>();

// Helper to get or create state for a room
export function getRoomState(roomId: string): DrawingState {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new DrawingState());
    }
    return rooms.get(roomId)!;
}
