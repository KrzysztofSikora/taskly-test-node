import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  initialize: vi.fn(),
  resolveDatabaseUrl: vi.fn(),
  createApp: vi.fn(),
}));

vi.mock('../src/core/database.ts', () => ({ createDatabase: mocks.createDatabase, initialize: mocks.initialize }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: mocks.resolveDatabaseUrl }));
vi.mock('../src/factory.ts', () => ({ createApp: mocks.createApp }));

import { start } from '../src/core/lifespan.ts';

function setup() {
  const database = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn().mockResolvedValue(undefined) };
  const server = {
    address: vi.fn().mockReturnValue({ port: 8123 }),
    close: vi.fn((callback: () => void) => callback()),
  };
  const listener = { once: vi.fn() };
  const listen = vi.fn((port: number, host: string, callback: () => void) => {
    queueMicrotask(callback);
    return Object.assign(server, listener);
  });
  mocks.resolveDatabaseUrl.mockReturnValue('postgresql://db');
  mocks.createDatabase.mockReturnValue(database);
  mocks.initialize.mockResolvedValue(undefined);
  mocks.createApp.mockReturnValue({ listen });
  return { database, server, listen };
}

describe('start', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'once').mockImplementation(() => process);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    process.exitCode = undefined;
  });

  it('connects, initializes and listens on the configured port', async () => {
    vi.stubEnv('API_PORT', '9001');
    const { database, server, listen } = setup();
    const result = await start();
    expect(mocks.createDatabase).toHaveBeenCalledWith('postgresql://db');
    expect(database.$connect).toHaveBeenCalled();
    expect(mocks.initialize).toHaveBeenCalledWith(database);
    expect(mocks.createApp).toHaveBeenCalledWith(database);
    expect(listen).toHaveBeenCalledWith(9001, '0.0.0.0', expect.any(Function));
    expect(console.log).toHaveBeenCalledWith('Taskly App Node API listening on port 8123');
    expect(result).toEqual({ server, database });
  });

  it('defaults to port 8000', async () => {
    vi.stubEnv('API_PORT', '');
    const { listen } = setup();
    await start();
    expect(listen.mock.calls[0][0]).toBe(8000);
  });

  it('disconnects the database and rethrows when startup fails', async () => {
    const { database } = setup();
    mocks.initialize.mockRejectedValue(new Error('init failed'));
    await expect(start()).rejects.toThrow('init failed');
    expect(database.$disconnect).toHaveBeenCalledOnce();
    expect(mocks.createApp).not.toHaveBeenCalled();
  });

  it('closes the server and disconnects the database on SIGTERM', async () => {
    const { database, server } = setup();
    await start();
    const registered = vi.mocked(process.once).mock.calls.map(([event]) => event);
    expect(registered).toEqual(['SIGTERM', 'SIGINT']);
    const shutdown = vi.mocked(process.once).mock.calls[0][1] as () => void;
    shutdown();
    expect(server.close).toHaveBeenCalled();
    await vi.waitFor(() => expect(database.$disconnect).toHaveBeenCalledOnce());
    expect(process.exitCode).toBeUndefined();
  });

  it('sets a failing exit code when disconnecting during shutdown fails', async () => {
    const { database } = setup();
    database.$disconnect.mockRejectedValue(new Error('disconnect failed'));
    await start();
    const shutdown = vi.mocked(process.once).mock.calls[1][1] as () => void;
    shutdown();
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(console.error).toHaveBeenCalled();
  });
});
