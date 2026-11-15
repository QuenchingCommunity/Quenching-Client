import ModelViewer from 'mdx-m3-viewer/dist/cjs/viewer/viewer';
import mdx from 'mdx-m3-viewer/dist/cjs/viewer/handlers/mdx/handler';
import blp from 'mdx-m3-viewer/dist/cjs/viewer/handlers/blp/handler';
import dds from 'mdx-m3-viewer/dist/cjs/viewer/handlers/dds/handler';
import tga from 'mdx-m3-viewer/dist/cjs/viewer/handlers/tga/handler';
import { parsePreviewModel } from './parse-model';
import { cjsDefault } from './interop';
import { selectPreviewSequence } from './sequence-selection';

export type ReadPreviewResource = (path: string, basePath?: string) => Promise<{ bytes: Uint8Array; resolvedPath: string }>;

export async function createPreview(canvas: HTMLCanvasElement, source: { bytes: Uint8Array; resolvedPath: string },
  read: ReadPreviewResource, options: { scale?: number; signal?: AbortSignal; teamColor?: number; transparent?: boolean; viewDistance?: number; unitId?: string } = {}) {
  const parser = parsePreviewModel(source.bytes);
  // Card previews are deliberately silent and self-contained: no event-triggered
  // sound/spawn tables or child attachments. These are not core mesh animations.
  const omitted = { popcorn: parser.particleEmittersPopcorn.length, faceFx: parser.faceEffects.length,
    events: parser.eventObjects.length, attachments: parser.attachments.filter(a => a.path).length };
  parser.eventObjects = [];
  for (const attachment of parser.attachments) attachment.path = '';
  const Viewer = cjsDefault(ModelViewer);
  // The preview is continuously redrawn; retaining every completed framebuffer
  // wastes GPU memory and bandwidth, especially on high-DPI windows.
  const viewer = new Viewer(canvas, { alpha: !!options.transparent, antialias: true, preserveDrawingBuffer: false });
  const errors: string[] = [], missing: string[] = [];
  viewer.on('error', event => errors.push(String(event.reason || event.error)));
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    viewer.clear();
    viewer.gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  const check = () => { if (disposed || options.signal?.aborted) throw new Error('Preview cancelled'); };
  options.signal?.addEventListener('abort', dispose, { once: true });
  const cache = new Map<string, Promise<unknown>>();
  const solver = (value: unknown): any => {
    if (typeof value !== 'string') return value;
    const key = value.toLowerCase();
    if (!cache.has(key)) cache.set(key, (async () => {
      try {
        check(); const resource = await read(value, source.resolvedPath); check();
        if (/\.(mdx|mdl)$/i.test(value)) return parsePreviewModel(resource.bytes);
        return resource.bytes;
      } catch (error) {
        if (!disposed) missing.push(value);
        // Resolve, not reject: the legacy viewer doesn't catch async solver rejection.
        return undefined;
      }
    })());
    return cache.get(key);
  };
  try {
    check();
    for (const handler of [blp, dds, tga]) if (!viewer.addHandler(cjsDefault(handler))) throw new Error('Texture handler initialization failed');
    if (!viewer.addHandler(cjsDefault(mdx), solver, parser.version > 800)) throw new Error('MDX shader initialization failed');
    const scene = viewer.addScene();
    scene.alpha = !!options.transparent; scene.color = [0.035, 0.04, 0.05];
    const model: any = await viewer.load(parser, solver);
    check();
    if (!model?.geosets.length) throw new Error(errors.join('; ') || 'Model has no renderable geosets');
    const instance = model.addInstance();
    instance.setTeamColor(options.teamColor ?? 8);
    const scale = options.scale || 1;
    instance.setUniformScale(scale);
    const stand = selectPreviewSequence(parser.sequences, options.unitId);
    instance.setSequence(stand);
    instance.setSequenceLoopMode(2);
    instance.setScene(scene);
    const extent = parser.sequences[stand]?.extent || parser.extent;
    const min = extent.min, max = extent.max;
    const center = Array.from(min, (v, i) => (v + max[i]) * 0.5 * scale);
    const radius = Math.max(20, Math.hypot(...Array.from(min, (v, i) => (max[i] - v) * scale)) / 2);
    // Leave room below the mesh for the feet and the rotation hint.
    center[2] -= radius * 0.10;
    let distance = 0;
    // Start halfway between the front and side, like the original skin artwork.
    let angle = -Math.PI / 4;
    const orbit = (delta: number) => {
      angle += delta;
      scene.camera.moveToAndFace([center[0] + Math.cos(angle) * distance, center[1] + Math.sin(angle) * distance,
        center[2] + distance * 0.28], center as any, [0, 0, 1]);
    };
    const resize = () => {
      const aspect = canvas.width / canvas.height;
      const halfFov = Math.min(Math.PI / 8, Math.atan(Math.tan(Math.PI / 8) * aspect));
      distance = radius / Math.sin(halfFov) * 1.12 * (options.viewDistance || 1);
      scene.viewport = [0, 0, canvas.width, canvas.height];
      scene.camera.perspective(Math.PI / 4, aspect, 1, distance + radius * 10);
      orbit(0);
      // The HD shader expects the key light in view space.
      scene.lightPosition = [-distance * 0.25, distance * 0.55, distance * 0.75];
    };
    resize();
    // Async solvers begin before the viewer adds resource promises to its own queue.
    let pending = -1;
    while (pending !== cache.size) { pending = cache.size; await Promise.all(cache.values()); await viewer.whenAllLoaded(); check(); }
    if (errors.length) throw new Error(errors.join('; '));
    const draw = (dt = 16) => {
      check();
      if (options.transparent) {
        viewer.update(dt);
        viewer.gl.depthMask(true);
        viewer.gl.clearColor(0, 0, 0, 0);
        viewer.gl.clear(viewer.gl.COLOR_BUFFER_BIT | viewer.gl.DEPTH_BUFFER_BIT);
        viewer.render();
      } else viewer.updateAndRender(dt);
    };
    draw(0);
    if (viewer.gl.getError() !== viewer.gl.NO_ERROR) throw new Error('WebGL error while rendering model');
    return { viewer, model, parser, instance, missing, omitted, orbit, resize, draw, dispose,
      setSequence(index: number) { instance.setSequence(index); instance.setSequenceLoopMode(2); } };
  } catch (error) { dispose(); throw error; }
}
