import { Hono } from "hono";

const apiRouter = new Hono();

// Route files will be mounted here in Phase 3+ (T021, T032, T038)
// e.g. apiRouter.route("/projects", projectsRouter);

apiRouter.get("/", (c) => {
  return c.json({ status: "ok" });
});

export default apiRouter;
