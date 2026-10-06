import { describe, expect, it } from "vitest";
import { initialRouteToRestore, readWebRequestContext } from "#webUi/navigation/requestContext";

function documentWithContext(text?: string): Document {
  return {
    getElementById: () => (text === undefined ? null : { textContent: text }),
  } as unknown as Document;
}

describe("Web request context", () => {
  it("reads valid embedded route diagnostics", () => {
    const documentValue = documentWithContext(
      '{"requested_path":"/report/text","requested_search":"?date=2026-07-17","requested_route":"/report/text?date=2026-07-17","route_debug":true}',
    );

    expect(readWebRequestContext(documentValue)).toEqual({
      requested_path: "/report/text",
      requested_search: "?date=2026-07-17",
      requested_route: "/report/text?date=2026-07-17",
      route_debug: true,
    });
  });

  it("ignores missing or invalid embedded data", () => {
    expect(readWebRequestContext(documentWithContext())).toBeNull();
    expect(readWebRequestContext(documentWithContext('{"route_debug":true}'))).toBeNull();
  });

  it("restores an allowlisted server route when an intermediary changed the browser route", () => {
    const context = {
      requested_path: "/report/text",
      requested_search: "?date=2026-07-17&route_debug=1",
      requested_route: "/report/text?date=2026-07-17&route_debug=1",
      route_debug: true,
    };

    expect(initialRouteToRestore(context, "/summary?date=2026-07-17&route_debug=1")).toBe(
      "/report/text?date=2026-07-17&route_debug=1",
    );
    expect(initialRouteToRestore(context, context.requested_route)).toBeNull();
  });

  it("does not restore unknown or unsafe server paths", () => {
    expect(
      initialRouteToRestore(
        {
          requested_path: "//external.example.com",
          requested_search: "",
          requested_route: "//external.example.com",
          route_debug: true,
        },
        "/summary",
      ),
    ).toBeNull();
  });
});
