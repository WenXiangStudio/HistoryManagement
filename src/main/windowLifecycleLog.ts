import {appendFileSync,existsSync,mkdirSync,renameSync,statSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import type {WindowLog} from './desktopWindow'

/** Only window events, without account data, credentials or launch arguments. */
export function windowLifecycleLog(userData:string):WindowLog {
  const directory=join(userData,'logs'),path=join(directory,'desktop-window.jsonl')
  return (event,details={})=>{
    try{
      mkdirSync(directory,{recursive:true})
      if(existsSync(path)&&statSync(path).size>128*1024){
        const previous=join(directory,'desktop-window.previous.jsonl')
        rmSync(previous,{force:true});renameSync(path,previous)
      }
      appendFileSync(path,JSON.stringify({at:new Date().toISOString(),pid:process.pid,event,...details})+'\n','utf8')
    }catch{/* Diagnostics failure must not hide or close the APP. */}
  }
}
