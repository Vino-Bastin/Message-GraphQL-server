import gql from "graphql-tag";

const messageTypeDefs = gql`
  type Message {
    id: String
    conversation: Conversation
    sender: User
    content: String
    createdAt: Date
  }

  type Query {
    messages(conversationId: String!): [Message]
  }

  type Mutation {
    createMessage(conversationId: String!, content: String!): Boolean
  }

  type Subscription {
    messageCreated(conversationId: String!): Message
  }
`;

export default messageTypeDefs;
