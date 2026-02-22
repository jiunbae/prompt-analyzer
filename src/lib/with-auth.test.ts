import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookiesMock,
  parseSessionTokenMock,
  eqMock,
  limitMock,
  selectMock,
} = vi.hoisted(() => {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    cookiesMock: vi.fn(),
    parseSessionTokenMock: vi.fn(),
    eqMock: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    limitMock: limit,
    selectMock: select,
  };
});

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "auth_session",
  parseSessionToken: parseSessionTokenMock,
}));

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

import { requireAdmin, requireAuth } from "@/lib/with-auth";

describe("with-auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockResolvedValue([{ isAdmin: false }]);
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => ({ value: "token" })),
    });
    parseSessionTokenMock.mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
      token: "api-token",
      isAdmin: false,
    });
  });

  it("returns 401 when no session cookie is present", async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn(() => undefined) });

    await expect(requireAuth()).rejects.toMatchObject({
      name: "AuthError",
      message: "Not authenticated",
      status: 401,
    });
  });

  it("returns 401 when session token is invalid", async () => {
    parseSessionTokenMock.mockReturnValue(null);

    await expect(requireAuth()).rejects.toMatchObject({
      name: "AuthError",
      message: "Invalid session",
      status: 401,
    });
  });

  it("returns 403 when authenticated user is not admin in DB", async () => {
    limitMock.mockResolvedValue([{ isAdmin: false }]);

    await expect(requireAdmin()).rejects.toMatchObject({
      name: "AuthError",
      message: "Admin access required",
      status: 403,
    });
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(eqMock).toHaveBeenCalled();
  });

  it("allows admin when DB says isAdmin=true", async () => {
    limitMock.mockResolvedValue([{ isAdmin: true }]);

    await expect(requireAdmin()).resolves.toMatchObject({
      userId: "user-1",
      email: "user@example.com",
    });
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});
