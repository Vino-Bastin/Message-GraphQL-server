import { Prisma } from "@prisma/client";
import {
  conversationPopulated,
  participantPopulated,
} from "../graphQL/resolvers/conversation";

export type ConversationPopulated = Prisma.ConversationGetPayload<{
  include: typeof conversationPopulated;
}>;

export type ConversationParticipantPopulated =
  Prisma.ConversationParticipantGetPayload<{
    include: typeof participantPopulated;
  }>;

export interface ConversationCreatedSubscriptionPayload {
  conversationCreated: ConversationPopulated;
}