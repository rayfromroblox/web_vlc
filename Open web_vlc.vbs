Set shell = CreateObject("WScript.Shell")
launcher = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - 4) & ".bat"
shell.Run Chr(34) & launcher & Chr(34), 0, False
