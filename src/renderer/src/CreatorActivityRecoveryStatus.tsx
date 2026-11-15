import type {CreatorActivityState} from '../../shared/creatorActivity'
export function CreatorActivityRecoveryStatus({state,now=Date.now()}:{state:CreatorActivityState;now?:number}){
 const r=state.recovery,active=state.phase==='running'&&r&&['waiting','reconnecting'].includes(r.phase)
 const seconds=Math.max(0,Math.ceil((Date.parse(r?.waitUntil??'')-now)/1000))||0
 return <>
   {active&&<strong className="creator-baseline-countdown" data-testid="creator-recovery-status">{r.phase==='waiting'?`连接恢复等待 · ${seconds} 秒后重连`:'正在重新连接并核验账号与主页'} · 本位第 {r.attempt}/2 次 · 保留 {r.preservedPages} 页</strong>}
   {!!state.recoveryAttempts&&<small data-testid="creator-recovery-summary">本轮连接恢复：成功 {state.recoverySucceeded??0} 次 ／ 尝试 {state.recoveryAttempts} 次</small>}
 </>
}
