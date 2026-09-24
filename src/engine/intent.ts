/** What a controller (keyboard or AI brain) wants a character to do this frame. */
export interface MoveIntent {
  /** -1..1. In isometric view this is already in world space. */
  moveX: number;
  moveY: number;
}

export interface ActionIntent {
  jump: boolean;
  shoot: boolean;
}

export interface AimIntent {
  /** Optional aim direction; falls back to facing when zero. */
  aimX: number;
  aimY: number;
}

export interface Intent extends MoveIntent, ActionIntent, AimIntent {}

export const emptyIntent = (): Intent => ({ moveX: 0, moveY: 0, jump: false, shoot: false, aimX: 0, aimY: 0 });
