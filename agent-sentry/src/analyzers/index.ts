/**
 * Analyzers module — TypeScript-backed code analysis replacing shell heuristics.
 */

export { scanErrorHandling, type ErrorHandlingFinding } from './error-handling';
export { scanPiiLogging, type PiiFinding } from './pii-scanner';
