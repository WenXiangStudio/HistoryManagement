if(location.pathname==='/following-connect'){
  const configNode=document.getElementById('following-config')
  if(configNode){
    const config=JSON.parse(configNode.textContent)
    if(config.nonce)chrome.runtime.sendMessage({type:'signaldesk.following.enroll',config}).catch(()=>{})
  }
  chrome.runtime.sendMessage({type:'signaldesk.following.connection'}).then(result=>{
    window.postMessage({type:'signaldesk.following.ready',...result},location.origin)
  }).catch(()=>{})
}
