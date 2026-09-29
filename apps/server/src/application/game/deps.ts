import type { GameRepository } from '../../infrastructure/database/GameRepository.js';
import type { Logger } from '../../infrastructure/logging/logger.js';

export type AppDeps = {
  repo: GameRepository;
  logger: Logger;
  now: () => string;
};
