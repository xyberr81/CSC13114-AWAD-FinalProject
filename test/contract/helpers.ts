import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

/**
 * Contract tests talk HTTP only. Against a deployed server: set CONTRACT_BASE_URL.
 * Otherwise the app is started in-process on a random port.
 */
export async function startServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const external = process.env.CONTRACT_BASE_URL;
  if (external) return { baseUrl: external.replace(/\/$/, ''), close: async () => {} };

  const app: FastifyInstance = buildApp({ logger: false });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return { baseUrl: address, close: () => app.close() };
}

export const PROBLEM_TYPE_BASE = 'https://leetkob.example/problems/';
