# -*- coding: utf-8 -*-
!include "LogicLib.nsh"
!include "WordFunc.nsh"
!include "${PROJECT_DIR}/resources/windows/vc-redist-version.nsh"

; MUI hides the launch checkbox when a reboot is required. Never restart by default.
!define MUI_FINISHPAGE_REBOOTLATER_DEFAULT


; Reject unsupported systems before prerequisites or an older installation change.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${RunningX64}
    ${OrIf} ${IsNativeARM64}
      MessageBox MB_OK|MB_ICONSTOP "声悦需要 Windows x64（Intel / AMD 64 位）。当前不支持 32 位 Windows 或 Windows ARM。" /SD IDOK
      SetErrorLevel 1633
      Quit
    ${EndIf}
    Push $0
    Push $1
    Push $2
    ${StdUtils.GetRealOSVersion} $0 $1 $2
    ${StdUtils.GetRealOSBuildNo} $2
    ${If} $0 < 10
    ${OrIf} $2 < 19041
      MessageBox MB_OK|MB_ICONSTOP "声悦需要 Windows 10 2004（系统内部版本 19041）或以上，推荐 Windows 11。请先升级系统。" /SD IDOK
      SetErrorLevel 1633
      Quit
    ${EndIf}
    Pop $2
    Pop $1
    Pop $0
  !endif
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Var ShengyueVCReady
    Var ShengyueVCAction
    Var ShengyueVCExit
    Var ShengyueVCLog

    Function ShengyueDetectVCRuntime
      Push $0
      Push $1
      Push $2
      Push $3
      Push $4
      StrCpy $ShengyueVCReady "0"
      StrCpy $ShengyueVCAction "/install"
      ; The app and its Python wheels are x64; do not accept the x86 runtime.
      SetRegView 64
      ClearErrors
      ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
      StrCmp $0 "1" 0 vc_detect_done
      ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Major"
      ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Minor"
      ReadRegDWORD $2 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Bld"
      ReadRegDWORD $3 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Rbld"
      IfErrors vc_detect_done
      ${VersionCompare} "$0.$1.$2.$3" "${SHENGYUE_VC_VERSION}" $4
      StrCmp $4 "2" vc_detect_done
      ; An equal/newer registered runtime with missing DLLs needs repair.
      StrCpy $ShengyueVCAction "/repair"
      ; NSIS is a 32-bit process: Sysnative resolves to the actual x64 System32.
      IfFileExists "$WINDIR\Sysnative\vcruntime140.dll" 0 vc_detect_done
      IfFileExists "$WINDIR\Sysnative\vcruntime140_1.dll" 0 vc_detect_done
      IfFileExists "$WINDIR\Sysnative\msvcp140.dll" 0 vc_detect_done
      StrCpy $ShengyueVCReady "1"
      vc_detect_done:
      Pop $4
      Pop $3
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd

    Function ShengyueEnsureVCRuntime
      Call ShengyueDetectVCRuntime
      StrCmp $ShengyueVCReady "1" vc_already_ready
      InitPluginsDir
      SetDetailsPrint both
      DetailPrint "正在准备 Windows 配音运行组件，请允许微软安装程序的系统授权提示…"
      StrCpy $ShengyueVCLog "$TEMP\Shengyue-vc-redist.log"
      File /oname=$PLUGINSDIR\Shengyue-vc_redist.x64.exe "${PROJECT_DIR}/resources/windows/vc_redist.x64.exe"
      ${StdUtils.HashFile} $0 "SHA2-256" "$PLUGINSDIR\Shengyue-vc_redist.x64.exe"
      StrCmp $0 "${SHENGYUE_VC_SHA256}" 0 vc_integrity_failed
      StrCpy $ShengyueVCExit "-1"
      ClearErrors
      ; Burn requests elevation itself. The application remains a per-user install,
      ; even when a different administrator authorizes the system prerequisite.
      ExecWait '"$PLUGINSDIR\Shengyue-vc_redist.x64.exe" $ShengyueVCAction /quiet /norestart /log "$ShengyueVCLog"' $ShengyueVCExit
      IfErrors vc_install_failed
      Delete "$PLUGINSDIR\Shengyue-vc_redist.x64.exe"
      StrCmp $ShengyueVCExit "3010" vc_reboot_required
      StrCmp $ShengyueVCExit "1641" vc_reboot_required
      StrCmp $ShengyueVCExit "0" vc_verify_installed
      ; A newer version may have been installed concurrently. Never downgrade it;
      ; accept ERROR_PRODUCT_VERSION only when post-install detection also passes.
      StrCmp $ShengyueVCExit "1638" vc_verify_installed
      StrCmp $ShengyueVCExit "-2147023258" vc_verify_installed
      Goto vc_install_failed
      vc_verify_installed:
      Call ShengyueDetectVCRuntime
      StrCmp $ShengyueVCReady "1" vc_already_ready vc_install_failed
      vc_reboot_required:
      SetRebootFlag true
      DetailPrint "Windows 配音运行组件已安装，请重启电脑后再开始配音。"
      SetDetailsPrint lastused
      Return
      vc_already_ready:
      DetailPrint "Windows 配音运行组件已就绪。"
      Return
      vc_integrity_failed:
      StrCpy $ShengyueVCExit "INTEGRITY"
      vc_install_failed:
      Delete "$PLUGINSDIR\Shengyue-vc_redist.x64.exe"
      MessageBox MB_OK|MB_ICONSTOP "Windows 配音运行组件未能安装，声悦安装已停止。$\r$\n请允许系统管理员授权后重新运行声悦安装包。$\r$\n错误码：$ShengyueVCExit$\r$\n诊断日志：$ShengyueVCLog" /SD IDOK
      SetErrorLevel 1
      Quit
    FunctionEnd

    ; Run before electron-builder's install section removes an older app version.
    ; A denied elevation or prerequisite failure must leave the old app untouched.
    Section "-Windows 配音运行组件"
      Call ShengyueEnsureVCRuntime
    SectionEnd
  !endif
!macroend

!macro customInstall
  ; Quit before electron-builder's --force-run path when a silent install needs
  ; rebooting. Interactive installs instead use MUI's normal reboot finish page.
  IfRebootFlag 0 vc_custom_install_done
  IfSilent 0 vc_custom_install_done
    SetErrorLevel 3010
    Quit
  vc_custom_install_done:
!macroend
