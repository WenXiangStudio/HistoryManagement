async function refresh(){
  const result=await chrome.runtime.sendMessage({type:'signaldesk.following.connection'})
  const {lastFollowingResult}=await chrome.storage.local.get('lastFollowingResult')
  document.getElementById('status').textContent=result.online?'APP 已连接，正在由 APP 自动检查账号页面。准备完成后即可同步。':'请启动 APP；首次安装或更新后重新加载本扩展。'
  document.getElementById('result').textContent=lastFollowingResult?.message||''
}
void refresh()
