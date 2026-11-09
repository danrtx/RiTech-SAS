import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class InvestmentConfig {
  constructor(private readonly env: ConfigService) {}
  get enabled() {
    return this.env.get("GEMINI_ENABLED") === "true";
  }
  get key(): string {
    return this.env.get<string>("GEMINI_API_KEY") || "";
  }
  get model(): string {
    return this.env.get<string>("GEMINI_MODEL") || "gemini-3.8-flash";
  }
  number(name: string, fallback: number, min: number, max: number): number {
    const value = Number(this.env.get(name) ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  }
  get timeout() {
    return this.number("GEMINI_TIMEOUT_MS", 15000, 1000, 30000);
  }
  get generalCalls() {
    return this.number("INVESTMENT_GENERAL_CALLS_HOUR", 10, 1, 100);
  }
  get globalCalls() {
    return this.number("INVESTMENT_SERVICE_CALLS_HOUR", 100, 1, 10000);
  }
  get quoteAge() {
    return this.number("INVESTMENT_QUOTE_MAX_AGE_MS", 30000, 1000, 60000);
  }
  get atrAge() {
    return this.number("INVESTMENT_ATR_MAX_AGE_MS", 180000, 60000, 600000);
  }
  get contextAge() {
    return this.number("INVESTMENT_CONTEXT_MAX_AGE_MS", 300000, 10000, 3600000);
  }
  get validity() {
    return this.number("INVESTMENT_VALIDITY_MS", 30000, 1000, 60000);
  }
  get retentionDays() {
    return this.number("INVESTMENT_RETENTION_DAYS", 90, 7, 365);
  }
}
