export type LogLevel = "debug" | "info" | "warn" | "error";

export interface MetabolicLogger {
  debug(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  info(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  warn(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  error(message: string, metadata?: Readonly<Record<string, unknown>>): void;
}

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createMetabolicLogger(minimumLevel: LogLevel): MetabolicLogger {
  const write = (
    level: LogLevel,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ): void => {
    if (priorities[level] < priorities[minimumLevel]) return;

    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "metabolic-assistant",
      level,
      message,
      ...metadata,
    });

    if (level === "error") {
      console.error(payload);
      return;
    }
    if (level === "warn") {
      console.warn(payload);
      return;
    }
    console.log(payload);
  };

  return {
    debug: (message, metadata) => write("debug", message, metadata),
    info: (message, metadata) => write("info", message, metadata),
    warn: (message, metadata) => write("warn", message, metadata),
    error: (message, metadata) => write("error", message, metadata),
  };
}
