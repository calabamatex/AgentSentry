/**
 * CLI hooks module — TypeScript implementations of AgentSentry shell hooks.
 *
 * Each hook is a standalone script that can be invoked via:
 *   node dist/src/cli/hooks/<name>.js
 *
 * Shell scripts in scripts/ are thin wrappers that pipe stdin to these.
 */

export { scanErrorHandling } from '../../analyzers/error-handling';
export { scanPiiLogging } from '../../analyzers/pii-scanner';
