import { ROLES, type Role } from '@beer-game/shared';
import { describe, expect, it } from 'vitest';
import fixture from '../../../../../fixtures/everyone-orders-four.json';
import { DomainError } from './errors.js';
import {
  claimRole,
  createGame,
  isRoundComplete,
  processRound,
  releaseRole,
  replay,
  startGame,
  submitOrder,
} from './GameEngine.js';
import { classicRules, normalizeRules } from './gameRules.js';
import type { GameState } from './GameState.js';

type FixtureRole = {
  shipmentArrived: number;
  incomingOrder: number;
  shipped: number;
  inventory: number;
  backlog: number;
  roundCost: number;
  totalCost: number;
  orderPlaced: number;
};

const fixtureRounds = fixture.rounds as Array<{ round: number } & Record<Role, FixtureRole>>;

function seatedLobby(): GameState {
  return ROLES.reduce((state, role) => claimRole(state, role), createGame(classicRules()));
}

function playAll(quantityFor: (round: number, role: Role) => number): GameState {
  let state = startGame(seatedLobby());
  for (let round = 1; round <= state.rules.roundCount; round += 1) {
    for (const role of ROLES) {
      state = submitOrder(state, role, quantityFor(round, role));
    }
    state = processRound(state);
  }
  return state;
}

describe('classic game, everyone orders 4', () => {
  it('matches the published fixture for every role and every round', () => {
    let state = startGame(seatedLobby());

    for (const expected of fixtureRounds) {
      expect(state.round).toBe(expected.round);
      expect(state.status).toBe('playing');

      for (const role of ROLES) {
        const actual = state.roles[role];
        const want = expected[role];
        expect(actual.shipmentArrived, `${role} r${expected.round} shipment`).toBe(want.shipmentArrived);
        expect(actual.incomingOrder, `${role} r${expected.round} incoming`).toBe(want.incomingOrder);
        expect(actual.shipped, `${role} r${expected.round} shipped`).toBe(want.shipped);
        expect(actual.inventory, `${role} r${expected.round} inventory`).toBe(want.inventory);
        expect(actual.backlog, `${role} r${expected.round} backlog`).toBe(want.backlog);
        expect(actual.roundCostCents, `${role} r${expected.round} cost`).toBe(Math.round(want.roundCost * 100));
        expect(actual.totalCostCents, `${role} r${expected.round} total`).toBe(Math.round(want.totalCost * 100));
      }

      for (const role of ROLES) state = submitOrder(state, role, 4);
      state = processRound(state);

      const recorded = state.history[expected.round - 1];
      expect(recorded?.round).toBe(expected.round);
      for (const role of ROLES) {
        expect(recorded?.byRole[role].orderPlaced).toBe(expected[role].orderPlaced);
      }
    }

    expect(state.status).toBe('finished');
    expect(state.history).toHaveLength(20);
    expect(state.roles.retailer.totalCostCents).toBe(39400);
    expect(state.roles.wholesaler.totalCostCents).toBe(12000);
    expect(state.roles.distributor.totalCostCents).toBe(12000);
    expect(state.roles.factory.totalCostCents).toBe(12000);
    const total = ROLES.reduce((sum, role) => sum + state.roles[role].totalCostCents, 0);
    expect(total).toBe(75400);
  });
});

describe('shipping and order delay', () => {
  it('delivers the retailer order of 8 to the wholesaler one round later and the shipment two rounds later', () => {
    let state = startGame(seatedLobby());
    const wholesalerSawEight: number[] = [];
    const retailerReceivedEight: number[] = [];

    for (let round = 1; round <= 20; round += 1) {
      if (state.roles.wholesaler.incomingOrder === 8) wholesalerSawEight.push(round);
      if (state.roles.retailer.shipmentArrived === 8) retailerReceivedEight.push(round);

      state = submitOrder(state, 'retailer', round >= 5 ? 8 : 4);
      state = submitOrder(state, 'wholesaler', 4);
      state = submitOrder(state, 'distributor', 4);
      state = submitOrder(state, 'factory', 4);
      state = processRound(state);
    }

    expect(wholesalerSawEight[0]).toBe(6);
    expect(retailerReceivedEight[0]).toBe(8);
  });
});

describe('round progression', () => {
  it('does not advance until every role has ordered, and processes a round only once', () => {
    let state = startGame(seatedLobby());
    state = submitOrder(state, 'retailer', 4);
    state = submitOrder(state, 'wholesaler', 4);
    state = submitOrder(state, 'distributor', 4);
    expect(isRoundComplete(state)).toBe(false);
    expect(() => processRound(state)).toThrow(DomainError);

    state = submitOrder(state, 'factory', 1);
    const advanced = processRound(state);
    expect(advanced.round).toBe(2);
    expect(advanced.pendingOrders).toEqual({});
    // The function is pure: the same input produces the same next state, and that
    // next state no longer has a complete round to process.
    expect(processRound(state)).toEqual(advanced);
    expect(() => processRound(advanced)).toThrow(/every role has ordered/);
  });

  it('rejects a second order from the same role in the same round', () => {
    let state = startGame(seatedLobby());
    state = submitOrder(state, 'retailer', 4);
    expect(() => submitOrder(state, 'retailer', 5)).toThrow(DomainError);
    try {
      submitOrder(state, 'retailer', 5);
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('ALREADY_SUBMITTED');
    }
  });

  it('rejects negative, fractional, and huge orders', () => {
    const state = startGame(seatedLobby());
    for (const quantity of [-1, 1.5, Number.NaN, 10_001]) {
      expect(() => submitOrder(state, 'retailer', quantity)).toThrow(DomainError);
    }
    expect(submitOrder(state, 'retailer', 0).pendingOrders.retailer).toBe(0);
  });

  it('finishes after the configured number of rounds and still records the last order', () => {
    const state = playAll(() => 4);
    expect(state.status).toBe('finished');
    expect(state.history[19]?.byRole.factory.orderPlaced).toBe(4);
    expect(() => submitOrder(state, 'retailer', 4)).toThrowError(
      expect.objectContaining({ code: 'GAME_FINISHED' }),
    );
  });
});

describe('lobby rules', () => {
  it('refuses a fifth claim, a claim after start, and a release during play', () => {
    const lobby = seatedLobby();
    expect(() => claimRole(lobby, 'retailer')).toThrowError(
      expect.objectContaining({ code: 'ROLE_ALREADY_TAKEN' }),
    );
    const playing = startGame(lobby);
    expect(() => claimRole(playing, 'retailer')).toThrowError(
      expect.objectContaining({ code: 'GAME_ALREADY_STARTED' }),
    );
    expect(() => releaseRole(playing, 'retailer')).toThrowError(
      expect.objectContaining({ code: 'INVALID_GAME_STATE' }),
    );
  });

  it('releases a lobby seat', () => {
    const state = releaseRole(claimRole(createGame(), 'factory'), 'factory');
    expect(state.seats.factory).toBeUndefined();
  });

  it('refuses to start with an empty seat', () => {
    expect(() => startGame(claimRole(createGame(), 'retailer'))).toThrowError(
      expect.objectContaining({ code: 'INVALID_GAME_STATE' }),
    );
  });
});

describe('cost and backlog', () => {
  it('keeps inventory and backlog from both being positive after shipping', () => {
    let state = startGame(seatedLobby());
    for (let round = 1; round <= 20; round += 1) {
      for (const role of ROLES) {
        const station = state.roles[role];
        expect(station.inventory === 0 || station.backlog === 0).toBe(true);
        expect(station.pipeline).toHaveLength(2);
        expect(station.roundCostCents).toBe(station.inventory * 50 + station.backlog * 100);
      }
      for (const role of ROLES) state = submitOrder(state, role, round === 1 ? 0 : 9);
      state = processRound(state);
    }
  });

  it('lets the unlimited supplier refill the factory after the shipping delay', () => {
    let state = startGame(seatedLobby());
    for (const role of ROLES) state = submitOrder(state, role, role === 'factory' ? 20 : 4);
    state = processRound(state);
    // The supplier ships the new order on the following round, and it still takes two rounds to arrive.
    for (const role of ROLES) state = submitOrder(state, role, 4);
    state = processRound(state);
    expect(state.round).toBe(3);
    expect(state.roles.factory.shipmentArrived).toBe(4);
    for (const role of ROLES) state = submitOrder(state, role, 4);
    state = processRound(state);
    expect(state.round).toBe(4);
    expect(state.roles.factory.shipmentArrived).toBe(20);
  });
});

describe('configurable rules', () => {
  it('rejects a demand sequence that disagrees with the round count', () => {
    expect(() => normalizeRules({ roundCount: 5, demandSequence: [1, 2, 3] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_RULES' }),
    );
  });

  it('uses a custom demand sequence', () => {
    const rules = normalizeRules({ roundCount: 2, demandSequence: [3, 9], shippingDelay: 1 });
    let state = createGame(rules);
    for (const role of ROLES) state = claimRole(state, role);
    state = startGame(state);
    expect(state.roles.retailer.incomingOrder).toBe(3);
    expect(state.roles.retailer.pipeline).toHaveLength(1);
  });
});

describe('replay', () => {
  it('rebuilds a finished game from the order log', () => {
    const orders = new Map<number, Partial<Record<Role, number>>>();
    for (let round = 1; round <= 20; round += 1) {
      orders.set(round, { retailer: 4, wholesaler: 4, distributor: 4, factory: 4 });
    }
    const state = replay(classicRules(), [...ROLES], orders);
    expect(state.status).toBe('finished');
    expect(state.roles.retailer.totalCostCents).toBe(39400);
    expect(state.history).toHaveLength(20);
  });

  it('stops on a partial round so a reconnect lands in the same waiting state', () => {
    const orders = new Map<number, Partial<Record<Role, number>>>();
    orders.set(1, { retailer: 2, wholesaler: 3, distributor: 4, factory: 5 });
    orders.set(2, { retailer: 7, wholesaler: 1 });
    const state = replay(classicRules(), [...ROLES], orders);
    expect(state.status).toBe('playing');
    expect(state.round).toBe(2);
    expect(state.pendingOrders).toEqual({ retailer: 7, wholesaler: 1 });
    expect(state.history).toHaveLength(1);
  });
});
