export interface ResourceStartupStatus {
  phase: 'idle' | 'preparing' | 'ready' | 'failed';
  firstRun: boolean;
  percent: number;
  revision: number;
  error?: string;
}

/** Prefer two painted frames; occluded windows may never receive animation frames. */
export function afterResourceFirstPaint(host:{requestAnimationFrame:(callback:()=>void)=>number;cancelAnimationFrame:(id:number)=>void},start:()=>void):()=>void {
  let active=true,first=0,second=0;
  const cancel=()=>{active=false;clearTimeout(timeout);host.cancelAnimationFrame(first);host.cancelAnimationFrame(second);};
  const run=()=>{if(!active)return;cancel();start();};
  // The mounted renderer still performs the normal startup IPC and native
  // validation. A covered/minimized window must not prevent its health ACK.
  const timeout=setTimeout(run,1000);
  first=host.requestAnimationFrame(()=>{second=host.requestAnimationFrame(run);});
  return cancel;
}

/** No work begins until the mounted renderer explicitly starts the task. */
export class ResourceStartupTask {
  private state: ResourceStartupStatus = {phase:'idle',firstRun:false,percent:0,revision:0};
  private running: Promise<void> | null = null;
  constructor(private actions: {
    prepare: (notify: (progress: {firstRun:boolean;percent:number}) => void) => Promise<void>;
    publish: (status:ResourceStartupStatus) => void;
    complete: () => void | Promise<void>;
    failure: (error:unknown) => void;
  }) {}
  getStatus():ResourceStartupStatus {return {...this.state};}
  private update(change:Partial<ResourceStartupStatus>) {
    const next={...this.state,...change};
    if(next.phase===this.state.phase && next.firstRun===this.state.firstRun && next.percent===this.state.percent && next.error===this.state.error)return;
    this.state={...next,revision:this.state.revision+1};
    this.actions.publish(this.getStatus());
  }
  start():ResourceStartupStatus {
    if(this.running)return this.getStatus();
    this.update({phase:'preparing'});
    this.running=Promise.resolve().then(()=>this.actions.prepare(progress=>this.update({
      firstRun:progress.firstRun,percent:Math.max(this.state.percent,Math.max(0,Math.min(100,Math.floor(progress.percent)))),
    }))).then(()=>this.actions.complete()).then(()=>this.update({phase:'ready',percent:100})).catch(error=>{
      this.update({phase:'failed',error:error instanceof Error?error.message:String(error)});
      try {this.actions.failure(error);}catch(reportError){console.error('[Resources] Failure reporting failed:',reportError);}
    });
    return this.getStatus();
  }
  async settled():Promise<void> {await this.running;}
}
