import releaseVersion from '../../release-version.json';
import { releaseLabel } from '../../scripts/lib/release-label.mjs';

export const LOCAL_RELEASE_LABEL = releaseLabel(releaseVersion);
declare const __QUENCHING_TEST_BUILD__: boolean;
export const IS_TEST_RELEASE = typeof __QUENCHING_TEST_BUILD__ === 'boolean'
  ? __QUENCHING_TEST_BUILD__ : releaseVersion.channel === 'test';
export const LOCAL_APP_VERSION = `v${LOCAL_RELEASE_LABEL}`;
export const LOCAL_APP_TITLE = `Quenching Mod Client ${LOCAL_APP_VERSION}`;
