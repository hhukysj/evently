import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type DatabaseProbe } from "./app.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API health endpoints", () => {
  it("returns liveness without requiring a database query", async () => {
    const database: DatabaseProbe = {
      query: vi.fn(),
    };

    const response = await request(createApp(database)).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: { status: "ok", service: "evently-api" },
    });
    expect(database.query).not.toHaveBeenCalled();
  });

  it("returns ready when the database probe succeeds", async () => {
    const database: DatabaseProbe = {
      query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    };

    const response = await request(createApp(database)).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
    expect(database.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns a safe error envelope when the database probe fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const database: DatabaseProbe = {
      query: vi.fn().mockRejectedValue(new Error("private connection detail")),
    };

    const response = await request(createApp(database)).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body.error).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Service is not ready",
    });
    expect(response.body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(response.text).not.toContain("private connection detail");
    expect(log).toHaveBeenCalledOnce();
  });

  it("uses a versioned success/error contract under /api/v1", async () => {
    const app = createApp({ query: vi.fn() });
    const health = await request(app).get("/api/v1/health");
    const missing = await request(app).get("/api/v1/unknown");

    expect(health.status).toBe(200);
    expect(health.body.data.service).toBe("evently-api");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    expect(missing.body.error.requestId).toBeTruthy();
  });

  it("rejects malformed JSON with a safe client error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createApp({ query: vi.fn() }))
      .post("/api/v1/health")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(response.text).not.toContain("Unexpected end of JSON input");
    expect(log).toHaveBeenCalledOnce();
  });

  it("rejects unsupported form encodings with a safe client error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createApp({ query: vi.fn() }))
      .post("/api/v1/health")
      .set("Content-Type", "application/x-www-form-urlencoded; charset=made-up")
      .send("email=test%40example.com");

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(response.body.error.message).toBe(
      "Request body encoding is not supported",
    );
    expect(response.text).not.toContain("made-up");
    expect(log).toHaveBeenCalledOnce();
  });
});
