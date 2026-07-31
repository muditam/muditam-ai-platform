import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import {
  askChatQuestionSchema,
  createConversationSchema,
} from "../../contracts/chat.js";
import { MetabolicAssistantError } from "../../contracts/errors.js";
import type { DiabetesChatOperations } from "../../services/diabetes-chat-service.js";

function queryUserId(request: Request): string {
  const userId =
    typeof request.query.userId === "string"
      ? request.query.userId.trim()
      : "";
  if (userId.length === 0) {
    throw new MetabolicAssistantError(
      "INVALID_CHAT_QUESTION",
      "userId is required as a query parameter.",
      { status: 400 },
    );
  }
  return userId;
}

export class ChatController {
  constructor(private readonly chat: DiabetesChatOperations) {}

  createConversation = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = createConversationSchema.parse(request.body);
      const conversation = await this.chat.createConversation(body.userId);
      response.status(201).json({
        ok: true,
        data: { conversation },
        error: null,
        requestId: String(response.locals.requestId),
      });
    } catch (error) {
      next(this.normalizeInputError(error));
    }
  };

  listConversations = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const conversations = await this.chat.listConversations(
        queryUserId(request),
      );
      response.json({
        ok: true,
        data: { conversations },
        error: null,
        requestId: String(response.locals.requestId),
      });
    } catch (error) {
      next(error);
    }
  };

  ask = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = askChatQuestionSchema.parse(request.body);
      const result = await this.chat.ask({
        conversationId: String(request.params.conversationId),
        userId: body.userId,
        question: body.question,
      });
      response.json({
        ok: true,
        data: result,
        error: null,
        requestId: String(response.locals.requestId),
      });
    } catch (error) {
      next(this.normalizeInputError(error));
    }
  };

  history = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.chat.history({
        conversationId: String(request.params.conversationId),
        userId: queryUserId(request),
      });
      response.json({
        ok: true,
        data: result,
        error: null,
        requestId: String(response.locals.requestId),
      });
    } catch (error) {
      next(error);
    }
  };

  private normalizeInputError(error: unknown): unknown {
    return error instanceof ZodError
      ? new MetabolicAssistantError(
          "INVALID_CHAT_QUESTION",
          "userId and question are required.",
          { status: 400, cause: error },
        )
      : error;
  }
}
