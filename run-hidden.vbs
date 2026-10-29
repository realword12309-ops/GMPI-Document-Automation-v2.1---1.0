' Starts the GMPI server in the background (no window). Used by the Windows auto-start task.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
logdir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\GMPI-Document-Automation"
If Not CreateObject("Scripting.FileSystemObject").FolderExists(logdir) Then CreateObject("Scripting.FileSystemObject").CreateFolder(logdir)
sh.CurrentDirectory = dir
sh.Run "cmd /c node server\index.js >> """ & logdir & "\server.log"" 2>&1", 0, False
