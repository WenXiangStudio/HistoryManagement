/** One active snapshot and one latest pending snapshot; event bursts cannot flood IPC. */
export class RefreshQueue{
  private pending:{task:()=>Promise<void>;resolve:()=>void;reject:(error:unknown)=>void}[]=[]
  private running=false
  request(task:()=>Promise<void>):Promise<void>{
    return new Promise((resolve,reject)=>{
      this.pending.push({task,resolve,reject})
      if(!this.running)void this.drain()
    })
  }
  private async drain():Promise<void>{
    this.running=true
    try{
      while(this.pending.length){
        const batch=this.pending;this.pending=[]
        try{await batch.at(-1)!.task();for(const request of batch)request.resolve()}
        catch(error){for(const request of batch)request.reject(error)}
      }
    }finally{this.running=false}
  }
}
