import { OIDCProvider, mergeOIDCOptions } from '../core/oidc'
import type { OIDCDefaultConfig, OIDCUserConfig } from '../core/oidc'

export interface GoogleProfile extends Record<string, any> {
  aud: string
  azp: string
  email: string
  email_verified: boolean
  exp: number
  family_name: string
  given_name: string
  hd: string
  iat: number
  iss: string
  jti: string
  name: string
  nbf: number
  picture: string
  sub: string
}

export const GoogleOptions: OIDCDefaultConfig<GoogleProfile> = {
  id: 'google',
  issuer: 'https://accounts.google.com',
}

export default function Google<TUser = GoogleProfile, TSession = TUser>(
  options: OIDCUserConfig<GoogleProfile, TUser, TSession>
): OIDCProvider<GoogleProfile, TUser, TSession> {
  return new OIDCProvider(mergeOIDCOptions(options, GoogleOptions))
}
