export class VerifiedCreatorCatalog {
  constructor(path: string)
  close(): void
  bindOwner(ownerSecUid: string, verifiedAt: string, source?: string): void
  upsertFollowing(ownerSecUid: string, creator: {
    uid: string; secUid: string; nickname: string; isFollowing: boolean
  }, verifiedAt: string): { status: string }
}
