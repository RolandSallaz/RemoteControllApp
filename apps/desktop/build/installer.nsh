!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh

  Var RemoteControlDesktopShortcutCheckbox
  Var RemoteControlDesktopShortcutState

  !macro customInit
    StrCpy $RemoteControlDesktopShortcutState ${BST_CHECKED}
  !macroend

  !macro customPageAfterChangeDir
    Function RemoteControlInstallOptionsPageCreate
      ${if} ${isUpdated}
        Abort
      ${endif}

      !insertmacro MUI_HEADER_TEXT "Дополнительные задачи" "Выберите дополнительные действия перед установкой."
      nsDialogs::Create 1018
      Pop $0

      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateCheckbox} 0 0u 100% 12u "Создать ярлык на рабочем столе"
      Pop $RemoteControlDesktopShortcutCheckbox

      ${If} $RemoteControlDesktopShortcutState == ${BST_CHECKED}
        ${NSD_Check} $RemoteControlDesktopShortcutCheckbox
      ${EndIf}

      nsDialogs::Show
    FunctionEnd

    Function RemoteControlInstallOptionsPageLeave
      ${NSD_GetState} $RemoteControlDesktopShortcutCheckbox $RemoteControlDesktopShortcutState
    FunctionEnd

    Page custom RemoteControlInstallOptionsPageCreate RemoteControlInstallOptionsPageLeave
  !macroend

  !macro customInstall
    ${If} $RemoteControlDesktopShortcutState != ${BST_CHECKED}
      Delete "$newDesktopLink"
    ${EndIf}
  !macroend
!endif
