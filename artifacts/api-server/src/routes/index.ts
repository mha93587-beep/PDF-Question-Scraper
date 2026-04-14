import { Router, type IRouter } from "express";
import healthRouter from "./health";
import papersRouter from "./papers";
import storageRouter from "./storage";
import batchRouter from "./batch";
import aiExtractRouter from "./ai-extract";
import markerRouter from "./marker";

const router: IRouter = Router();

router.use(healthRouter);
router.use(papersRouter);
router.use(storageRouter);
router.use(batchRouter);
router.use(aiExtractRouter);
router.use(markerRouter);

export default router;
