!macro customInstall
  DetailPrint "Deploying Signal Desk browser connector to the stable local directory..."
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\browser-connector\install.ps1" -Browser Chrome'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "Browser connector deployment failed with exit code $0: $1"
    MessageBox MB_ICONEXCLAMATION|MB_OK "Signal Desk 已安装，但浏览器连接器未能自动部署。请关闭 Chrome 后，手动运行 resources\browser-connector\install.ps1。"
  ${Else}
    DetailPrint "$1"
  ${EndIf}
!macroend
