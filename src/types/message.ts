import { Prisma } from "@prisma/client";
import { messagePopulated } from "../graphQL/resolvers/message";

export type MessagePopulated = Prisma.MessageGetPayload<{
  include: typeof messagePopulated;
}>;

export interface MessagesArgs {
  conversationId: string;
}

export interface CreateMessageArgs {
  conversationId: string;
  content: string;
}

export interface MessageCreatedSubscriptionArgs {
  conversationId: string;
}

export interface MessageCreatedSubscriptionPayload {
  messageCreated: MessagePopulated;
}
