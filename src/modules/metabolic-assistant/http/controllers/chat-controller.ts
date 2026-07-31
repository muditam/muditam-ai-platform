import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { askChatQuestionSchema } from "../../contracts/chat.js";
import { MetabolicAssistantError } from "../../contracts/errors.js";
import type { DiabetesChatOperations } from "../../services/diabetes-chat-service.js";

export class ChatController {
  constructor(private readonly chat: DiabetesChatOperations) {}

  ask = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = askChatQuestionSchema.parse(request.body);
      const result = await this.chat.ask({
        reportId: String(request.params.reportId),
        userId: body.userId,
        question: body.question,
        ...(body.conversationId === undefined
          ? {}
          : { conversationId: body.conversationId }),
        ...(body.reportIds === undefined
          ? {}
          : { reportIds: body.reportIds }),
      });
      response.json({
        ok: true,
        data: result,
        error: null,
        requestId: String(response.locals.requestId),
      });
    } catch (error) {
      next(
        error instanceof ZodError
          ? new MetabolicAssistantError(
              "INVALID_CHAT_QUESTION",
              "userId and question are required. conversationId and reportIds are optional.",
              { status: 400, cause: error },
            )
          : error,
      );
    }
  };

  history = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
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
      const result = await this.chat.history({
        reportId: String(request.params.reportId),
        conversationId: String(request.params.conversationId),
        userId,
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
}
