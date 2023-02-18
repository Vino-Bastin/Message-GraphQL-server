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

      // * check if user is authenticated
      if (!session || !session.user) {
        throw new GraphQLError("UnAuthorized", {
          extensions: {
            code: "FORBIDDEN",
          },
        });
      }

      // * check if conversation exists
      const conversation = await prisma.conversation.findUnique({
        where: {
          id: conversationId,
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

      // * check if user is a participant of the conversation
      const isParticipant = conversation.participants.find(
        (participant) => participant.userId === session.user.id
      );

      if (!isParticipant) {
        throw new GraphQLError("UnAuthorized", {
          extensions: {
            code: "FORBIDDEN",
          },
        });
      }

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
        console.log(
          "error getting messages: ",
          error.message,
          "user id: ",
          session.user.id
        );
        throw new GraphQLError(error.message, {
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

      // * check if user is authenticated
      if (!session || !session.user) {
        throw new GraphQLError("UnAuthorized", {
          extensions: {
            code: "FORBIDDEN",
          },
        });
      }

      // * check if conversation exists
      const conversation = await prisma.conversation.findUnique({
        where: {
          id: conversationId,
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

      // * check if user is a participant of the conversation
      let isParticipant: boolean = false;
      let userParticipant: string = "";
      for (let participant of conversation.participants) {
        if (participant.userId === session.user.id) {
          isParticipant = true;
          userParticipant = participant.id;
          break;
        }
      }

      if (!isParticipant) {
        throw new GraphQLError("UnAuthorized", {
          extensions: {
            code: "FORBIDDEN",
          },
        });
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
                  id: userParticipant,
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
          conversationUpdated: updatedConversation,
        });

        return true;
      } catch (error: any) {
        console.log(
          "error creating message: ",
          error.message,
          "user id: ",
          session.user.id
        );
        throw new GraphQLError(error.message, {
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
