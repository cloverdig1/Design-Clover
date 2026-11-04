!macro customInstall
  ReadRegStr $0 HKCU "Software\Classes\.dc" ""
  StrCmp $0 "" 0 +2
  WriteRegStr HKCU "Software\Classes\.dc" "" "DesignClover.Project"
  WriteRegStr HKCU "Software\Classes\.dc\OpenWithProgids" "DesignClover.Project" ""
  WriteRegStr HKCU "Software\Classes\DesignClover.Project" "" "Design Clover Project"
  WriteRegStr HKCU "Software\Classes\DesignClover.Project\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\DesignClover.Project\shell\open\command" "" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ReadRegStr $0 HKCU "Software\Classes\.dc" ""
  StrCmp $0 "DesignClover.Project" 0 +2
  DeleteRegValue HKCU "Software\Classes\.dc" ""
  DeleteRegValue HKCU "Software\Classes\.dc\OpenWithProgids" "DesignClover.Project"
  DeleteRegKey HKCU "Software\Classes\DesignClover.Project"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
