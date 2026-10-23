import { MongoClient } from 'mongodb';
import type { Db, ObjectId } from 'mongodb';
import { cfg } from './config.js';

export interface UserDoc { _id: ObjectId; username: string; passwordHash: string; createdAt: Date; lastLoginAt?: Date }
export interface SessionDoc { _id: ObjectId; tokenHash: string; userId: ObjectId; username: string; createdAt: Date; expiresAt: Date; ip: string; userAgent: string }
export interface AttemptDoc { _id: string; count: number; expireAt: Date }
export interface AuditDoc {
  ts: Date; user: string; ip: string; vmid: number; name?: string; action: string;
  result: 'accepted' | 'refused' | 'error'; taskId?: string; reason?: string;
}
export interface SampleDoc {
  monitorKey: string; name: string; url: string; type: string;
  status: 'up' | 'down' | 'pending' | 'maintenance'; ping: number | null; ts: Date; expireAt: Date;
}

let client: MongoClient;
let database: Db;

export async function connectDb(): Promise<Db> {
  client = new MongoClient(cfg.mongoUri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  database = client.db(cfg.mongoDb);
  await Promise.all([
    col.users().createIndex({ username: 1 }, { unique: true }),
    col.sessions().createIndex({ tokenHash: 1 }, { unique: true }),
    col.sessions().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    col.attempts().createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
    col.audit().createIndex({ ts: -1 }),
    col.samples().createIndex({ monitorKey: 1, ts: -1 }),
    col.samples().createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
  return database;
}

export const closeDb = () => client?.close();

export const col = {
  users: () => database.collection<UserDoc>('users'),
  sessions: () => database.collection<SessionDoc>('sessions'),
  attempts: () => database.collection<AttemptDoc>('login_attempts'),
  audit: () => database.collection<AuditDoc>('audit'),
  samples: () => database.collection<SampleDoc>('kuma_samples'),
};
