import { beforeEach, describe, expect, it, vi } from "vitest";

const { eqMock, limitMock, selectMock } = vi.hoisted(() => {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    eqMock: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    limitMock: limit,
    selectMock: select,
  };
});

vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("@/db/schema", () => ({
  users: {
    id: "id",
    isAdmin: "is_admin",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: eqMock,
}));

import { createTRPCContext } from "@/server/trpc";

describe("createTRPCContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockResolvedValue([{ isAdmin: false }]);
  });

  it("returns null user when request has no auth headers", async () => {
    const ctx = await createTRPCContext({ headers: new Headers() });

    expect(ctx.user).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("uses DB role instead of forwarded admin claim", async () => {
    limitMock.mockResolvedValue([{ isAdmin: false }]);
    const headers = new Headers({
      "x-user-id": "user-1",
      "x-user-email": "user@example.com",
      "x-user-is-admin": "true",
    });

    const ctx = await createTRPCContext({ headers });

    expect(ctx.user).toEqual({
      id: "user-1",
      email: "user@example.com",
      isAdmin: false,
    });
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns isAdmin=true when DB reports admin", async () => {
    limitMock.mockResolvedValue([{ isAdmin: true }]);
    const headers = new Headers({
      "x-user-id": "admin-1",
      "x-user-email": "admin@example.com",
    });

    const ctx = await createTRPCContext({ headers });

    expect(ctx.user).toEqual({
      id: "admin-1",
      email: "admin@example.com",
      isAdmin: true,
    });
  });
});
