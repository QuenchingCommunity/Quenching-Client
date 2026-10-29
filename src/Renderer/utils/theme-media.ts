/** Keep built-in assets relative to the app, and custom files as actual file URLs. */
export function resolveThemeMedia(source:string,base:string):string {
  if(/^(?:https?:|file:|blob:|data:)/i.test(source))return source;
  const normalized=source.replace(/\\/g,'/');
  if(/^[a-z]:\//i.test(normalized))return 'file:///'+normalized.split('/').map(encodeURIComponent).join('/').replace(/^([a-z])%3A/i,'$1:');
  if(normalized.startsWith('//'))return 'file://'+normalized.slice(2).split('/').map(encodeURIComponent).join('/');
  const url=new URL(base);
  if(normalized.startsWith('/')&&!normalized.startsWith('/assets/'))return 'file://'+normalized.split('/').map(encodeURIComponent).join('/');
  return new URL(normalized.replace(/^\//,''),url.protocol==='file:'?url:new URL('/',url)).href;
}

export function reportThemeMediaError(video:HTMLVideoElement):void {
  console.warn('[ThemeMedia] Failed to decode media',{
    source:video.currentSrc||video.src,code:video.error?.code,message:video.error?.message,
    readyState:video.readyState,networkState:video.networkState,
  });
}
