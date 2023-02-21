import { Prisma } from "@prisma/client";
import { GraphQLError } from "graphql";
import { withFilter } from "graphql-subscriptions";

import {
  ApolloGraphQLContext,
  CreateMessageArgs,
  MessageCreatedSubscriptionArgs,
  MessageCreatedSubscriptionPayload,
  MessagesArgs,
} from "../../types";
import { conversationPopulated } from "./conversation";
import { MESSAGE_CREATED, CONVERSATION_UPDATED } from "./../../util/constant";
import { isConversationExists } from "../../util/functions";

const messageResolvers = {
  Query: {
    messages: async (
      _parent: any,
      args: MessagesArgs,
      context: ApolloGraphQLContext,
      _info: any
    ) => {
      const { conversationId } = args;
      const { session, prisma } = context;

      // * check if conversation exists
      const _ = await isConversationExists(
        conversationId,
        session.user.id,
        prisma
      );

      // * get messages
      try {
        return await prisma.message.findMany({
          where: {
            conversationId,
          },
          include: messagePopulated,
          orderBy: {
            createdAt: "asc",
          },
        });
      } catch (error: any) {
        console.log("Error Getting Messages: ", error);
        throw new GraphQLError("Error Getting Messages", {
          extensions: {
            code: "INTERNAL_SERVER_ERROR",
          },
        });
      }
    },
  },
  Mutation: {
    createMessage: async (
      _parent: any,
      args: CreateMessageArgs,
      context: ApolloGraphQLContext,
      _info: any
    ) => {
      const { conversationId, content } = args;
      const { session, prisma, pubsub } = context;

      // * check if conversation exists
      const conversation = await isConversationExists(
        conversationId,
        session.user.id,
        prisma
      );

      // * check if user is a participant of the conversation
      let userParticipantId: string = "";
      for (let participant of conversation.participants) {
        if (participant.userId === session.user.id) {
          userParticipantId = participant.id;
          break;
        }
      }

      // * create message
      try {
        const message = await prisma.message.create({
          data: {
            content,
            conversationId,
            senderId: session.user.id,
          },
          include: messagePopulated,
        });

        const updatedConversation = await prisma.conversation.update({
          where: {
            id: conversationId,
          },
          data: {
            latestMessageId: message.id,
            participants: {
              update: {
                where: {
                  id: userParticipantId,
                },
                data: {
                  hasSeenLatestMessage: true,
                },
              },
              updateMany: {
                where: {
                  NOT: {
                    userId: session.user.id,
                  },
                },
                data: {
                  hasSeenLatestMessage: false,
                },
              },
            },
          },
          include: conversationPopulated,
        });

        pubsub.publish(MESSAGE_CREATED, {
          messageCreated: message,
        });

        pubsub.publish(CONVERSATION_UPDATED, {
          conversationUpdated: { conversation: updatedConversation },
        });

        return true;
      } catch (error: any) {
        console.log("Error Creating Message: ", error);
        throw new GraphQLError("Error creating Message", {
          extensions: {
            code: "INTERNAL_SERVER_ERROR",
          },
        });
      }
    },
  },
  Subscription: {
    messageCreated: {
      subscribe: withFilter(
        (_parent: any, _args: any, context: ApolloGraphQLContext) => {
          const { pubsub } = context;

          return pubsub.asyncIterator([MESSAGE_CREATED]);
        },
        async (
          payload: MessageCreatedSubscriptionPayload,
          args: MessageCreatedSubscriptionArgs,
          _context: ApolloGraphQLContext
        ) => {
          return payload.messageCreated.conversationId === args.conversationId;
        }
      ),
    },
  },
};

// * message populated
export const messagePopulated = Prisma.validator<Prisma.MessageInclude>()({
  sender: {
    select: {
      id: true,
      name: true,
      image: true,
    },
  },
});

export default messageResolvers;
