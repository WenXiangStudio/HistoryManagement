import {useCallback,useLayoutEffect,useRef,type JSX,type ReactNode} from 'react'

const ICON_PATHS: Record<string, ReactNode> = {
    video: <><rect x="3" y="4" width="18" height="16" rx="4"/><path d="m10 8 6 4-6 4Z"/></>,
    inbox: <><path d="M4 5h16v12H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-4 2-6 5.5-6s5 2 5.5 6"/><circle cx="17" cy="9" r="2"/><path d="M16 14c3 0 4 1.5 4.5 4"/></>,
    queue: <><path d="M6 4h12M6 12h12M6 20h12"/><circle cx="3" cy="4" r=".5"/><circle cx="3" cy="12" r=".5"/><circle cx="3" cy="20" r=".5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5l2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.5c.1-.3.1-.7.1-1Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
    sync: <><path d="M20 7h-5V2"/><path d="M20 7a9 9 0 1 0 1 8"/></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    heart: <path d="M20 8c0 5-8 11-8 11S4 13 4 8c0-4 5-5 8-1 3-4 8-3 8 1Z"/>,
    comment: <path d="M4 5h16v11H9l-5 4Z"/>,
    bookmark: <path d="M7 4h10v16l-5-3-5 3Z"/>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    'chevron-up': <path d="m5 15 7-7 7 7"/>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    play: <path d="m7 4 13 8-13 8Z"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 19h16"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
    close: <path d="M5 5l14 14M19 5 5 19"/>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/><path d="M10 11v6M14 11v6"/></>,
    key: <><circle cx="8" cy="12" r="4"/><path d="M12 12h9m-3 0v3m-3-3v2"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 2 4 3 8 3s8-1 8-3V5M4 12v7c0 2 4 3 8 3s8-1 8-3v-7"/></>,
    workshop: <><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h4"/></>
  }
export function Icon({ name, size = 20 }: { name: string; size?: number }): JSX.Element {
  return <svg className={`icon icon-${name}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON_PATHS[name]}</svg>
}


export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }): JSX.Element {
  return <label className="search-box"><Icon name="search" size={18}/><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}/>{value && <button type="button" aria-label="清空搜索" onClick={() => onChange('')}><Icon name="close" size={14}/></button>}</label>
}


export function Avatar({ name, src, large = false }: { name: string; src: string | null; large?: boolean }): JSX.Element {
  return <span className={`avatar ${large ? 'large' : ''}`}>{src ? <img src={src} alt=""/> : name.slice(0, 1)}</span>
}

/** Stable UI handlers let unrelated cards skip rendering while using current state. */
export function useEventCallback<Args extends unknown[],Result>(callback:(...args:Args)=>Result):(...args:Args)=>Result{
  const current=useRef(callback)
  useLayoutEffect(()=>{current.current=callback})
  return useCallback((...args:Args)=>current.current(...args),[])
}
