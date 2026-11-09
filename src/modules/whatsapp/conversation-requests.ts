type Flight<T>={controller:AbortController;promise:Promise<T>;foreground:boolean};
/** Deduplicates intent preloads and clicks; never shares data across page scopes. */
export class ConversationRequests<T>{
  private flights=new Map<string,Flight<T>>();
  constructor(private fetcher:(id:string,signal:AbortSignal)=>Promise<T>){}
  load(id:string){for(const [key,flight] of this.flights)if(key!==id){flight.controller.abort();this.flights.delete(key);}return this.start(id,true);}
  prefetch(id:string){if(this.flights.size&&!this.flights.has(id))return null;return this.start(id,false);}
  cancelPrefetch(id:string){const flight=this.flights.get(id);if(flight&&!flight.foreground){flight.controller.abort();this.flights.delete(id);}}
  clear(){for(const flight of this.flights.values())flight.controller.abort();this.flights.clear();}
  private start(id:string,foreground:boolean){
    const existing=this.flights.get(id);if(existing){existing.foreground ||= foreground;return existing.promise;}
    const controller=new AbortController();
    const flight:Flight<T>={controller,foreground,promise:Promise.resolve(null as T)};
    flight.promise=this.fetcher(id,controller.signal).finally(()=>{if(this.flights.get(id)===flight)this.flights.delete(id);});
    this.flights.set(id,flight);return flight.promise;
  }
}
