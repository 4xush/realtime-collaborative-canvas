# Architecture Overview

## High-Level Design
- Canvas is a render target, not source of truth
- Drawing is modeled as operations
- Server maintains authoritative operation history

## Components
- Client: Canvas Renderer, Input Handler, WebSocket Client
- Server: Room Manager, Drawing State Manager

## Core Challenges
- Real-time streaming of strokes
- Global undo/redo across users
- Performance under concurrent input
