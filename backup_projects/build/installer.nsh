!include "StrFunc.nsh"
${StrRep}
${StrStr}

; ============================================================================
; NSIS OPTIMIZATIONS
; ============================================================================
SetCompressor /SOLID lzma
SetCompressorDictSize 32
SetDatablockOptimize on
AutoCloseWindow true


; ============================================================================
; SECURITY HELPERS
; ============================================================================

; Επαληθεύει αν ένα path είναι ασφαλές (LocalAppData ή AppData)
!macro ValidateUninstallerPath _PATH _RESULT
  Push "${_PATH}"
  Call ValidateUninstallerPathFunc
  Pop ${_RESULT}
!macroend

Function ValidateUninstallerPathFunc
  Exch $0  ; Path to validate
  Push $1
  Push $2

  ; Convert to lowercase για σύγκριση
  System::Call 'kernel32::CharLowerA(t r0) t .r0'

  ; Έλεγχος αν το path αρχίζει με AppData (per-user, δεν χρειάζεται admin)
  StrCpy $2 $0 8
  StrCmp $2 "c:\users" valid_path

  ; Μη έγκυρο path
  StrCpy $1 "0"
  Goto done

  valid_path:
  ; Έλεγχος ότι το αρχείο τελειώνει σε .exe
  StrCpy $2 $0 "" -4
  StrCmp $2 ".exe" 0 invalid_path
  StrCpy $1 "1"
  Goto done

  invalid_path:
  StrCpy $1 "0"

  done:
  Pop $2
  Exch $1
  Exch
  Pop $0
FunctionEnd


; ============================================================================
; customInit - Runs BEFORE installation
; ============================================================================
!macro customInit
  ; Ορισμός installation directory (per-user, χωρίς admin)
  StrCpy $INSTDIR "$LOCALAPPDATA\ThomasThanos\Backup-projects"

  ; ── ΑΥΤΟΜΑΤΟΣ ΕΛΕΓΧΟΣ: Αν είναι ήδη εγκατεστημένο το ίδιο version → skip ──
  ReadRegStr $R9 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  ${If} $R9 == "${VERSION}"
    MessageBox MB_ICONINFORMATION|MB_OK "Η έκδοση ${VERSION} είναι ήδη εγκατεστημένη.$\nΔεν απαιτείται επανεγκατάσταση."
    Abort
  ${EndIf}

  ; ── ΕΛΕΓΧΟΣ ΑΝ Η ΕΦΑΡΜΟΓΗ ΤΡΕΧΕΙ ──
  nsExec::ExecToStack 'wmic process where "name='\''Backup-projects.exe'\''" get ProcessId /FORMAT:LIST'
  Pop $0  ; Exit code
  Pop $1  ; Output

  ${If} $0 == 0
    ${StrStr} $2 $1 "ProcessId="
    ${If} $2 != ""
      StrCpy $0 0
      wait_for_exit:
        FindWindow $3 "" "Backup-projects"
        ${If} $3 == 0
          Goto process_exited
        ${EndIf}
        IntOp $0 $0 + 1
        IntCmp $0 5 process_exited
        Sleep 250
        Goto wait_for_exit
    ${EndIf}
  ${EndIf}

  process_exited:

  ; ── ΚΑΘΑΡΙΣΜΟΣ ΠΡΟΗΓΟΥΜΕΝΗΣ ΕΓΚΑΤΑΣΤΑΣΗΣ ──

  ; Έλεγχος HKCU registry key (per-user)
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Backup-projects" "UninstallString"
  StrCmp $R0 "" check_guid found_known_key

  check_guid:
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  StrCmp $R0 "" scan_registry found_known_key

  found_known_key:
  ${StrRep} $R0 $R0 '"' ''

  !insertmacro ValidateUninstallerPath $R0 $R1
  ${If} $R1 == "1"
  ${AndIf} ${FileExists} "$R0"
    ExecWait '"$R0" /S _?=$INSTDIR'
  ${Else}
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Backup-projects"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
  ${EndIf}
  Goto done_scanning

  scan_registry:
  StrCpy $0 0

  loop_registry:
  EnumRegKey $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
  StrCmp $1 "" done_scanning

  ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
  StrCmp $2 "" next_key

  StrCmp $2 "Backup-projects" found_orphan
  ${StrStr} $3 $2 "Backup-projects "
  StrCmp $3 "" next_key found_orphan

  found_orphan:
  ReadRegStr $4 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
  ${StrRep} $4 $4 '"' ''

  !insertmacro ValidateUninstallerPath $4 $R2
  ${If} $R2 == "1"
  ${AndIf} ${FileExists} "$4"
    ExecWait '"$4" /S _?=$INSTDIR'
  ${EndIf}

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1"
  IntOp $0 $0 - 1

  next_key:
  IntOp $0 $0 + 1
  Goto loop_registry

  done_scanning:
!macroend


; ============================================================================
; customInstall - Runs AFTER files are installed
; ============================================================================
!macro customInstall
  ; Δημιουργία parent directory
  CreateDirectory "$LOCALAPPDATA\ThomasThanos"

  ; Desktop & Start Menu shortcuts
  CreateShortCut "$DESKTOP\Project Backup.lnk" "$INSTDIR\Backup-projects.exe" "" "$INSTDIR\Backup-projects.exe" 0
  CreateShortCut "$SMPROGRAMS\Project Backup.lnk" "$INSTDIR\Backup-projects.exe" "" "$INSTDIR\Backup-projects.exe" 0

  StrCpy $R0 "${UNINSTALL_APP_KEY}"

  ; Εγγραφή στο HKCU (per-user, ΔΕΝ απαιτεί admin)
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "DisplayName" "Backup-projects ${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "Publisher" "ThomasThanos"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "DisplayIcon" "$INSTDIR\Backup-projects.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "HelpLink" "https://github.com/ThomasThanos/backup_projects"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "URLInfoAbout" "https://github.com/ThomasThanos/backup_projects"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "Comments" "Backup Manager for MakeYourLifeEasier - Project file backup & versioning"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "EstimatedSize" 0x00009600

  ; Legacy key
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Backup-projects" "DisplayName" "Backup-projects ${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Backup-projects" "UninstallString" '"$INSTDIR\Uninstall Backup-projects.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Backup-projects" "DisplayVersion" "${VERSION}"

  ; App Path registration (HKCU - χωρίς admin)
  WriteRegStr HKCU "Software\Microsoft\Windows\App Paths\Backup-projects.exe" "" "$INSTDIR\Backup-projects.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\App Paths\Backup-projects.exe" "Path" "$INSTDIR"
!macroend


; ============================================================================
; customUnInstall - Runs during uninstallation
; ============================================================================
!macro customUnInstall
  ; Αφαίρεση shortcuts
  Delete "$DESKTOP\Project Backup.lnk"
  Delete "$SMPROGRAMS\Project Backup.lnk"

  ; Καθαρισμός όλων των registry keys (HKCU)
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Backup-projects"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\App Paths\Backup-projects.exe"

  ${ifNot} ${isUpdated}
    ${If} ${FileExists} "$APPDATA\ThomasThanos\Backup-projects\*.*"
      RMDir /r "$APPDATA\ThomasThanos\Backup-projects"
    ${EndIf}
    RMDir "$APPDATA\ThomasThanos"
    RMDir "$LOCALAPPDATA\ThomasThanos"
    SetShellVarContext current
  ${endIf}
!macroend
