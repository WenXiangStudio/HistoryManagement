async function refresh(){
  const result=await chrome.runtime.sendMessage({type:'signaldesk.following.connection'})
  const {lastFollowingResult}=await chrome.storage.local.get('lastFollowingResult')
  document.getElementById('status').textContent=result.online?'APP 已连接。点击同步关注清单时检查抖音账号，缺失基础资料和作品动态分别更新。':'请启动 APP；首次安装或更新后重新加载本扩展。'
  document.getElementById('result').textContent=lastFollowingResult?.message||''
}
void refresh()
