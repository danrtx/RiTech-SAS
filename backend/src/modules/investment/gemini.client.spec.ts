import { ConfigService } from "@nestjs/config";
import { GeminiClient } from "./gemini.client";
import { InvestmentConfig } from "./investment.config";
import { analysis } from "./testing/fixtures";
const generateContent = jest.fn();
jest.mock("@google/genai", () => ({
  ThinkingLevel: { LOW: "LOW" },
  GoogleGenAI: jest
    .fn()
    .mockImplementation(() => ({ models: { generateContent } })),
}));
describe("Gemini official SDK adapter", () => {
  const config = new InvestmentConfig(
    new ConfigService({
      GEMINI_ENABLED: "true",
      GEMINI_API_KEY: "test-placeholder",
    }),
  );
  const client = new GeminiClient(config);
  beforeEach(() => generateContent.mockReset());
  it("uses structured output, timeout, one attempt, cancellation and no tools", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify(analysis),
      modelVersion: "provider-version",
      candidates: [{ finishReason: "STOP" }],
    });
    const abort = new AbortController();
    expect(
      (await client.generate("analysis", { symbol: "QQQ" }, abort.signal))
        .modelVersion,
    ).toBe("provider-version");
    const request = generateContent.mock.calls[0][0];
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.httpOptions).toMatchObject({
      timeout: 15000,
      retryOptions: { attempts: 1 },
    });
    expect(request.config.abortSignal).toBe(abort.signal);
    expect(request.config.tools).toBeUndefined();
    expect(request.config.systemInstruction).toContain("investment-v1");
  });
  it.each([
    "",
    "not json",
    JSON.stringify({ ...analysis, decision: "EXECUTE" }),
    JSON.stringify({ ...analysis, justification: "https://evil.test" }),
  ])("rejects invalid response %s", async (text) => {
    generateContent.mockResolvedValue({
      text,
      candidates: [{ finishReason: "STOP" }],
    });
    await expect(client.generate("analysis", {})).rejects.toThrow();
  });
  it.each([429, 401, 403, 503])(
    "normalizes HTTP %s without retrying or leaking credentials",
    async (status) => {
      generateContent.mockRejectedValue({ status, message: "secret" });
      await expect(client.generate("analysis", {})).rejects.not.toThrow(
        "secret",
      );
      expect(generateContent).toHaveBeenCalledTimes(1);
    },
  );
  it("handles timeout and disabled configuration", async () => {
    generateContent.mockRejectedValue(new Error("timeout secret"));
    await expect(client.generate("analysis", {})).rejects.toThrow(
      "GEMINI_NO_DISPONIBLE",
    );
    const disabled = new GeminiClient(
      new InvestmentConfig(new ConfigService({})),
    );
    await expect(disabled.generate("analysis", {})).rejects.toThrow(
      "GEMINI_NO_CONFIGURADO",
    );
  });
  it.each([
    [504, "GEMINI_TIEMPO_AGOTADO"],
    [404, "GEMINI_MODELO_NO_DISPONIBLE"],
  ])(
    "identifies provider failure %s without exposing its message",
    async (status, code) => {
      generateContent.mockRejectedValue({
        status,
        message: "secret credential",
      });
      await expect(client.generate("analysis", {})).rejects.toThrow(
        code as string,
      );
      expect(generateContent).toHaveBeenCalledTimes(1);
    },
  );
});
