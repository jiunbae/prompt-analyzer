import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

async function resolveIsAdmin(userId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ isAdmin: schema.users.isAdmin })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return !!row?.isAdmin;
  } catch {
    // Fail closed on role lookup.
    return false;
  }
}

/**
 * Context creation for tRPC
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const userId = opts.headers.get("x-user-id");
  const email = opts.headers.get("x-user-email");

  if (!userId) {
    return { headers: opts.headers, user: null };
  }

  let cachedIsAdmin: boolean | undefined;
  return {
    headers: opts.headers,
    user: {
      id: userId,
      email,
      get isAdmin() {
        return cachedIsAdmin;
      },
      resolveIsAdmin: async () => {
        if (cachedIsAdmin === undefined) {
          cachedIsAdmin = await resolveIsAdmin(userId);
        }
        return cachedIsAdmin;
      },
    },
  };
};

/**
 * Initialize tRPC
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

const isAdmin = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const admin = await ctx.user.resolveIsAdmin();
  if (!admin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

/**
 * Export reusable router and procedure helpers
 */
export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthed);
export const adminProcedure = t.procedure.use(isAdmin);
