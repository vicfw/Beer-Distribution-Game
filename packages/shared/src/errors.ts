export const ERROR_CODES = [
  'GAME_NOT_FOUND',
  'GAME_ALREADY_STARTED',
  'ROLE_ALREADY_TAKEN',
  'INVALID_ORDER',
  'INVALID_RULES',
  'ROUND_NOT_ACTIVE',
  'ALREADY_SUBMITTED',
  'PLAYER_NOT_AUTHORIZED',
  'INVALID_GAME_STATE',
  'SPECTATOR_NOT_ALLOWED',
  'GAME_FINISHED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorBody = {
  code: ErrorCode;
  message: string;
};
