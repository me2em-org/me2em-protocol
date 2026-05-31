export interface SessionOptions {
  audience: string;
  scopes: string[];
  ttl?: number; // в секундах
}

export interface SessionToken {
  handleId: string;
  scopes: string[];
  expiresAt: number;
  token: string;
}

export class Session {
  constructor(
    public readonly handleId: string,
    public readonly scopes: string[],
    public readonly expiresAt: number,
    public readonly token: string
  ) {}

  isExpired(): boolean {
    return Date.now() >= this.expiresAt * 1000;
  }
}