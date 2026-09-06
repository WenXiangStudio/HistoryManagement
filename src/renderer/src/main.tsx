import '@fontsource-variable/inter'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/noto-sans-sc/600.css'
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

if (window.signalDesk) {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} else {
  root.render(
    <main className="startup-failure" role="alert">
      <section>
        <p className="eyebrow">STARTUP CHECK FAILED</p>
        <h1>桌面服务连接失败</h1>
        <p>Signal Desk 的安全预加载桥没有启动。请先完全退出应用后重试；如果问题持续，请重新安装当前版本。</p>
        <p className="startup-failure-code">错误代码：PRELOAD_BRIDGE_UNAVAILABLE</p>
      </section>
    </main>
  )
}
