const ID = /^[A-Za-z0-9._-]{1,240}$/
const httpsUrl = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : null } catch { return null }
}
export function projectFollowingResponse(body) {
  const root = body?.data && typeof body.data === 'object' ? body.data : body
  if (!root || (root.status_code !== undefined && root.status_code !== 0)) throw new Error('FOLLOWING_RESPONSE_STATUS_INVALID')
  const users = root.user_list ?? root.users ?? root.followings
  if (!Array.isArray(users)) throw new Error('FOLLOWING_RESPONSE_SCHEMA_CHANGED')
  const creators = users.slice(0,10).map((user) => {
    if (!ID.test(user.uid || '') || !ID.test(user.sec_uid || '') || typeof user.nickname !== 'string' || !user.nickname.trim()) {
      throw new Error('FOLLOWING_CREATOR_IDENTITY_INVALID')
    }
    const avatars = user.avatar_thumb?.url_list ?? user.avatar_medium?.url_list ?? user.avatar_larger?.url_list ?? []
    return {
      uid: user.uid, secUid: user.sec_uid, nickname: user.nickname.slice(0,200),
      avatarUrl: avatars.map(httpsUrl).find(Boolean) ?? null,
      signature: typeof user.signature === 'string' ? user.signature.slice(0,2000) : '',
      profileUrl: `https://www.douyin.com/user/${encodeURIComponent(user.sec_uid)}`
    }
  })
  if (new Set(creators.map((item) => item.uid)).size !== creators.length
    || new Set(creators.map((item) => item.secUid)).size !== creators.length) throw new Error('FOLLOWING_DUPLICATE_IDENTITIES')
  if (![true,false,0,1].includes(root.has_more)) throw new Error('FOLLOWING_HAS_MORE_UNKNOWN')
  return { creators, hasMore: root.has_more === true || root.has_more === 1, responseItemCount: users.length }
}
export function followingRequest(url) {
  const parsed = new URL(url)
  if (parsed.origin !== 'https://www.douyin.com' || parsed.pathname !== '/aweme/v1/web/user/following/list/') return null
  const ownerSecUid = parsed.searchParams.get('sec_user_id')
  if (!ID.test(ownerSecUid || '')) throw new Error('FOLLOWING_OWNER_MISSING')
  for (const key of ['offset','cursor','max_cursor']) {
    const value = parsed.searchParams.get(key)
    if (value !== null && !/^0+$/.test(value)) throw new Error('FOLLOWING_NOT_FIRST_PAGE')
  }
  return { ownerSecUid }
}

export function followingFailureMessage(code, detachReason = null) {
  if (code === 'BROWSER_DEBUGGER_DETACHED') {
    if (detachReason === 'canceled_by_user') return 'Chrome 已结束本轮采集连接，本轮没有保存关注结果。若要继续，请从 APP 重新开始；采集期间请保留顶部连接提示，并关闭该抖音标签页的开发者工具。'
    if (detachReason === 'target_closed') return '采集使用的抖音标签页已关闭，本轮没有保存关注结果。请从 APP 重新开始，并保留自动打开的标签页。'
    return 'Chrome 采集连接已断开，本轮没有保存关注结果。尚不能确定断开原因，请从 APP 查看本轮失败记录。'
  }
  if (code === 'LOGIN_REQUIRED') return '抖音要求登录，本轮没有保存关注结果。请在当前 Chrome 用户完成登录，再从 APP 重新开始。'
  if (code === 'CAPTCHA_OR_SECURITY_CHALLENGE') return '抖音出现安全验证，采集已停止，本轮没有保存关注结果。请先在浏览器人工处理。'
  if (code === 'APP_SESSION_ENDED') return 'APP 已结束或取消本轮同步，浏览器操作已停止。'
  if (code === 'FOLLOWING_FIRST_RESPONSE_NOT_OBSERVED') return '已打开关注列表，但没有读到可信的第一页响应，本轮没有保存关注结果。请返回 APP 查看本轮失败记录。'
  return `关注同步未完成（${code}），本轮没有保存关注结果。请返回 APP 查看本轮失败记录。`
}
