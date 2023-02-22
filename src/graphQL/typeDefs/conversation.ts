import gql from "graphql-tag";

const conversationTypeDefs = gql`
  type Conversation {
    id: String
    participants: [Participant]
    latestMessage: Message
    updatedAt: Date
  }

  type Participant {
    id: String
    user: User
    hasSeenLatestMessage: Boolean
  }

  type CreateConversationResponse {
    conversationId: String
    isCreated: Boolean
  }

  type ConversationUpdateResponse {
    conversation: Conversation
    participantsToAdd: [String]
    participantsToRemove: [String]
  }

  type Query {
    conversations: [Conversation]
  }

  type Mutation {
    createConversation(participantsIds: [String]!): CreateConversationResponse
  }

  type Mutation {
    markConversationAsRead(conversationId: String!): Boolean
  }

  type Mutation {
    updateConversation(
      conversationId: String!
      participantsIds: [String]!
    ): Boolean
  }

  type Mutation {
    deleteConversation(conversationId: String!): Boolean
  }

  type Subscription {
    conversationCreated: Conversation
  }

  type Subscription {
    conversationUpdated: ConversationUpdateResponse
  }

  type Subscription {
    conversationOnDeleted: Conversation
  }
`;

export default conversationTypeDefs;
