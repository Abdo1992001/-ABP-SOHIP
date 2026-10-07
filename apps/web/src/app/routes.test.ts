import { describe, expect, it } from "vitest";
import { routes } from "./routes.ts";

describe("Sales-first route composition", () => {
  it("keeps Sales Management and Sales Support inside Sales", () => {
    const management = routes.find((route) => route.kind === "management");
    const support = routes.find((route) => route.kind === "support");

    expect(management?.workspace).toBe("sales");
    expect(management?.path.startsWith("/sales/")).toBe(true);
    expect(support?.workspace).toBe("sales");
    expect(support?.path.startsWith("/sales/")).toBe(true);
  });

  it("does not expose unimplemented isolated workspaces as functional navigation", () => {
    const isolated = routes.filter((route) => route.kind === "isolated");
    expect(isolated).toEqual([]);
    expect(isolated.every((route) => !route.path.startsWith("/sales/"))).toBe(
      true,
    );
  });

  it("makes every navigation route permission-addressable for direct-link denial", () => {
    expect(routes.every((route) => route.permission.length > 0)).toBe(true);
    expect(
      routes.find((route) => route.path === "/sales/products")?.permission,
    ).toBe("catalog.view");
  });
});
