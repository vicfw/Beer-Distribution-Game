export const gameRoom = (gameId: string) => `game:${gameId}`;
export const playerRoom = (playerId: string) => `player:${playerId}`;
export const spectatorRoom = (gameId: string) => `game:${gameId}:spectators`;
