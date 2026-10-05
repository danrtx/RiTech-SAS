export interface EnvironmentVariables {
  NODE_ENV: string;
  PORT: number;
  // Database (PostgreSQL 16)
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  DB_PASS: string;
  DB_NAME: string;
  // Cache (Redis 7)
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASS: string;
  // Telemetry WS
  WS_PORT: number;
}

export const envConfig = (): EnvironmentVariables => ({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  DB_HOST: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5433', 10),
  DB_USER: process.env.DB_USER || process.env.POSTGRES_USER || 'ritech',
  DB_PASS: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || 'ritech_dev',
  DB_NAME: process.env.DB_NAME || process.env.POSTGRES_DB || 'ritech',
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASS: process.env.REDIS_PASSWORD || 'ritech_dev',
  WS_PORT: parseInt(process.env.WS_PORT || '4000', 10),
});
