import { Router } from "express";
import { ChatController } from "../controllers/chat-controller.js";

export function createChatRouter(controller: ChatController): Router {
  const router = Router();
  router.post("/:reportId/chat", controller.ask);
  router.get(
    "/:reportId/chat/:conversationId",
    controller.history,
  );
  return router;
}
