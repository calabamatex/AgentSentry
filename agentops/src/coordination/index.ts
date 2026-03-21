/**
 * Coordination module — multi-agent coordination primitives.
 *
 * [experimental] Single-machine, event-sourced coordination.
 * Not a distributed system. See lease.ts for consistency guarantees.
 */

export {
  AgentCoordinator,
  type AgentInfo,
  type LockInfo,
  type CoordinationMessage,
  type CoordinatorOptions,
} from './coordinator';

export {
  LeaseManager,
  type Lease,
  type LeaseManagerOptions,
} from './lease';
