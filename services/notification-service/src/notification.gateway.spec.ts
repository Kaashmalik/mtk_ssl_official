import { NotificationGateway } from './notification.gateway';

/**
 * ENH-01-04 (quarantine): the gateway previously joined ANY client-declared
 * `user:${id}` / `tenant:${id}` room - any socket could listen to arbitrary
 * private notification feeds. Room joining is QUARANTINED: no client-supplied
 * identity may place a socket into a private room, and rooms stay a
 * server-side emit target only, until an authenticated room-derivation flow
 * replaces this (the acceptance for this task).
 */

type FakeSocket = {
  id: string;
  join: jest.Mock;
  handshake: { query: Record<string, string | string[]> };
};

const makeSocket = (query: Record<string, string | string[]> = {}): FakeSocket => ({
  id: 'socket-1',
  join: jest.fn(),
  handshake: { query },
});

const gatewayWithServer = () => {
  const gateway = new NotificationGateway();
  (gateway as unknown as { server: { to: jest.Mock } }).server = {
    to: jest.fn(() => ({ emit: jest.fn() })),
  };
  return gateway;
};

describe('notification gateway room quarantine (ENH-01-04)', () => {
  it('does NOT join a personal room from the handshake query', () => {
    const gateway = new NotificationGateway();
    const socket = makeSocket({ userId: 'victim-uuid' });
    gateway.handleConnection(socket as never);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('does NOT join any room on the join / joinTenant client events', () => {
    const gateway = new NotificationGateway();
    const socket = makeSocket();
    gateway.handleJoin({ userId: 'victim-uuid' }, socket as never);
    gateway.handleJoinTenant({ tenantId: 'victim-tenant' }, socket as never);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('still emits server-side to user and tenant rooms (write path untouched)', () => {
    const gateway = gatewayWithServer();
    gateway.emitToUser('user-uuid', {
      id: 'n1',
      type: 'match_started',
      title: 't',
      body: null,
      createdAt: new Date(),
    });
    gateway.emitToTenant('tenant-uuid', { type: 't', title: 't', body: null });
    const server = (gateway as unknown as { server: { to: jest.Mock } }).server;
    expect(server.to).toHaveBeenCalledWith('user:user-uuid');
    expect(server.to).toHaveBeenCalledWith('tenant:tenant-uuid');
  });

  it('is inert without a server (emit guards survive)', () => {
    const gateway = new NotificationGateway();
    expect(() =>
      gateway.emitToUser('u', {
        id: 'n',
        type: 't',
        title: 't',
        body: null,
        createdAt: new Date(),
      }),
    ).not.toThrow();
  });
});
