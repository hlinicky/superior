; electron-builder NSIS hooks for the Superior Windows installer (nsis.include).
;
; The terminal daemon runs from a copy of the app runtime under
; %LOCALAPPDATA%\Superior\daemon-host (src/main/services/daemonHost.ts), outside
; $INSTDIR, so the installer's process sweep leaves it and its terminals alive
; across updates. Keep the folder name in sync with HOST_ROOT_NAME there.

; ---------------------------------------------------------------------------
; Prefer the path-scoped process sweep.
;
; Upstream picks between killing processes whose image is under $INSTDIR
; (PowerShell/CIM) and `taskkill /IM Superior.exe`, which would also hit the
; relocated daemon (same exe name). Its capability check rejects hosts whose
; script policy is Restricted, although inline commands still run there. Test
; the actual query instead; any failure keeps the upstream image-name fallback,
; after which terminals simply start fresh.
; ---------------------------------------------------------------------------
; Defining the hook suppresses electron-builder's process-info declarations.
!include "getProcessInfo.nsh"
Var pid
Var /GLOBAL IsPowerShellAvailable

!macro customCheckAppRunning
  nsExec::Exec `"$PowerShellPath" -Command "try { Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }"`
  Pop $0
  StrCpy $IsPowerShellAvailable 1
  ${if} $0 == 0
    StrCpy $IsPowerShellAvailable 0
  ${endIf}
  !insertmacro _CHECK_APP_RUNNING
!macroend

; ---------------------------------------------------------------------------
; Remove the relocated daemon on a REAL uninstall.
;
; The ${isUpdated} guard is essential: electron-builder runs the old
; uninstaller on every update, and killing the daemon there would defeat the
; relocation. Filtered to the current user so an elevated uninstall can't reach
; another user's session.
; ---------------------------------------------------------------------------
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    Push $1
    Push $2
    ReadEnvStr $1 USERNAME
    ${if} $1 == ""
      StrCpy $2 ""
    ${else}
      StrCpy $2 '/FI "USERNAME eq $1"'
    ${endIf}
    nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" $2'
    Pop $0
    Pop $2
    Pop $1
    Pop $0
    ; Let the OS release the image lock before removing the tree.
    Sleep 500
    RMDir /r "$LOCALAPPDATA\Superior\daemon-host"
  ${endIf}
!macroend
