// Desktop diagnostics use the same collector as the APP extension.
(async()=>{
  document.getElementById('signaldesk-following-page-result')?.remove()
  const result=await collectVisibleFollowingBatch(globalThis.SIGNAL_DESK_FOLLOWING_BATCH_CONFIG)
  const output=document.createElement('textarea')
  output.id='signaldesk-following-page-result'
  output.setAttribute('aria-label','Signal Desk 关注页面读取结果')
  output.style.cssText='position:fixed;inset:40px;z-index:2147483647;background:white;color:black;font:14px monospace;padding:20px'
  output.value=JSON.stringify(result,null,2)
  document.body.appendChild(output)
})()
