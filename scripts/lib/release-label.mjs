/** Pure local build identity; never selects an update endpoint or edits MOD versions. */
export function releaseLabel({ displayVersion, channel = 'production' }) {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(displayVersion)) throw new Error('Invalid public displayVersion');
  if (!['test', 'production'].includes(channel)) throw new Error('Invalid local release channel');
  return `${displayVersion}${channel === 'test' ? ' TEST' : ''}`;
}
