import { parse } from "cookie";
import { encode, decode } from "../security/jwt";
import { createCookiesOptions } from "../security/cookie";
import type { JWTOptions, JWTEncodeParams, JWTDecodeParams } from "../security/jwt";
import type { Cookie, CookiesOptions } from "../security/cookie";
import type { InternalRequest } from "../internal/request";
import type { InternalResponse } from "../internal/response";

const DefaultAccessTokenMaxAge = 60 * 60

const DefaultRefreshTokenMaxAge = 60 * 60 * 24 * 7

type Awaitable<T> = T | PromiseLike<T>;

type Nullish = null | undefined | void;

type NewSession<TSession, TRefresh> = { accessToken: TSession, refreshToken?: TRefresh } | Nullish;

type TokenMaxAge = {
  accessToken: number
  refreshToken: number
}

export interface TokenSessionConfig<TUser, TSession = TUser, TRefresh = undefined> {
  /**
   * Secret used to sign the tokens.
   */
  secret: string

  /**
   * Custom JWT options.
   */
  jwt?: Omit<JWTOptions, 'maxAge'>

  /**
   * Max age of the access and refresh tokens.
   */
  maxAge?: Partial<TokenMaxAge>

  /**
   * Cookie options for the access and refresh tokens.
   */
  useSecureCookies?: boolean

  /**
   * Create a new session from a user.
   */
  createSession: (user: TUser) => Awaitable<NewSession<TSession, TRefresh>>;

  /**
   * Refresh a session from a refresh token.
   */
  refreshSession: (refresh: TRefresh) => Awaitable<NewSession<TSession, TRefresh> | Nullish>;

  /**
   * Invalidate a session.
   */
  onInvalidateSession?: (session: TSession, refresh?: TRefresh | Nullish) => Awaitable<InternalResponse<TUser> | Nullish>
}

export class TokenSessionManager<
  TUser, TSession = TUser, TRefresh = undefined
> implements TokenSessionConfig<TUser, TSession, TRefresh> {
  secret: string

  jwt: Omit<JWTOptions, 'maxAge'>

  encode: (params: JWTEncodeParams) => Awaitable<string>

  decode: <T>(params: JWTDecodeParams) => Awaitable<T | null>

  maxAge: TokenMaxAge

  cookies: CookiesOptions

  createSession: (user: TUser) => Awaitable<NewSession<TSession, TRefresh>>;

  refreshSession: (refresh: TRefresh) => Awaitable<NewSession<TSession, TRefresh> | Nullish>;

  onInvalidateSession?: (session: TSession, refresh?: TRefresh | Nullish) => Awaitable<InternalResponse<TUser> | Nullish>

  constructor(config: TokenSessionConfig<TUser, TSession, TRefresh>) {
    this.secret = config.secret;
    this.jwt = {
      ...config.jwt,
      secret: config.secret,
    }
    this.maxAge = { 
      accessToken: config.maxAge?.accessToken ?? DefaultAccessTokenMaxAge,
      refreshToken: config.maxAge?.refreshToken ?? DefaultRefreshTokenMaxAge,
    }
    this.encode = config.jwt?.encode ?? encode
    this.decode = config.jwt?.decode ?? decode
    this.cookies = createCookiesOptions(config.useSecureCookies)
    this.createSession = config.createSession;
    this.refreshSession = config.refreshSession;
    this.onInvalidateSession = config.onInvalidateSession;
  }

  async createCookies(newSession: NewSession<TSession, TRefresh>): Promise<Cookie[]> {
    const cookies: Cookie[] = []

    if (newSession?.accessToken) {
      cookies.push({
        name: this.cookies.accessToken.name,
        value: await this.encode({ 
          secret: this.secret,
          maxAge: this.maxAge.accessToken,
          token: newSession.accessToken
        }),
        options: {
          ...this.cookies.accessToken.options,
          maxAge: this.maxAge.accessToken,
        }
      })
    }

    if (newSession?.refreshToken) {
      cookies.push({
        name: this.cookies.refreshToken.name,
        value: await this.encode({
          secret: this.secret,
          maxAge: this.maxAge.refreshToken,
          token: newSession.refreshToken
        }),
        options: {
          ...this.cookies.refreshToken.options,
          maxAge: this.maxAge.refreshToken,
        }
      })
    }

    return cookies
  }

  async handleRequest(request: InternalRequest<TUser>): Promise<InternalResponse<TUser>> {
    const accessToken = request.cookies[this.cookies.accessToken.name]
    const refreshToken = request.cookies[this.cookies.refreshToken.name]

    const refresh = await this.decode<TRefresh>({ secret: this.secret, token: refreshToken })

    if (!accessToken && refreshToken && refresh) {
      const newSession = await this.refreshSession(refresh)
      return { cookies: await this.createCookies(newSession) }
    }

    return {}
  }

  async handleResponse(response: InternalResponse<TUser>): Promise<InternalResponse<TUser>> {
    if (!response.user) return response

    const newSession = await this.createSession(response.user)

    response.cookies ??= []
    response.cookies.push(...await this.createCookies(newSession))

    return response
  }

  async getUser(request: Request): Promise<TUser | Nullish> {
    const cookies = parse(request.headers.get("cookie") ?? "")

    const accessToken = cookies[this.cookies.accessToken.name]
    if (!accessToken) return null

    const user = await this.decode<TUser>({ secret: this.secret, token: accessToken })
    return user
  }

  async logout(request: Request): Promise<InternalResponse<TUser>> {
    const cookies = parse(request.headers.get("cookie") ?? "")

    const accessToken = cookies[this.cookies.accessToken.name]
    const refreshToken = cookies[this.cookies.refreshToken.name]

    const session = await this.decode<TSession>({ secret: this.secret, token: accessToken })
    const refresh = await this.decode<TRefresh>({ secret: this.secret, token: refreshToken })

    const response = session
      ? (await this.onInvalidateSession?.(session, refresh)) ?? {}
      : {}

    response.cookies ??= []
    response.cookies.push(
      {
        name: this.cookies.accessToken.name,
        value: "",
        options: { ...this.cookies.accessToken.options, maxAge: 0, }
      }, 
      {
        name: this.cookies.refreshToken.name,
        value: "",
        options: { ...this.cookies.refreshToken.options, maxAge: 0, }
      }
    )

    return response
  }
}

export function TokenSession<TUser, TSession = TUser, TRefresh = undefined>(
  config: TokenSessionConfig<TUser, TSession, TRefresh>
): TokenSessionManager<TUser, TSession, TRefresh> {
  return new TokenSessionManager(config)
}
