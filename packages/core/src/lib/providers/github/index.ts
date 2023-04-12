import * as oauth from 'oauth4webapi'
import type { OAuthConfig, Provider } from '..'
import type { GitHubEmail, GitHubUser } from './types'

/**
 * https://docs.github.com/en/rest/overview/authenticating-to-the-rest-api?apiVersion=2022-11-28#using-basic-authentication
 */
export function generateBasicAuthHeader(clientId: string, clientSecret: string) {
  const encodedCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  return `Basic ${encodedCredentials}`
}

export const GITHUB_ENDPOINTS = {
  authorization: 'https://github.com/login/oauth/authorize',
  access_token: 'https://github.com/login/oauth/access_token',
  user: 'https://api.github.com/user',
  email: 'https://api.github.com/user/emails',
  revoke: 'https://api.github.com/applications/{client_id}/token',
} as const

export class GitHub<T extends Record<string, any> = GitHubUser> implements Provider<T> {
  id = 'github'

  type: Provider<T>['type'] = 'oauth'

  config: OAuthConfig<T>

  constructor(config: OAuthConfig<T>) {
    this.config = config
  }

  getAuthorizationUrl() {
    const state = oauth.generateRandomState()

    const authorizationParams = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope?.join(' ') || '',
      state,
    })

    const authorizationUrl = `${GITHUB_ENDPOINTS.authorization}?${authorizationParams.toString()}`

    return [authorizationUrl, state] as const
  }

  async getTokens(code: string) {
    const tokenParams = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
    })

    const tokens = await fetch(`${GITHUB_ENDPOINTS.access_token}?${tokenParams.toString()}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
    }).then(res => res.json())

    return tokens
  }

  async logout(access_token: string) {
    const url = `https://api.github.com/applications/${this.config.clientId}/grant`

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: generateBasicAuthHeader(this.config.clientId, this.config.clientSecret)
      },
      body: JSON.stringify({ access_token })
    })

    return response.ok
  }

  async getUser(access_token: string) {
    const user: GitHubUser = await fetch(GITHUB_ENDPOINTS.user, {
      method: 'GET',
      headers: {
        Authorization: `token ${access_token}`,
      },
    }).then(res => res.json())

    if (user.email == null) {
      const emails: GitHubEmail[] = await fetch(GITHUB_ENDPOINTS.email).then(res => res.json())
      user.email = (emails.find((e) => e.primary) ?? emails[0]).email
    }

    return (await this.config.onLogin?.(user) ?? user) as T
  }

  _authenticateRequestMethod = 'GET'

  async authenticateRequest(request: Request) {
    if (request.method !== this._authenticateRequestMethod) {
      throw new Error(`Invalid request method: ${request.method}`)
    }

    const code = new URL(request.url).searchParams.get('code')

    if (code == null) throw new Error('No OAuth code found.')

    const tokens = await this.getTokens(code)

    const user = await this.getUser(tokens.access_token)

    return user
  }
}
