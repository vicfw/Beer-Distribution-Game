import pino from 'pino';

export type Logger = {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
};

export function createLogger(level: string): Logger {
  const log = pino({
    level,
    redact: {
      paths: ['seatToken', 'token', 'authorization', 'tokenHash', '*.seatToken', '*.token', '*.tokenHash'],
      remove: true,
    },
  });
  return {
    info: (bindings, message) => log.info(bindings, message),
    warn: (bindings, message) => log.warn(bindings, message),
    error: (bindings, message) => log.error(bindings, message),
  };
}

export function captureLogger(): Logger & { events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = [];
  const push = (bindings: Record<string, unknown>) => {
    events.push(bindings);
  };
  return {
    events,
    info: push,
    warn: push,
    error: push,
  };
}
