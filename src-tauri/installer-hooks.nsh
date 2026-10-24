/*
 * Pre-install checks for LexiFlow.
 *
 * The common failure when installing over an older copy is that the running
 * application still holds `lexiflow.exe`, so NSIS reports "无法打开要写入的
 * 文件" halfway through without saying what to do about it.
 *
 * The check is purely local: it tries to open the file about to be replaced.
 * If that fails, something holds it, and only then is the user asked to close
 * the application. No external command is run, because `nsExec` blocks under
 * some Windows configurations and left the installer hanging.
 */

/* Whether the main binary in $INSTDIR is locked. Sets $R0 to "1" or "0". */
!macro LexiFlowFileLocked
  StrCpy $R0 "0"
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ClearErrors
    FileOpen $3 "$INSTDIR\${MAINBINARYNAME}.exe" a
    ${If} $3 == ""
      StrCpy $R0 "1"
    ${Else}
      FileClose $3
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro LexiFlowFileLocked

  ${If} $R0 == "1"
    ${If} ${Silent}
      /* Nobody can answer a prompt during an unattended upgrade. */
      Abort "LexiFlow 正在运行，无法覆盖安装。请关闭 LexiFlow 后重试。"
    ${Else}
      MessageBox MB_OK|MB_ICONSTOP \
        "LexiFlow 正在运行，安装程序无法替换它的文件。$\r$\n$\r$\n请按以下步骤操作：$\r$\n$\r$\n1. 按 Ctrl+Shift+Esc 打开任务管理器$\r$\n2. 在「进程」里找到 lexiflow.exe$\r$\n3. 右键选择「结束任务」$\r$\n4. 回到安装程序，点「重试」$\r$\n$\r$\n如果找不到这个进程，或结束之后仍然提示，请重启电脑再安装。"
      Abort "安装已暂停：请先关闭 LexiFlow。"
    ${EndIf}
  ${EndIf}
!macroend
