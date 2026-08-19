export function shouldCreateCatalogRevision(
  latestSnapshotSha256: string | null,
  currentSnapshotSha256: string,
): boolean {
  return latestSnapshotSha256 !== currentSnapshotSha256;
}
