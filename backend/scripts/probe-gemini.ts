import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { config } from "dotenv";
import {
  GeminiClient,
  GeminiFailure,
} from "../src/modules/investment/gemini.client";
import { InvestmentConfig } from "../src/modules/investment/investment.config";
import {
  ModelAnalysis,
  PROMPT_VERSION,
  instrument,
} from "../src/modules/investment/investment.types";
config({ path: [".env", "../.env"] });
async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.log(
      JSON.stringify({
        status: "NO_EJECUTADA",
        reason: "GEMINI_API_KEY ausente",
        calls: 0,
      }),
    );
    process.exitCode = 2;
    return;
  }
  const config = new InvestmentConfig(
    new ConfigService({ ...process.env, GEMINI_ENABLED: "true" }),
  );
  try {
    const response = await new GeminiClient(config).generate("analysis", {
      instrument,
      testing: true,
      context: null,
      market: null,
      instruction:
        "Sin datos financieros disponibles, explica las limitaciones y abstente.",
    });
    const data = ModelAnalysis.parse(response.data);
    if (data.decision !== "ABSTENERSE")
      throw new Error("Unsafe decision without data");
    console.log(
      JSON.stringify({
        status: "VERIFICADA",
        model: response.modelVersion,
        promptVersion: PROMPT_VERSION,
        decision: data.decision,
        calls: 1,
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        status: "FALLIDA",
        reason: e instanceof GeminiFailure ? e.code : "RESPUESTA_NO_SEGURA",
        calls: 1,
      }),
    );
    process.exitCode = 1;
  }
}
void main();
