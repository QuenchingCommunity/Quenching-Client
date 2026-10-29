# GitHub organization migration — 2026-10-23

## Completed remote changes

User authorized moving the Quenching repositories into `QuenchingCommunity` and creating `Quenching-UGC`. Only these explicitly Quenching-named repositories were transferred; unrelated personal repositories and Warcraft converter repositories were not changed.

| Repository | Preserved repository ID | Destination |
| --- | --- | --- |
| Quenching-Client | 880336145 | https://github.com/QuenchingCommunity/Quenching-Client |
| Quenching-Assets | 887169802 | https://github.com/QuenchingCommunity/Quenching-Assets |
| OpenQuenching | 329226529 | https://github.com/QuenchingCommunity/OpenQuenching |
| Quenching-Gitbook | 253396394 | https://github.com/QuenchingCommunity/Quenching-Gitbook |
| Quenching-UGC (new, public, empty) | 1430807937 | https://github.com/QuenchingCommunity/Quenching-UGC |

The authenticated user is an active organization admin. Destination ownership and repository IDs were checked after the asynchronous transfers completed. Client and Assets Release IDs, tags and attachment counts match the pre-transfer API records. Latest resource release `v3.6.2` still contains the two full ZIPs, manual ZIP, automatic ZIP and SHA256SUMS. No release asset was deleted, replaced or reuploaded. Local client `origin` now points to `https://github.com/QuenchingCommunity/Quenching-Client.git`; `git ls-remote --heads origin main` succeeded. Client's Mac candidate workflow remains active. All four transferred repositories reported no GitHub Pages site before transfer.

## Existing users and signatures

GitHub documents redirection for transferred repository links and Git operations: https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository

Old API requests for both update repositories resolve to the same IDs under the organization. Do not recreate either repository at its old `UIZorrot` path: reusing an old namespace can remove the redirect. Do not delete the source release tags or assets used by existing signed manifests.

No version, gate, signing key or online manifest was changed. Existing signed metadata must retain its exact bytes. New candidates should use the organization URLs. Older distributed clients only expand configured mirrors for old-owner Release URLs, so do not blindly change all old-client manifests to organization URLs: their mirror fallback would no longer be synthesized. Existing old URLs plus GitHub redirect remain the compatibility path; any required old-client source change needs separately tested explicit mirror URLs and re-signing.

## Local compatibility changes (unpublished, for 3.7)

- `src/Main/services/update-download.ts`: mirror eligibility now accepts both `UIZorrot` and `QuenchingCommunity`, restricted to the official Client/Assets Release paths. UGC, arbitrary owners, raw files and credential-bearing URLs are not added to mirror transport.
- `scripts/lib/update-source-policy.mjs`: publisher source-policy rewriting recognizes both owners, preserving old manifest URL semantics.
- Added both-owner/both-product regression cases; UGC and unrelated owners remain excluded.
- Updated release skill's repository contract. Historical documents, signed snapshots and private historical scripts were deliberately not bulk-rewritten.

Passed:

```text
node scripts/test-update-source-policy.mjs
node --import tsx scripts/test-update-download.ts
git diff --check -- src/Main/services/update-download.ts scripts/lib/update-source-policy.mjs scripts/test-update-download.ts scripts/test-update-source-policy.mjs
```

These tests use local HTTP fixtures, not an end-to-end installed client upgrade. No client/game was launched and no new build, commit or push was made.

## Network evidence and remaining checks

Before transfer, a direct Node fetch of the 166-byte Client checksum succeeded with SHA-256 `bbab15c25c08e0af23bcb7e349f1058a2acdcdde27b0b0e50ad288ee1a7d4a71`. The old tiny MOD object probe failed. After transfer, direct Node fetch/HTTPS probes of both old and new Client/Assets download URLs failed or timed out on this host; API repository and Release checks succeeded. Therefore this task does not claim successful post-transfer Release payload download or mainland mirror performance. Network failures at both old and new paths are not proof that a release disappeared.

Before 3.7 publication, recheck old and new public Release payloads and configured mirrors on the intended networks, hash the actual bytes, and run the actual old-client upgrade check. Do not treat an API 200 or fixture success as that acceptance.

Other local clones may keep working through redirects, but should update their remotes when handled by their owners. Future upstream tooling must explicitly target `QuenchingCommunity/<repo>` (`gh -R`, API paths, `--url-base`, mirror wrappers). Private `_irys/` historical scripts still contain legacy defaults; review them before reuse, do not rerun them blindly. GitBook's external integration/app permissions and organization CI secrets/third-party apps may require owner-side reconnection; none were changed or claimed verified here. Website editorial links can be updated independently by its maintainer; no site deployment occurred.
