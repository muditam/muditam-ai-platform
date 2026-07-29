import mongoose, { type Connection } from "mongoose";

export interface ConnectMetabolicDatabaseOptions {
  serverSelectionTimeoutMs?: number;
}

export async function connectMetabolicDatabase(
  uri: string,
  options: ConnectMetabolicDatabaseOptions = {},
): Promise<Connection> {
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMs ?? 10_000,
  });

  return connection.asPromise();
}

export async function closeMetabolicDatabase(
  connection: Connection,
): Promise<void> {
  await connection.close();
}
