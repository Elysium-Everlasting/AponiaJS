import * as oauth from 'oauth4webapi'
import * as checks from '../../security/checks'
import { createCookiesOptions } from '../../security/cookie'
import type { Cookie, CookiesOptions } from '../../security/cookie'
import type { JWTOptions } from '../../security/jwt'
import type { InternalRequest } from '../../internal/request'
import type { InternalResponse } from '../../internal/response'

type Awaitable<T> = PromiseLike<T> | T

type OAuthCheck = 'pkce' | 'state' | 'none' | 'nonce'

type TokenSet = Partial<oauth.OAuth2TokenEndpointResponse>

interface Pages {
  login: string
  callback: string
}

interface Endpoint<TContext = any, TResponse = any> {
  url: string
  params?: Record<string, unknown>
  request?: (context: TContext) => Awaitable<TResponse>
  conform?: (response: Response) => Awaitable<Response | undefined>
}

export interface OAuthDefaultConfig<TProfile> {
  id: string
  checks?: OAuthCheck[]
  client?: Partial<oauth.Client>
  endpoints: OAuthEndpoints<TProfile, any>
}

/**
 * User options. Several can be omitted and filled in by the provider's default options.
 * @external
 */
export interface OAuthUserConfig<TProfile, TUser = TProfile> {
  /**
   * Unique ID for the provider.
   */
  id?: string
  
  /**
   * Client ID for the provider.
   */
  clientId: string

  /**
   * Client secret for the provider.
   */
  clientSecret: string

  /**
   * Override the default OAuth client.
   */
  client?: Partial<oauth.Client>

  /**
   * A function that is called when the user is authenticated.
   */
  onAuth?: (user: TProfile) => Awaitable<InternalResponse<TUser>>

  /**
   * Checks to perform.
   */
  checks?: OAuthCheck[]

  /**
   * Pages to use.
   */
  pages?: Partial<Pages>

  /**
   * Endpoints to use.
   */
  endpoints?: Partial<OAuthUserEndpoints<TProfile, TUser>>

  /**
   * JWT options.
   */
  jwt?: Partial<JWTOptions>

  /**
   * Whether to use secure cookies.
   */
  useSecureCookies?: boolean
}

/**
 * Users can also provide just a string URL for the endpoints.
 * @external
 */
interface OAuthUserEndpoints<TProfile, TUser = TProfile> {
  authorization: string | Endpoint<OAuthProvider<TUser>>
  token: string | Endpoint<OAuthProvider<TUser>, TokenSet>
  userinfo: string | Endpoint<{ provider: OAuthProvider<TProfile, TUser>; tokens: TokenSet }, TProfile>
}

/**
 * Internal options. All options are generally defined.
 * @internal
 */
export interface OAuthConfig<TProfile, TUser = TProfile> {
  id: string
  clientId: string
  clientSecret: string
  client: oauth.Client
  jwt: JWTOptions
  cookies: CookiesOptions
  checks: OAuthCheck[]
  pages: Pages
  endpoints: OAuthEndpoints<TProfile, TUser>
  onAuth: (user: TProfile) => Awaitable<InternalResponse<TUser>>
}

/**
 * Internally, endpoints shouldn't be strings.
 * @internal
 */
interface OAuthEndpoints<TProfile, TUser = TProfile> {
  authorization: Endpoint<OAuthProvider<TUser>>
  token: Endpoint<OAuthProvider<TUser>, TokenSet>
  userinfo: Endpoint<{ provider: OAuthProvider<TProfile, TUser>; tokens: TokenSet }, TProfile>
}

/**
 * @param TProfile The user profile returned by the OAuth provider.
 * @param TUser User.
 * @param TSession Session.
 */
export class OAuthProvider<TProfile, TUser = TProfile> implements OAuthConfig<TProfile, TUser> {
  id: string

  type = "oauth" as const

  clientId: string

  clientSecret: string

  client: oauth.Client

  authorizationServer: oauth.AuthorizationServer

  jwt: JWTOptions

  cookies: CookiesOptions

  checks: OAuthCheck[]

  pages: Pages

  endpoints: OAuthEndpoints<TProfile, TUser>

  onAuth: (user: TProfile) => Awaitable<InternalResponse<TUser>>

  constructor(options: OAuthConfig<TProfile, TUser>) {
    this.id = options.id
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.client = options.client
    this.jwt = options.jwt
    this.cookies = options.cookies
    this.checks = options.checks
    this.pages = options.pages
    this.endpoints = options.endpoints
    this.onAuth = options.onAuth

    // OAuth doesn't use discovery for authorization server, only OIDC.
    this.authorizationServer = {
      issuer: 'auth.js',
      authorization_endpoint: options.endpoints.authorization.url,
      token_endpoint: options.endpoints.token.url,
      userinfo_endpoint: options.endpoints.userinfo.url,
    }
  }

  setJwtOptions(options: JWTOptions) {
    this.jwt = options
    return this
  }

  setCookiesOptions(options: CookiesOptions) {
    this.cookies = options
    return this
  }

  /**
   * Login the user.
   */
  async login(request: InternalRequest): Promise<InternalResponse> {
    const url = new URL(this.endpoints.authorization.url)
    const cookies: Cookie[] = []

    Object.entries(this.endpoints?.authorization?.params ?? {}).forEach(([key, value]) => {
      if (typeof value === 'string') {
        url.searchParams.set(key, value)
      }
    })

    if (this.checks?.includes('state')) {
      const [state, stateCookie] = await checks.state.create(this)
      url.searchParams.set('state', state)
      cookies.push(stateCookie)
    }

    if (this.checks?.includes('pkce')) {
      const [pkce, pkceCookie] = await checks.pkce.create(this)
      url.searchParams.set('code_challenge', pkce)
      url.searchParams.set('code_challenge_method', 'S256')
      cookies.push(pkceCookie)
    }

    if (this.checks?.includes('nonce')) {
      const [nonce, nonceCookie] = await checks.nonce.create(this)
      url.searchParams.set('nonce', nonce)
      cookies.push(nonceCookie)
    }

    if (!url.searchParams.has('redirect_uri')) {
      url.searchParams.set('redirect_uri', `${request.url.origin}${this.pages.callback}`)
    }

    return { status: 302, redirect: url.toString(), cookies }
  }

  /**
   * Callback after the user has logged in.
   */
  async callback(request: InternalRequest): Promise<InternalResponse> {
    const cookies: Cookie[] = []

    const [state, stateCookie] = await checks.state.use(request, this)

    if (stateCookie) cookies.push(stateCookie)

    const codeGrantParams = oauth.validateAuthResponse(
      this.authorizationServer,
      this.client,
      request.url.searchParams,
      state,
    )

    if (oauth.isOAuth2Error(codeGrantParams)) throw new Error(codeGrantParams.error_description)

    const [pkce, pkceCookie] = await checks.pkce.use(request, this)

    if (pkceCookie) cookies.push(pkceCookie)

    const initialCodeGrantResponse = await oauth.authorizationCodeGrantRequest(
      this.authorizationServer,
      this.client,
      codeGrantParams,
      `${request.url.origin}${this.pages.callback}`,
      pkce
    )

    const codeGrantResponse = 
      await this.endpoints.token.conform?.(initialCodeGrantResponse.clone())
      ?? initialCodeGrantResponse

    const challenges = oauth.parseWwwAuthenticateChallenges(codeGrantResponse)

    if (challenges) {
      challenges.forEach(challenge => { console.log("challenge", challenge) })
      throw new Error("TODO: Handle www-authenticate challenges as needed")
    }

    const tokens = await oauth.processAuthorizationCodeOAuth2Response(
      this.authorizationServer,
      this.client,
      codeGrantResponse,
    )

    if (oauth.isOAuth2Error(tokens)) throw new Error("TODO: Handle OAuth 2.0 response body error")

    const profile = 
      await (
        this.endpoints.userinfo.request?.({ provider: this, tokens }) ??
        oauth
          .userInfoRequest(this.authorizationServer, this.client, tokens.access_token)
          .then(response => response.json())
      )

    if (!profile) throw new Error("TODO: Handle missing profile")

    const processedResponse = await this.onAuth(profile)
    processedResponse.cookies ??= []
    processedResponse.cookies.push(...cookies)

    return processedResponse
  }
}


/**
 * Merge user options with default options.
 */
export function mergeOAuthOptions(
  userOptions: OAuthUserConfig<any, any>,
  defaultOptions: OAuthDefaultConfig<any>,
): OAuthConfig<any, any> {
  const id = userOptions.id ?? defaultOptions.id

  const authorizationUrl = typeof userOptions.endpoints?.authorization === 'string' 
    ? userOptions.endpoints.authorization 
    : (userOptions.endpoints?.authorization?.url ?? defaultOptions.endpoints.authorization.url)

  const authorizationOptions = typeof userOptions.endpoints?.authorization === 'object'
    ? userOptions.endpoints.authorization
    : {}

  const tokenUrl = typeof userOptions.endpoints?.token === 'string'
    ? userOptions.endpoints.token
    : (userOptions.endpoints?.token?.url ?? defaultOptions.endpoints.token.url)

  const tokenOptions = typeof userOptions.endpoints?.token === 'object'
    ? userOptions.endpoints.token
    : {}

  const userinfoUrl = typeof userOptions.endpoints?.userinfo === 'string'
    ? userOptions.endpoints.userinfo
    : (userOptions.endpoints?.userinfo?.url ?? defaultOptions.endpoints.userinfo.url)

  const userinfoOptions = typeof userOptions.endpoints?.userinfo === 'object'
    ? userOptions.endpoints.userinfo
    : {}

  return {
    ...userOptions,
    id,
    client: {
      ...defaultOptions.client,
      ...userOptions.client,
      client_id: userOptions.clientId,
      client_secret: userOptions.clientSecret,
    },
    onAuth: userOptions.onAuth ?? ((user) => ({ user, session: user })),
    checks: userOptions.checks ?? defaultOptions.checks ?? ['pkce'],
    pages: {
      login: userOptions.pages?.login ?? `/auth/login/${id}`,
      callback: userOptions.pages?.callback ?? `/auth/callback/${id}`,
    },
    endpoints: {
      authorization: {
        ...defaultOptions.endpoints.authorization,
        ...authorizationOptions,
        url: authorizationUrl,
        params: {
          ...defaultOptions.endpoints?.authorization?.params,
          client_id: userOptions.clientId,
          response_type: 'code',
        },
      },
      token: {
        ...defaultOptions.endpoints.token,
        ...tokenOptions,
        url: tokenUrl,
      },
      userinfo: {
        ...defaultOptions.endpoints.userinfo,
        ...userinfoOptions,
        url: userinfoUrl,
      },
    },
    // default cookie options, manually set later if needed.
    cookies: createCookiesOptions(userOptions.useSecureCookies),

    // default jwt options, manually set later if needed.
    jwt: {
      ...userOptions.jwt,
      secret: ''  // invalid secret: make sure to set it later if using JWT.
    },

  }
}

