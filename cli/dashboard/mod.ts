/**
 * Live benchmark dashboard
 * @module cli/dashboard
 */

// Types
export type {
  CellState,
  CostPoint,
  DashboardConfig,
  DashboardModelStats,
  DashboardProgress,
  DashboardState,
  MatrixCell,
  SSEEvent,
} from "./types.ts";

// Core
export { DashboardServer } from "./server.ts";
export { DashboardStateManager } from "./state.ts";
export { DashboardEventBridge } from "./bridge.ts";
export { openBrowser } from "./browser.ts";
