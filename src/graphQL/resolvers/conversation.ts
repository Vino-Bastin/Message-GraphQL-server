import { GraphQLError } from "graphql/error";
import { Prisma } from "@prisma/client";
import { withFilter } from "graphql-subscriptions";

import {
  ApolloGraphQLContext,
  ConversationPopulated,
  ConversationCreatedSubscriptionPayload,
} from "../../types";
import { CONVERSATION_CREATED } from "./../../util/constant";

const conversationResolvers = {
  Query: {
    conversations: async (
      _parent: any,
      _args: any,
      context: ApolloGraphQLContext,
      _info: any
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
      context: ApolloGraphQLContext,
      _info: any
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
  },
  Subscription: {
    conversationCreated: {
      subscribe: withFilter(
        (
          _parent: any,
          _arg: any,
          context: ApolloGraphQLContext,
          _info: any
        ) => {
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
