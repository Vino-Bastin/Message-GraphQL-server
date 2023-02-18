import { User } from "@prisma/client";
import { GraphQLError } from "graphql/error";
import { ApolloGraphQLContext } from "../../types";

const userResolvers = {
  Query: {
    searchUsers: async (
      _parent: any,
      args: { name: string },
      context: ApolloGraphQLContext,
      _info: any
    ): Promise<Array<User>> => {
      const { name: searchUserName } = args;
      const { session, prisma } = context;

      if (!session || !session.user) {
        throw new GraphQLError("UnAuthorized", {
          extensions: {
            code: "FORBIDDEN",
          },
        });
      }

      try {
        return await prisma.user.findMany({
          where: {
            name: {
              contains: searchUserName,
              not: session.user.name,
              mode: "insensitive",
            },
          },
        });
      } catch (e) {
        console.log("error occurred in searchUsers function", e);
        throw new GraphQLError("error occurred in searchUsers function");
      }
    },
  },
};

export default userResolvers;
