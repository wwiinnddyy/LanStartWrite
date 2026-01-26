export type LifecycleState = 'initializing' | 'ready' | 'busy' | 'error' | 'shutting-down';
export type ModeState = 'whiteboard' | 'annotation';

export interface MachineState<T extends string = string, C = any> {
  value: T;
  context: C;
}

export interface AppStatusState {
  version: number;
  machines: {
    lifecycle: MachineState<LifecycleState, any>;
    mode: MachineState<ModeState, any>;
    [key: string]: MachineState;
  };
  context: any;
}

export interface TransitionMeta {
  id: number;
  machine: string;
  event: string;
  from: string | null;
  to: string | null;
  ts: number;
  payload?: any;
}

export interface TransitionResult {
  ok: boolean;
  reason?: string;
  state: AppStatusState;
  transition?: TransitionMeta;
  prev?: AppStatusState;
}

export interface LogEntry extends TransitionMeta {}

export interface SnapshotMeta {
  id: number;
  ts: number;
  label: string;
}

export interface PersistStatus {
  ok: boolean;
  error: string;
}

export interface StatusApi {
  getState(): AppStatusState;
  getMachineState(name: string): MachineState | null;
  getMachines(): string[];
  getMachineConfig(name: string): any;
  transition(machine: string, event: string, payload?: any): TransitionResult;
  subscribe(listener: (state: AppStatusState, meta: TransitionMeta | null) => void): () => void;
  subscribeLog(listener: (entry: LogEntry) => void): () => void;
  getLog(limit?: number): LogEntry[];
  createSnapshot(label?: string): SnapshotMeta;
  listSnapshots(): SnapshotMeta[];
  rollbackToSnapshot(id: number): TransitionResult;
  enableDebug(on: boolean): void;
  getPersistStatus(): PersistStatus;
  resetState(): AppStatusState;
}

declare const Status: StatusApi;

export default Status;

