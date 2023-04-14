import type { InternalRequest, InternalResponse } from '$lib/integrations/response'
import type { InternalCredentialsConfig } from '../providers'
import type { Provider } from './index'

export class CredentialsProvider implements Provider<InternalCredentialsConfig> {
  constructor(readonly config: InternalCredentialsConfig) {}

  async signIn(request: InternalRequest): Promise<InternalResponse> {
    return {}
  }

  async callback(request: InternalRequest): Promise<InternalResponse> {
    return {}
  }

  async signOut(request: InternalRequest): Promise<InternalResponse> {
    return {}
  }
}
