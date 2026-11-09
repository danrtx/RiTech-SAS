import { IbkrClient, mapStatus } from "./ibkr.client";

const order = {
  correlationId: "test-1",
  conid: 123,
  side: "SELL" as const,
  quantity: 2,
  limitPrice: 100,
};
describe("IBKR Gateway IOC", () => {
  const env = { ...process.env };
  let request: jest.SpyInstance;
  beforeEach(() => {
    process.env.EXECUTION_MODE = "ibkr-paper";
    process.env.IBKR_PAPER_ACCOUNT = "DU12345";
    request = jest.spyOn(global, "fetch");
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });
  it("sends limit IOC with stable cOID to paper account", async () => {
    request.mockResolvedValue(
      new Response(
        JSON.stringify([{ order_id: "42", order_status: "Submitted" }]),
      ),
    );
    expect(await new IbkrClient().submit(order, "stable-id")).toMatchObject({
      state: "ACCEPTED",
      brokerOrderId: "42",
    });
    const [url, options] = request.mock.calls[0];
    expect(url).toContain("/account/DU12345/orders");
    expect(JSON.parse(options.body).orders[0]).toMatchObject({
      tif: "IOC",
      cOID: "stable-id",
      orderType: "LMT",
      quantity: 2,
    });
    expect(options.redirect).toBe("error");
  });
  it.each(["U12345", ""])("blocks non-paper account %s", (account) => {
    process.env.IBKR_PAPER_ACCOUNT = account;
    expect(() => new IbkrClient()).toThrow();
  });
  it("blocks untrusted remote gateway", () => {
    process.env.IBKR_GATEWAY_URL = "https://example.com/v1/api";
    expect(() => new IbkrClient()).toThrow();
  });
  it("requires an authenticated session and matching account", async () => {
    request
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: true, connected: true })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accounts: ["DU9999"] })),
      );
    await expect(new IbkrClient().preflight()).rejects.toThrow("paper account");
  });
  it.each([
    [[{ order_id: "42", order_status: "Expired" }], "EXPIRED"],
    [{ error: "invalid price" }, "REJECTED"],
    [[{ id: "warning", message: ["Confirm?"] }], "CONFIRMATION_REQUIRED"],
    [{ unexpected: true }, "UNKNOWN"],
  ])("handles response %j", async (body, state) => {
    request.mockResolvedValue(new Response(JSON.stringify(body)));
    expect((await new IbkrClient().submit(order, "id")).state).toBe(state);
  });
  it("treats a network timeout as ambiguous", async () => {
    request.mockRejectedValue(new Error("secret must not leak"));
    expect(await new IbkrClient().submit(order, "id")).toEqual({
      state: "UNKNOWN",
      reason: "NETWORK_OR_RESPONSE_ERROR",
    });
  });
  it("honors Retry-After on throttling", async () => {
    request.mockResolvedValue(
      new Response("", { status: 429, headers: { "Retry-After": "20" } }),
    );
    expect((await new IbkrClient().submit(order, "id")).retryAfterMs).toBe(
      20000,
    );
  });
  it("does not retry server errors or infer expiration from cancellation", async () => {
    request.mockResolvedValue(new Response("", { status: 503 }));
    expect((await new IbkrClient().submit(order, "id")).state).toBe("UNKNOWN");
    expect(mapStatus("Cancelled")).toBe("CANCELLED");
    expect(mapStatus("Filled")).toBe("FILLED");
  });
});
