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
import {
  isUserPartOfConversation,
  getValidParticipantIds,
  isConversationExists,
} from "../../util/functions";

const conversationResolvers = {
  Query: {
    conversations: async (
      _parent: any,
      _args: any,
      context: ApolloGraphQLContext
    ): Promise<Array<ConversationPopulated>> => {
      const { session, prisma } = context;

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
        console.log("error getting conversations: ", error);
        throw new GraphQLError("Error Creating Conversation", {
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
      const { session, prisma, pubsub } = context;

      // * check if participantsIds has session.id
      const participantsIds = getValidParticipantIds(
        arg.participantsIds,
        session.user.id
      );

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
            isCreated: false,
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
          isCreated: true,
        };
      } catch (error) {
        console.log("error occurred in createConversation function", error);
        throw new GraphQLError("Error Creating Conversation");
      }
    },

    markConversationAsRead: async (
      _parent: any,
      arg: { conversationId: string },
      context: ApolloGraphQLContext
    ) => {
      const { conversationId } = arg;
      const { session, prisma } = context;

      // * check if conversation exists
      const _ = await isConversationExists(
        conversationId,
        session.user.id,
        prisma
      );

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
          error
        );
        throw new GraphQLError("Error Marking conversation as read");
      }
    },

    deleteConversation: async (
      _parent: any,
      arg: { conversationId: string },
      context: ApolloGraphQLContext
    ) => {
      const { conversationId } = arg;
      const { session, prisma, pubsub } = context;

      // * check if conversation exists
      const conversation = await isConversationExists(
        conversationId,
        session.user.id,
        prisma
      );

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
          conversationOnDeleted: conversation,
        });

        return true;
      } catch (error: any) {
        console.log("error occurred in deleteConversation function: ", error);
        throw new GraphQLError("Error Deleting Conversation");
      }
    },

    updateConversation: async (
      _parent: any,
      arg: { conversationId: string; participantsIds: Array<string> },
      context: ApolloGraphQLContext
    ) => {
      const { conversationId } = arg;
      const { session, prisma, pubsub } = context;

      const participantsIds = getValidParticipantIds(
        arg.participantsIds,
        session.user.id
      );

      // * check if conversation exists
      const conversation = await isConversationExists(
        conversationId,
        session.user.id,
        prisma
      );

      // * existing participants
      const existingParticipants = conversation.participants.map(
        (participant) => participant.user.id
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
        throw new GraphQLError("Error Updating Conversation");
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
          const { participants } = payload.conversationCreated;

          return isUserPartOfConversation(participants, session.user.id);
        }
      ),
    },

    conversationOnDeleted: {
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
          const { participants } = payload.conversationOnDeleted;

          return isUserPartOfConversation(participants, session.user.id);
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
          const {
            participantsToRemove,
            conversation: { participants },
          } = payload.conversationUpdated;

          const userIsParticipant = isUserPartOfConversation(
            participants,
            session.user.id
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
