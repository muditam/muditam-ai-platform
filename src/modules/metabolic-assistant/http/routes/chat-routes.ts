import { Router } from "express";
import { ChatController } from "../controllers/chat-controller.js";

export function createChatRouter(controller: ChatController): Router {
  const router = Router();
  router.post("/conversations", controller.createConversation);
  router.get("/conversations", controller.listConversations);
  router.post(
    "/conversations/:conversationId/messages",
    controller.ask,
  );
  router.get(
    "/conversations/:conversationId",
    controller.history,
  );
  router.delete("/conversations/:conversationId", controller.deleteConversation);
  return router;
}
