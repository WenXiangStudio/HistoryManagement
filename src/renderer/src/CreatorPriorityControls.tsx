import type {JSX} from 'react'
import type {CreatorListItem} from '../../shared/contracts'
import {creatorAutomaticTier,creatorNeedsVerification,effectiveCreatorTier} from '../../shared/creatorRefreshPolicy'
import {adjustedCreatorTier,CREATOR_TIER_LABELS,type CreatorPriorityMode} from '../../shared/creatorPriority'

export default function CreatorPriorityControls({creator,disabled,saving=false,onChange}:{creator:CreatorListItem;disabled:boolean;saving?:boolean;onChange:(mode:CreatorPriorityMode|null)=>void}):JSX.Element{
  const base=creatorAutomaticTier(creator),effective=effectiveCreatorTier(creator),mode=creator.refreshPriority?.mode??null
  const names={boost:'加权',reduce:'降权'}
  return <div className={`creator-priority ${mode?'has-priority':''}`} data-testid="creator-priority" aria-busy={saving||undefined}>
    <div className="creator-priority-heading"><span>活跃程度</span><strong className={`creator-tier-badge tier-${effective}`} data-testid="creator-effective-tier">{CREATOR_TIER_LABELS[effective]}</strong>
      {mode&&<span className="creator-priority-state" data-testid="creator-priority-state">手动设置</span>}</div>
    <p className="creator-priority-origin">{mode?`原始：${CREATOR_TIER_LABELS[base]} · 手动等级优先生效`:'按发布间隔与最近核验结果分类 · 未启用手动权重'}</p>
    <div className="creator-priority-actions">{(['boost','reduce'] as const).map(action=>{
      const target=adjustedCreatorTier(effective,action),atLimit=target===effective
      const explanation=atLimit?`已是${action==='boost'?'最高':'最低'}档`:`从${CREATOR_TIER_LABELS[effective]}${action==='boost'?'升':'降'}一档至${CREATOR_TIER_LABELS[target]}；可连续逐档调整`
      return <button type="button" key={action} data-testid={`creator-priority-${action}`} aria-label={`${names[action]} ${creator.nickname}`} disabled={disabled||saving||atLimit}
        title={saving?'正在保存这位博主的权重':disabled?'请等待当前保存、同步或刷新任务结束后调整权重':explanation} onClick={()=>onChange(action)}>
        <span aria-hidden="true">{action==='boost'?'↑':'↓'}</span>{names[action]}<small>{saving?'保存中':atLimit?action==='boost'?'已最高':'已最低':`至${CREATOR_TIER_LABELS[target]}`}</small>
      </button>
    })}</div>
    {mode&&<button type="button" className="creator-priority-reset" data-testid="creator-priority-reset" aria-label={`恢复自动 ${creator.nickname}`} disabled={disabled||saving} onClick={()=>onChange(null)}>恢复自动 · {CREATOR_TIER_LABELS[base]}</button>}
    <small className="creator-priority-scope">{creatorNeedsVerification(creator)?'异常待核验，暂不参与分组更新':`参与：${effective==='active'?'高频更新、全量更新':effective==='regular'?'中频更新、全量更新':effective==='inactive'?'低频更新、全量更新':'全量更新'}`}</small>
  </div>
}
