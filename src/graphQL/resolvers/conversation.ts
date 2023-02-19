import { GraphQLError } from "graphql/error";
import { Prisma } from "@prisma/client";
import { withFilter } from "graphql-subscriptions";

import {
  ApolloGraphQLContext,
  ConversationPopulated,
  ConversationCreatedSubscriptionPayload,
  ConversationDeletedSubscriptionPayload,
  ConversationUpdatedSubscriptionPayload,
} from "../../types";
import {
  CONVERSATION_CREATED,
  CONVERSATION_UPDATED,
  CONVERSATION_DELETED,
} from "./../../util/constant";

const conversationResolvers = {
  Query: {
    conversations: async (
      _parent: any,
      _args: any,
      context: ApolloGraphQLContext
    ): Promise<Array<ConversationPopulated>> => {
      const { session, prisma } = context;

      // * check if user is authenticated
      if (!session || !session.user) {
        throw new GraphQLError("UnAuthorized", {
          extensions: {
            code: "FORBIDDEN",
          },
        });
      }

      // * get conversations
      try {
        return await prisma.conversation.findMany({
          where: {
            participants: {
              some: {
                userId: session.user.id,
              },
            },
          },
          include: conversationPopulated,
        });
      } catch (error: any) {
        console.log(
          "error getting conversations: ",
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
    createConversation: async (
      _parent: any,
      arg: { participantsIds: string[] },
      context: ApolloGraphQLContext
    ) => {
      const { participantsIds } = arg;
      const { session, prisma, pubsub } = context;

      // * check if user is authenticated
      if (!session || !session.user) {
        throw new GraphQLError("UnAuthorized", {
          extensions: {
            code: "FORBIDDEN",
          },
        });
      }

      // * check if participantsIds has session.id
      if (!participantsIds.includes(session.user.id)) {
        participantsIds.push(session.user.id);
      }

      // * check if participantsIds length is greater than 1
      if (participantsIds.length < 2) {
        throw new GraphQLError(
          "participantsIds length should be greater than 1",
          {
            extensions: {
              code: "BAD_USER_INPUT",
            },
          }
        );
      }

      // * check if conversation already exists for given participantsIds only if participantsIds length is 2
      if (participantsIds.length === 2) {
        const conversation = await prisma.conversation.findFirst({
          where: {
            participants: {
              every: {
                userId: {
                  in: participantsIds,
                },
              },
            },
          },
          include: conversationPopulated,
        });

        if (conversation) {
          return {
            conversationId: conversation.id,
          };
        }
      }

      // * create conversation
      try {
        const conversation = await prisma.conversation.create({
          data: {
            participants: {
              createMany: {
                data: participantsIds.map((participantId) => ({
                  userId: participantId,
                  hasSeenLatestMessage: participantId === session.user.id,
                })),
              },
            },
          },
          include: conversationPopulated,
        });

        // * publish conversation created event
        pubsub.publish(CONVERSATION_CREATED, {
          conversationCreated: conversation,
        });

        return {
          conversationId: conversation.id,
        };
      } catch (e) {
        console.log("error occurred in createConversation function", e);
        throw new GraphQLError("error occurred in createConversation function");
      }
    },

    markConversationAsRead: async (
      _parent: any,
      arg: { conversationId: string },
      context: ApolloGraphQLContext
    ) => {
      const { conversationId } = arg;
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
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          participants: {
            some: {
              userId: session.user.id,
            },
          },
        },
      });

      if (!conversation) {
        throw new GraphQLError("Conversation not found", {
          extensions: {
            code: "NOT_FOUND",
          },
        });
      }

      // * update conversation
      try {
        await prisma.conversationParticipant.updateMany({
          where: {
            conversationId,
            userId: session.user.id,
          },
          data: {
            hasSeenLatestMessage: true,
          },
        });

        return true;
      } catch (error: any) {
        console.log(
          "error occurred in markConversationAsRead function: ",
          error.message
        );
        throw new GraphQLError(
          "error occurred in markConversationAsRead function"
        );
      }
    },

    deleteConversation: async (
      _parent: any,
      arg: { conversationId: string },
      context: ApolloGraphQLContext
    ) => {
      const { conversationId } = arg;
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
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          participants: {
            some: {
              userId: session.user.id,
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

      // * delete conversation
      try {
        await prisma.$transaction([
          prisma.conversation.delete({
            where: {
              id: conversationId,
            },
          }),
          prisma.conversationParticipant.deleteMany({
            where: {
              conversationId,
            },
          }),
          prisma.message.deleteMany({
            where: {
              conversationId,
            },
          }),
        ]);

        // * publish conversation deleted event
        pubsub.publish(CONVERSATION_DELETED, {
          conversationDeleted: conversation,
        });

        return true;
      } catch (error: any) {
        console.log(
          "error occurred in deleteConversation function: ",
          error.message
        );
        throw new GraphQLError("error occurred in deleteConversation function");
      }
    },

    updateConversation: async (
      _parent: any,
      arg: { conversationId: string; participantsIds: Array<string> },
      context: ApolloGraphQLContext
    ) => {
      const { conversationId, participantsIds } = arg;
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
      const conversationParticipant =
        await prisma.conversationParticipant.findMany({
          where: {
            conversationId,
            userId: session.user.id,
          },
        });

      if (!conversationParticipant || !conversationParticipant.length) {
        throw new GraphQLError("Conversation not found", {
          extensions: {
            code: "NOT_FOUND",
          },
        });
      }

      // * existing participants
      const existingParticipants = conversationParticipant.map(
        (participant) => participant.userId
      );

      // * participants to be added
      const participantsToAdd = participantsIds.filter(
        (participantId) => !existingParticipants.includes(participantId)
      );

      // * participants to be removed
      const participantsToRemove = existingParticipants.filter(
        (participantId) => !participantsIds.includes(participantId)
      );

      // * update conversation

      try {
        const updateTransaction = [
          prisma.conversation.update({
            where: {
              id: conversationId,
            },
            data: {
              participants: {
                deleteMany: {
                  userId: {
                    in: participantsToRemove,
                  },
                },
              },
            },
            include: conversationPopulated,
          }),
        ];

        if (participantsToAdd.length) {
          updateTransaction.push(
            prisma.conversation.update({
              where: {
                id: conversationId,
              },
              data: {
                participants: {
                  createMany: {
                    data: participantsToAdd.map((participantId) => ({
                      userId: participantId,
                    })),
                  },
                },
              },
              include: conversationPopulated,
            })
          );
        }

        const [deleteResult, updateResult] = await prisma.$transaction(
          updateTransaction
        );

        // * publish conversation created event
        const updatedConversation = updateResult || deleteResult;

        pubsub.publish(CONVERSATION_UPDATED, {
          conversationUpdated: {
            conversation: updatedConversation,
            participantsToAdd,
            participantsToRemove,
          },
        });

        return true;
      } catch (error: any) {
        console.log(
          "error occurred in updateConversation function: ",
          error.message
        );
        throw new GraphQLError("error occurred in updateConversation function");
      }
    },
  },
  Subscription: {
    conversationCreated: {
      subscribe: withFilter(
        (_parent: any, _arg: any, context: ApolloGraphQLContext) => {
          const { pubsub } = context;
          return pubsub.asyncIterator([CONVERSATION_CREATED]);
        },
        (
          payload: ConversationCreatedSubscriptionPayload,
          _,
          context: ApolloGraphQLContext
        ) => {
          const { session } = context;

          // * check if user is authenticated
          if (!session || !session.user) {
            throw new GraphQLError("UnAuthorized", {
              extensions: {
                code: "FORBIDDEN",
              },
            });
          }

          const { participants } = payload.conversationCreated;

          return !!participants.find(
            (participant) => participant.userId === session.user.id
          );
        }
      ),
    },

    conversationDeleted: {
      subscribe: withFilter(
        (_parent: any, _arg: any, context: ApolloGraphQLContext) => {
          const { pubsub } = context;

          return pubsub.asyncIterator([CONVERSATION_DELETED]);
        },
        (
          payload: ConversationDeletedSubscriptionPayload,
          _args: any,
          context: ApolloGraphQLContext
        ) => {
          const { session } = context;

          // * check if user is authenticated
          if (!session || !session.user) {
            throw new GraphQLError("UnAuthorized", {
              extensions: {
                code: "FORBIDDEN",
              },
            });
          }

          return !!payload.conversationDeleted.participants.find(
            (participant) => participant.userId === session.user.id
          );
        }
      ),
    },

    conversationUpdated: {
      subscribe: withFilter(
        (_parent: any, _arg: any, context: ApolloGraphQLContext) => {
          const { pubsub } = context;

          return pubsub.asyncIterator([CONVERSATION_UPDATED]);
        },
        (
          payload: ConversationUpdatedSubscriptionPayload,
          _: any,
          context: ApolloGraphQLContext
        ) => {
          const { session } = context;

          const { participantsToAdd, participantsToRemove } =
            payload.conversationUpdated;

          // * check if user is authenticated
          if (!session || !session.user) {
            throw new GraphQLError("UnAuthorized", {
              extensions: {
                code: "FORBIDDEN",
              },
            });
          }

          const userIsParticipant =
            !!payload.conversationUpdated.conversation.participants.find(
              (participant) => participant.userId === session.user.id
            );

          const userIsRemoved =
            participantsToRemove &&
            !!participantsToRemove.find((id) => id === session.user.id);

          return userIsParticipant || userIsRemoved;
        }
      ),
    },
  },
};

// * populate conversation with participants
export const participantPopulated =
  Prisma.validator<Prisma.ConversationParticipantInclude>()({
    user: {
      select: {
        id: true,
        name: true,
        image: true,
      },
    },
  });

// * populate conversation with participants and latestMessage
export const conversationPopulated =
  Prisma.validator<Prisma.ConversationInclude>()({
    participants: {
      include: participantPopulated,
    },
    latestMessage: {
      include: {
        sender: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
  });

export default conversationResolvers;
