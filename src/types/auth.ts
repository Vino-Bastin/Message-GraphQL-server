import { PrismaClient } from "@prisma/client";
import { PubSub } from "graphql-subscriptions";

export interface User {
  id: string;
  name: string;
  email: string;
  image: string;
}

export interface Session {
  user: User;
  expires: string;
}

export interface ApolloGraphQLContext {
  session: Session;
  prisma: PrismaClient;
  pubsub: PubSub;
}

export interface SubscriptionContext {
  connectionParams: {
    session?: Session;
  };
}
