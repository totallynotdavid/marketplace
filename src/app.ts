import { Hono } from "hono";
import type { AppEnv } from "./env.ts";
import { notFound, serverError } from "./http.tsx";
import { loadUser, requireUser, sameOrigin, securityHeaders } from "./middleware.tsx";
import { adminRoutes } from "./routes/admin.tsx";
import { authRoutes } from "./routes/auth.tsx";
import { listingRoutes } from "./routes/listings.tsx";
import { offerRoutes } from "./routes/offers.tsx";

export const app = new Hono<AppEnv>();

app.use(securityHeaders);
app.use(sameOrigin);
app.use(loadUser);

app.route("/", authRoutes);

// Every route registered below this line requires a signed-in user. Routes are public only when
// they are registered above this middleware.
app.use(requireUser);

app.route("/", listingRoutes);
app.route("/", offerRoutes);
app.route("/", adminRoutes);

app.notFound((c) => notFound(c));

app.onError((error, c) => {
  console.error(error);
  return serverError(c);
});
