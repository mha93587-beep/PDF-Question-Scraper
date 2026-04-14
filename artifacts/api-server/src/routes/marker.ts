import { Router, type IRouter } from "express";
import { checkMarkerHealth } from "../lib/marker.js";

const router: IRouter = Router();

router.get("/marker/health", async (_req, res): Promise<void> => {
  try {
    const health = await checkMarkerHealth();
    res.json({
      configured: true,
      status: health.status,
    });
  } catch (err) {
    res.status(503).json({
      configured: false,
      status: "unavailable",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;