/**
 * The realtime seam (ADR-009: 100ms via a RealtimeProvider interface).
 *
 * Everything the rest of the system knows about video lives here. Swapping
 * provider — or stubbing it in development — must not require touching booking
 * or consultation code.
 */

export interface RealtimeRoom {
  /** The provider's room id. Stored on the booking, never shown to a customer. */
  roomId: string;
}

export type RealtimeRole = 'astrologer' | 'customer';

export interface JoinToken {
  token: string;
  /** Seconds until it stops working. Short on purpose. */
  expiresIn: number;
}

export interface RealtimeProvider {
  /** Whether credentials are configured at all. */
  readonly configured: boolean;

  /** A room for ONE consultation. Never a shared room — see HmsService. */
  createRoom(name: string, description?: string): Promise<RealtimeRoom>;

  /**
   * A short-lived token letting ONE person into ONE room in ONE role.
   *
   * Minted server-side, always. The app secret never reaches a browser: it can
   * mint a moderator token for any room on the account.
   */
  joinToken(input: {
    roomId: string;
    userId: string;
    role: RealtimeRole;
  }): Promise<JoinToken>;

  /** Closes a room so a link cannot be reused after the consultation. */
  disableRoom(roomId: string): Promise<void>;
}

export const REALTIME_PROVIDER = Symbol('REALTIME_PROVIDER');
