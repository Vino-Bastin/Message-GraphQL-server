import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { GraphQLError } from "graphql/error";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { getSession } from "next-auth/react";
import { PubSub } from "graphql-subscriptions";
import { PrismaClient } from "@prisma/client";
// @ts-ignore
import http from "http";
// @ts-ignore
import express, { Request } from "express";
// @ts-ignore
import cors from "cors";
// @ts-ignore
import bodyParser from "body-parser";
import * as dotenv from "dotenv";

import resolvers from "./graphQL/resolvers";
import typeDefs from "./graphQL/typeDefs";

import { ApolloGraphQLContext, Session, SubscriptionContext } from "./types";

// * load env variables
dotenv.config();

const testSession = {
  user: {
    id: "1",
    name: "test",
    email: "",
    image: "",
  },
  expires: "",
};

const main = async () => {
  // * express app instance
  const app = express();
  // * http server instance
  const httpServer = http.createServer(app);
  // * prisma client instance
  const prisma = new PrismaClient();
  // * pubsub instance
  const pubsub = new PubSub();

  // * make executable schema
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  // * web socket server context
  const wsContext = async (
    ctx: SubscriptionContext
  ): Promise<ApolloGraphQLContext> => {
    if (ctx.connectionParams && ctx.connectionParams.session) {
      const session = ctx.connectionParams.session as Session;

      if (session.user) {
        const user = await prisma.user.findUnique({
          where: {
            id: session.user.id,
          },
        });
        if (!user)
          throw new GraphQLError("UnAuthorized", {
            extensions: {
              code: "FORBIDDEN",
            },
          });
        return { session, prisma, pubsub };
      }

      return { session, prisma, pubsub };
    }

    return { session: testSession, prisma, pubsub };
  };

  // * graphql server context
  const graphqlContext = async ({
    req,
  }: {
    req: Request;
  }): Promise<ApolloGraphQLContext> => {
    // * get session from next-auth
    const session = (await getSession({ req })) as Session | null;

    if (!session || !session.user || !session.user.id)
      throw new GraphQLError("UnAuthorized", {
        extensions: {
          code: "FORBIDDEN",
        },
      });

    // * get user from prisma
    const user = await prisma.user.findUnique({
      where: {
        id: session.user.id,
      },
    });

    if (!user)
      throw new GraphQLError("UnAuthorized", {
        extensions: {
          code: "FORBIDDEN",
        },
      });

    return { session, prisma, pubsub };
  };

  // * web socket server instance
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: "/graphql/subscriptions",
  });

  // * use graphql-ws middleware
  const serverCleanup = useServer({ schema, context: wsContext }, wsServer);

  // * apollo server instance
  const server = new ApolloServer<ApolloGraphQLContext>({
    schema,
    csrfPrevention: true,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  });
  // * start apollo server
  await server.start();
  // * apply apollo server middleware to express app
  app.use(
    "/graphql",
    cors<cors.CorsRequest>({
      origin: process.env.CLIENT_URL,
      credentials: true,
    }),
    bodyParser.json(),
    expressMiddleware(server, {
      context: graphqlContext,
    })
  );
  // * start http server
  await new Promise<void>((resolve) =>
    httpServer.listen({ port: process.env.PORT }, resolve)
  );
  console.log("Server ready at http://localhost:4000/graphql");
};

main().catch((error) => {
  console.log(error);
});
