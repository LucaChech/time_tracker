/** Public surface of the Cadence state engine (Phase 2). */
export { CadenceEngine } from './engine'
export type { EngineDeps, ManualTaskInput } from './engine'
export { deriveState, replay, mergeIntervals, comparePaused, sessionUnionMs } from './derive'
export type { DeriveInput, Timeline } from './derive'
export {
  readWorklog,
  appendEvent,
  readTasksStore,
  writeTasksStore,
  readClickUpCache,
  writeClickUpCache,
  parseEventLine,
  worklogPath,
  tasksStorePath,
  clickupCachePath,
  WORKLOG_FILE,
  TASKS_STORE_FILE,
  CLICKUP_CACHE_FILE
} from './store'
export type { ClickUpCache } from './store'
