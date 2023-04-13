import * as oauth from 'oauth4webapi'
import type { OAuthConfig, OAuthProvider } from '../oauth'
import type { GoogleProfile } from './types'

export const GOOGLE_ENDPOINTS = {
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  access_token: 'https://oauth2.googleapis.com/token',
  user: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
  revoke: 'https://oauth2.googleapis.com/revoke',
} as const

export interface GoogleOauthConfig<T extends Record<string, any> = {}> extends OAuthConfig<T> {
  redirect_uri: string
}

export class Google<T extends Record<string, any> = GoogleProfile> implements OAuthProvider<T> {
  id = 'google'

  type: OAuthProvider<T>['type'] = 'oidc'

  config: GoogleOauthConfig<T>

  constructor(config: GoogleOauthConfig<T>) {
    this.config = config
  }

  login () {
    const state = oauth.generateRandomState()

    const authorizationParams = new URLSearchParams({
      client_id: this.config.clientId,
      scope: (this.config.scope ?? ['profile', 'email']).join(' '),
      state,
      response_type: 'code',
      redirect_uri: this.config.redirect_uri
    })

    const authorizationUrl = `${GOOGLE_ENDPOINTS.authorization}?${authorizationParams.toString()}`

    return [authorizationUrl, state] as const
  }

  async handleLogin() {
    return this.login()
  }

  async getTokens(code: string) {
    const tokenParams = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirect_uri
    })

    const tokens = await fetch(`${GOOGLE_ENDPOINTS.access_token}?${tokenParams.toString()}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
    }).then(res => res.json())

    return tokens
  }
  
  async logout(token: string) {
    const revokeParams = new URLSearchParams({ token })

    const url = `${GOOGLE_ENDPOINTS.revoke}?${revokeParams.toString()}`

    const response = await fetch(url, { method: 'POST', })

    return response.ok
  }

  async handleLogout(request: Request) {
    return this.logout(request.headers.get('Authorization')?.split(' ')[1] ?? '')
  }

  async getUser(access_token: string) {
    const params = new URLSearchParams({ access_token })

    const user: GoogleProfile = await fetch(`${GOOGLE_ENDPOINTS.user}&${params.toString()}`)
      .then(res => res.json())

    return (await this.config.onLogin?.(user) ?? user) as T
  }

  _authenticateRequestMethod = 'GET'

  async callback(request: Request) {
    if (request.method !== this._authenticateRequestMethod) {
      throw new Error(`Invalid request method: ${request.method}`)
    }

    const code = new URL(request.url).searchParams.get('code')

    if (code == null) {
      throw new Error('No OAuth code found.')
    }

    const tokens = await this.getTokens(code)

    const user = await this.getUser(tokens.access_token)

    return user
  }
}
