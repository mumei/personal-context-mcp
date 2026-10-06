import { describe, expect, it } from "vitest";
import { syncDataRootReadme, type StartupLogger } from "#infra/startup/syncReadme";

describe("startup", () => {
  it("continues startup when data-root README sync fails", async () => {
    const error = new Error("permission denied");
    const messages: Array<{ message: string; error: unknown }> = [];
    const logger: StartupLogger = (message, loggedError) => {
      messages.push({ message, error: loggedError });
    };

    const result = await syncDataRootReadme(
      {
        ensureDataRootReadme: async () => {
          throw error;
        },
      },
      logger,
    );

    expect(result).toBeUndefined();
    expect(messages).toEqual([
      {
        message: "Failed to sync data-root README:",
        error,
      },
    ]);
  });

  it("returns the save result when data-root README sync succeeds", async () => {
    const result = await syncDataRootReadme(
      {
        ensureDataRootReadme: async () => ({
          changed: true,
          path: "/tmp/tasks/README.md",
        }),
      },
      () => undefined,
    );

    expect(result).toEqual({
      changed: true,
      path: "/tmp/tasks/README.md",
    });
  });
});
