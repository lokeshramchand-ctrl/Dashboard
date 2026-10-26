import { EventEmitter } from 'node:events';
import { MongoClient } from 'mongodb';
import type { Db, ObjectId } from 'mongodb';
import { cfg } from './config.js';

export interface UserDoc { _id: ObjectId; username: string; passwordHash: string; createdAt: Date; lastLoginAt?: Date; ssoSub?: string }
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

export interface EventDoc {
  ts: Date; level: 'info' | 'warn' | 'error'; source: 'app' | 'db' | 'host' | 'guest' | 'monitor' | 'auth'; message: string;
  data?: Record<string, unknown>; expireAt: Date;
}
export interface StateDoc { _id: string; value: Record<string, unknown> }
export interface OidcStateDoc { _id: string; verifier: string; nonce: string; expireAt: Date }

let client: MongoClient;
let database: Db;

/** Fired on every Mongo up/down transition seen by the driver's heartbeat monitor. */
export const dbHealth = new EventEmitter();

export async function connectDb(): Promise<Db> {
  client = new MongoClient(cfg.mongoUri, { serverSelectionTimeoutMS: 8000 });
  let healthy: boolean | undefined;
  const mark = (ok: boolean, detail?: string) => {
    if (healthy === ok) return;
    const was = healthy;
    healthy = ok;
    if (was !== undefined) dbHealth.emit('change', ok, detail);
  };
  client.on('serverHeartbeatSucceeded', () => mark(true));
  client.on('serverHeartbeatFailed', (e) => mark(false, e.failure?.message));
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
    col.events().createIndex({ ts: -1 }),
    col.events().createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
    col.oidc().createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
    col.users().createIndex({ ssoSub: 1 }, { unique: true, sparse: true }),
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
  events: () => database.collection<EventDoc>('system_events'),
  state: () => database.collection<StateDoc>('system_state'),
  oidc: () => database.collection<OidcStateDoc>('oidc_states'),
};
