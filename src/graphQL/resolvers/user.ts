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
      } catch (error) {
        console.log("error occurred in searchUsers function", error);
        throw new GraphQLError("Unable to get users");
      }
    },
  },
};

export default userResolvers;
