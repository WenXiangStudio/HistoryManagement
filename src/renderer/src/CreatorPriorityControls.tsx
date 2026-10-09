import type {JSX} from 'react'
import type {CreatorListItem} from '../../shared/contracts'
import {creatorAutomaticTier,effectiveCreatorTier} from '../../shared/creatorRefreshPolicy'
import {adjustedCreatorTier,CREATOR_TIER_LABELS,type CreatorPriorityMode} from '../../shared/creatorPriority'

export default function CreatorPriorityControls({creator,disabled,onChange}:{creator:CreatorListItem;disabled:boolean;onChange:(mode:CreatorPriorityMode|null)=>void}):JSX.Element{
  const base=creatorAutomaticTier(creator),effective=effectiveCreatorTier(creator),mode=creator.refreshPriority?.mode??null
  const names={boost:'加权',reduce:'降权'}
  return <div className={`creator-priority ${mode?'has-priority':''}`} data-testid="creator-priority">
    <div className="creator-priority-heading"><span>活跃程度</span><strong className={`creator-tier-badge tier-${effective}`} data-testid="creator-effective-tier">{CREATOR_TIER_LABELS[effective]}</strong>
      {mode&&<span className="creator-priority-state" data-testid="creator-priority-state">{names[mode]}生效</span>}</div>
    <p className="creator-priority-origin">{mode?`原始：${CREATOR_TIER_LABELS[base]} · 手动等级优先生效`:'按发布间隔与最近核验结果分类 · 未启用手动权重'}</p>
    <div className="creator-priority-actions">{(['boost','reduce'] as const).map(action=>{
      const enabled=mode===action,target=adjustedCreatorTier(base,action)
      const explanation=enabled?'点击关闭，恢复按发布间隔与最近核验结果自动分类':`开启后${base===target?'保持':'调整为'}${CREATOR_TIER_LABELS[target]}，手动等级优先生效${mode?'；同时关闭'+names[mode]:''}`
      return <button type="button" key={action} data-testid={`creator-priority-${action}`} aria-label={`${names[action]} ${creator.nickname}`} aria-pressed={enabled} disabled={disabled}
        title={disabled?'请等待当前保存、同步或刷新任务结束后调整权重':explanation} onClick={()=>onChange(enabled?null:action)}>
        <span aria-hidden="true">{action==='boost'?'↑':'↓'}</span>{names[action]}<small>{enabled?'已开启':'关闭'}</small>
      </button>
    })}</div>
    <small className="creator-priority-scope">{creator.activity?.anomaly?'异常待核验，暂不参与分组更新':`参与：${effective==='active'?'高频更新、全量更新':effective==='regular'?'中频更新、全量更新':effective==='inactive'?'低频更新、全量更新':'全量更新'}`}{mode?' · 再次点击已开启按钮可关闭':''}</small>
  </div>
}
