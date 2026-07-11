# Ground-truth probe: shows every visible top-level chrome/msedge window title,
# exactly as the app's meeting detector (LocalProvider WINDOW_ENUM_SCRIPT) sees them.
# Usage: powershell -NoProfile -File scripts/enum-chrome-windows.ps1
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class JDNWin { public string Title; public int Pid; }
public class JDNWindows {
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  private delegate bool EnumProc(IntPtr h, IntPtr p);
  public static List<JDNWin> Get() {
    var r = new List<JDNWin>();
    EnumProc cb = (h, p) => {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      r.Add(new JDNWin { Title = sb.ToString(), Pid = (int)pid });
      return true;
    };
    EnumWindows(cb, IntPtr.Zero);
    GC.KeepAlive(cb);
    return r;
  }
}
"@
$byPid = @{}
Get-Process chrome, msedge -ErrorAction SilentlyContinue | ForEach-Object { $byPid[$_.Id] = $_.ProcessName }
[JDNWindows]::Get() | Where-Object { $byPid.ContainsKey($_.Pid) } | ForEach-Object {
  "{0,-8} pid={1,-7} ""{2}""" -f $byPid[$_.Pid], $_.Pid, $_.Title
}
