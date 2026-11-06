export const VISION_MODULES = ['visionUnits', 'visionDecorations', 'visionTerrain', 'visionMisc'] as const;
export type VisionModule = typeof VISION_MODULES[number];
export type VisionModules = Partial<Record<VisionModule | 'visionMiscShaders' | 'visionMiscUI', boolean>>;
export function visionModuleFor(file: string): VisionModule | null {
  const name=file.replace(/\\/g,'/').toLowerCase();
  if(name.split('/').some(p=>!p||p==='.'||p==='..'||p.includes(':')))return null;
  if(/^(?:env|environment)\/dnc(?:\/|$)/.test(name))return null;
  if(/^(?:units|buildings)\//.test(name))return /\.txt$/i.test(name)?null:'visionUnits';
  if(/^(?:doodads|replaceabletextures)\//.test(name))return 'visionDecorations';
  if(/^(?:terrain|terrainart)\/|^(?:env|environment)\/foliage\//.test(name))return 'visionTerrain';
  return /^(?:abilities|objects|sound|ui|webui|_tilesets|textures|splats|shaders|scripts|fonts|campaign|env|environment)\//.test(name)?'visionMisc':null;
}
export function visionBlocksSetting(modules:VisionModules,key:string):boolean {
  if(modules.visionTerrain && ['terrain','foliage','water','blight'].includes(key))return true;
  if(modules.visionDecorations && ['tree','blight'].includes(key))return true;
  if(modules.visionMiscUI && ['ui','atmosphericLight'].includes(key))return true;
  if(modules.visionMiscShaders && ['objectShader','postProcessing','postProcessingGlow','postProcessingOutline','hdr','hdrExposure','improveReadability','glow','lighting','lightingBrightness','lightingAngle','rotatingLighting','atmosphericLight'].includes(key))return true;
  return Object.values(modules).some(Boolean) && ['graphicsSelection','versionSelection','classicMode','mode'].includes(key);
}
