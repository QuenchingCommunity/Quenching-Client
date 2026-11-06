/** Production selector; transfer, verification and installation stay shared. */
export function updateTestEnabled(): boolean { return false; }
export function updateTestBase(): undefined { return undefined; }
export function updateChannelPath(relative: string): string { return relative; }
export function updateTestUrls(_relative: string): undefined { return undefined; }
