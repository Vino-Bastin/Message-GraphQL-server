import { PrismaClient } from "@prisma/client";
import { GraphQLError } from "graphql";
import { conversationPopulated } from "../graphQL/resolvers/conversation";

import {
  ConversationParticipantPopulated,
  ConversationPopulated,
} from "../types";

export const isUserPartOfConversation = (
  participants: Array<ConversationParticipantPopulated>,
  userId: string
): boolean => {
  return !!participants.find((participant) => participant.user.id === userId);
};

export const getValidParticipantIds = (
  participants: Array<string>,
  userId: string
): Array<string> => {
  if (participants.includes(userId)) {
    return participants;
  }

  if (participants.length === 0) {
    throw new GraphQLError("Conversation must have at least one participant", {
      extensions: {
        code: "BAD_USER_INPUT",
      },
    });
  }

  return [...participants, userId];
};

export const isConversationExists = async (
  conversationId: string,
  userId: string,
  prisma: PrismaClient
): Promise<ConversationPopulated> => {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      participants: {
        some: {
          userId,
        },
      },
    },
    include: conversationPopulated,
  });

  if (!conversation) {
    throw new GraphQLError("Conversation not found", {
      extensions: {
        code: "NOT_FOUND",
      },
    });
  }

  return conversation;
};
