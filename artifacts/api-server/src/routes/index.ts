import { Router, type IRouter } from "express";
import healthRouter from "./health";
import papersRouter from "./papers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(papersRouter);

export default router;
