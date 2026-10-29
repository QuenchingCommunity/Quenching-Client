export interface ResourceStartupStatus {
  phase: 'idle' | 'preparing' | 'ready' | 'failed';
  firstRun: boolean;
  percent: number;
  revision: number;
  error?: string;
}

/** Two frames let the initial page paint before requesting native extraction. */
export function afterResourceFirstPaint(host:{requestAnimationFrame:(callback:()=>void)=>number;cancelAnimationFrame:(id:number)=>void},start:()=>void):()=>void {
  let active=true,second=0;
  const first=host.requestAnimationFrame(()=>{second=host.requestAnimationFrame(()=>{if(active)start();});});
  return ()=>{active=false;host.cancelAnimationFrame(first);host.cancelAnimationFrame(second);};
}

/** No work begins until the visible renderer explicitly starts the task. */
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
