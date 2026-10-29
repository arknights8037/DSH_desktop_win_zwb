!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
!macro customHeader
  ShowInstDetails show
!macroend
LangString DshInstallComplete 1033 "Program files are installed. First startup may prepare the selected kernel and plugins; progress and diagnostics are shown in the application."
LangString DshInstallComplete 2052 "程序文件已安装。首次启动可能准备所选内核和插件，应用内会显示进度和诊断。"

!endif

!ifdef APP_ID
!ifndef BUILD_UNINSTALLER
!include "nsDialogs.nsh"
!include "StrFunc.nsh"
${StrRep}
Var DshDataPath
Var DshDataInput
Var DshDataDialog
Var DshLocatorPath

LangString DshDataTitle 1033 "Data directory"
LangString DshDataTitle 2052 "数据目录"
LangString DshDataHelp 1033 "Choose where local instances, conversations, plugins and settings are stored. Existing installations retain their data location; use Settings > Storage to move data."
LangString DshDataHelp 2052 "选择本地实例、会话、插件和设置的数据存储位置。已有安装保留原数据位置；迁移数据请使用应用内的设置 → 存储。"
LangString DshBrowse 1033 "Browse…"
LangString DshBrowse 2052 "浏览…"
LangString DshDataError 1033 "Cannot write this data location. Choose an absolute writable directory outside the application installation."
LangString DshDataError 2052 "无法写入此数据位置，请选择程序安装目录以外的可写绝对路径。"

!macro customPageAfterChangeDir
  Page custom DshDataPage DshDataPageLeave

Function DshDataPage
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  SetShellVarContext current
  StrCpy $DshLocatorPath "$APPDATA\DshManager"
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
  IfFileExists "$DshLocatorPath\data-location.json" 0 +2
    Abort
  IfFileExists "$PROFILE\.dsh\desktop\agent-manager\instances.json" 0 +2
    Abort
  !insertmacro MUI_HEADER_TEXT "$(DshDataTitle)" "$(DshDataHelp)"
  nsDialogs::Create 1018
  Pop $DshDataDialog
  ${NSD_CreateLabel} 0 0 100% 44u "$(DshDataHelp)"
  Pop $0
  ${If} $DshDataPath == ""
    StrCpy $DshDataPath "$PROFILE\.dsh"
  ${EndIf}
  ${NSD_CreateDirRequest} 0 54u 78% 14u "$DshDataPath"
  Pop $DshDataInput
  ${NSD_CreateBrowseButton} 80% 54u 20% 14u "$(DshBrowse)"
  Pop $0
  ${NSD_OnClick} $0 DshBrowseData
  nsDialogs::Show
FunctionEnd

Function DshBrowseData
  Pop $0
  nsDialogs::SelectFolderDialog "$(DshDataTitle)" "$DshDataPath"
  Pop $0
  ${If} $0 != "error"
    ${NSD_SetText} $DshDataInput $0
  ${EndIf}
FunctionEnd

Function DshDataPageLeave
  ${NSD_GetText} $DshDataInput $DshDataPath
  ${GetRoot} "$DshDataPath" $0
  ${If} $0 == ""
    MessageBox MB_ICONSTOP "$(DshDataError)"
    Abort
  ${EndIf}
  StrCpy $1 "$DshDataPath" 1 2
  StrCpy $2 "$DshDataPath" 2
  ${If} $1 != "\"
  ${AndIf} $1 != "/"
  ${AndIf} $2 != "\\"
    MessageBox MB_ICONSTOP "$(DshDataError)"
    Abort
  ${EndIf}
  ; GetFullPathName normalizes dot segments before checking the install subtree.
  GetFullPathName $DshDataPath "$DshDataPath"
  GetFullPathName $0 "$INSTDIR"
  ${If} $DshDataPath == $0
    MessageBox MB_ICONSTOP "$(DshDataError)"
    Abort
  ${EndIf}
  StrCpy $0 "$0\"
  StrLen $1 $0
  StrCpy $2 $DshDataPath $1
  ${If} $2 == $0
    MessageBox MB_ICONSTOP "$(DshDataError)"
    Abort
  ${EndIf}
  ClearErrors
  CreateDirectory "$DshDataPath"
  GetTempFileName $0 "$DshDataPath"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "$(DshDataError)"
    Abort
  ${EndIf}
  Delete "$0"
FunctionEnd
!macroend
!endif
!endif

!macro customInstall
  !ifndef BUILD_UNINSTALLER
  SetDetailsPrint both
  DetailPrint "$(DshInstallComplete)"
  !endif
  Push $0
  StrCpy $0 0
  ${If} ${Errors}
    StrCpy $0 1
  ${EndIf}
  !ifdef APP_ID
  !ifndef BUILD_UNINSTALLER
    ${If} $DshDataPath != ""
      Push $1
      Push $2
      SetShellVarContext current
      StrCpy $DshLocatorPath "$APPDATA\DshManager"
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
      ClearErrors
      CreateDirectory "$DshLocatorPath"
      ${StrRep} $1 $DshDataPath "\" "/"
      GetTempFileName $DshDataDialog "$DshLocatorPath"
      FileOpen $2 "$DshDataDialog" w
      FileWriteWord $2 0xFEFF
      FileWriteUTF16LE $2 '{$\"version$\":1,$\"home$\":$\"$1$\"}$\r$\n'
      FileClose $2
      Rename "$DshDataDialog" "$DshLocatorPath\data-location.json"
      ${If} ${Errors}
        Delete "$DshDataDialog"
        MessageBox MB_ICONSTOP "$(DshDataError)"
        Abort
      ${EndIf}
      Pop $2
      Pop $1
    ${EndIf}
  !endif
  !endif
  ; Finish can launch the app while NSIS removes its remaining plugin directory.
  RMDir /r "$PLUGINSDIR\7z-out"
  ${If} $0 == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $0
!macroend
