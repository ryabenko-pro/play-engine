import type { ActorState, PlacedBody, StateSet } from './types';

/** Current state of an actor. Purely data: code decides when to switch. */
export class StateHolder {
  time = 0;
  private current: ActorState | undefined;

  constructor(private def: StateSet) {
    this.reset();
  }

  /** Use another state set (a form's): keeps the current state and its time if the new set has it. */
  retarget(def: StateSet): void {
    this.def = def;
    const same = def.states.find((s) => s.name === this.current?.name);
    if (same) this.current = same;
    else this.reset();
  }

  get name(): string {
    return this.current?.name ?? '';
  }

  get animation(): string {
    return this.current?.animation ?? '';
  }

  get body(): PlacedBody | null {
    return this.current?.body ?? null;
  }

  has(name: string): boolean {
    return this.def.states.some((s) => s.name === name);
  }

  /** Returns false for unknown states. Re-entering the current state keeps its time. */
  set(name: string): boolean {
    if (name === this.current?.name) return true;
    const s = this.def.states.find((x) => x.name === name);
    if (!s) return false;
    this.current = s;
    this.time = 0;
    return true;
  }

  reset(): void {
    this.current = this.def.states.find((s) => s.name === this.def.initialState) ?? this.def.states[0];
    this.time = 0;
  }

  tick(dt: number): void {
    this.time += dt;
  }
}
