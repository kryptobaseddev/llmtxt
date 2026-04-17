/**
 * Mesh topology backend stub (T449).
 *
 * Re-exports {@link MeshBackend} from the factory module so T386 can extend
 * or replace the implementation without touching the factory barrel.
 *
 * Architecture contract (ARCH-T429 §10, §11 T429.5):
 * - All standard Backend interface methods delegate to an internal LocalBackend.
 * - open() emits a 'mesh:sync-engine-not-started' warning until T386 ships.
 * - T386 replaces the sync engine by importing from this module and extending
 *   MeshBackend, or by swapping the default export.
 *
 * @module mesh
 */

export { MeshBackend, MeshNotImplementedError } from '../backend/factory.js';
