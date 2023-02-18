import gql from "graphql-tag";

const userTypeDefs = gql`
  scalar Date

  type User {
    id: String
    name: String
    image: String
    email: String
    emailVerified: Date
  }

  type Query {
    searchUsers(name: String!): [User]
  }
`;

export default userTypeDefs;
