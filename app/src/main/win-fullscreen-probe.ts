import { spawn } from 'node:child_process'
import path from 'node:path'
import { createInterface } from 'node:readline'

const NATIVE_PROBE = String.raw`
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class UtaFullscreenProbe {
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetWindowLongW(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfoW(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("shell32.dll")] private static extern int SHQueryUserNotificationState(out int state);

    private static bool IsFullscreen(IntPtr pet, int ownerPid, StringBuilder name) {
        IntPtr front = GetForegroundWindow();
        if (front == IntPtr.Zero || front == pet || front == GetShellWindow() ||
            !IsWindowVisible(front) || IsIconic(front)) return false;
        uint foregroundPid;
        if (GetWindowThreadProcessId(front, out foregroundPid) == 0 || foregroundPid == ownerPid) return false;
        name.Clear();
        GetClassName(front, name, name.Capacity);
        string windowClass = name.ToString();
        if (windowClass == "Progman" || windowClass == "WorkerW" ||
            windowClass == "Shell_TrayWnd" || windowClass == "Shell_SecondaryTrayWnd") return false;

        IntPtr monitor = MonitorFromWindow(front, 0);
        if (monitor == IntPtr.Zero || monitor != MonitorFromWindow(pet, 2)) return false;
        int shellState;
        if (SHQueryUserNotificationState(out shellState) == 0 && shellState == 3) return true;

        // A normal maximized window can touch the screen edges with an auto-hidden taskbar.
        const int WindowStyle = -16;
        const int Caption = 0x00C00000;
        if (IsZoomed(front) && (GetWindowLongW(front, WindowStyle) & Caption) == Caption) return false;

        MonitorInfo info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
        Rect client;
        if (!GetMonitorInfoW(monitor, ref info) || !GetClientRect(front, out client)) return false;
        Point topLeft = new Point { X = client.Left, Y = client.Top };
        Point bottomRight = new Point { X = client.Right, Y = client.Bottom };
        if (!ClientToScreen(front, ref topLeft) || !ClientToScreen(front, ref bottomRight)) return false;
        const int Tolerance = 2;
        return Math.Abs(topLeft.X - info.Monitor.Left) <= Tolerance &&
            Math.Abs(topLeft.Y - info.Monitor.Top) <= Tolerance &&
            Math.Abs(bottomRight.X - info.Monitor.Right) <= Tolerance &&
            Math.Abs(bottomRight.Y - info.Monitor.Bottom) <= Tolerance;
    }

    public static void Run(long hwnd, int ownerPid) {
        IntPtr pet = IntPtr.Size == 8 ? new IntPtr(hwnd) : new IntPtr(unchecked((int)hwnd));
        // Compare native monitor and client coordinates in the same DPI space.
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) {}
        using (Process owner = Process.GetProcessById(ownerPid)) {
            StringBuilder name = new StringBuilder(128);
            while (!owner.HasExited) {
                Console.WriteLine(IsFullscreen(pet, ownerPid, name) ? "1" : "0");
                Thread.Sleep(300);
            }
        }
    }
}
`

/** One hidden Win32 probe per pet window. Windows PowerShell ships with the OS. */
export function startWindowsFullscreenProbe(
  windowHandle: Buffer,
  onSample: (occupied: boolean) => void,
  onUnavailable: () => void,
): () => void {
  const hwnd = windowHandle.length === 8 ? windowHandle.readBigUInt64LE() : BigInt(windowHandle.readUInt32LE())
  const script = `$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${NATIVE_PROBE}\n'@\n[UtaFullscreenProbe]::Run(${hwnd}, ${process.pid})`
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const lines = createInterface({ input: child.stdout })
  let stopped = false
  let timeout = setTimeout(failed, 4000)

  function stop(): void {
    if (stopped) return
    stopped = true
    clearTimeout(timeout)
    lines.close()
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }

  function failed(): void {
    if (stopped) return
    stop()
    onUnavailable()
  }

  child.once('error', failed)
  child.once('close', failed)
  lines.on('line', line => {
    if (stopped || (line !== '0' && line !== '1')) return
    clearTimeout(timeout)
    timeout = setTimeout(failed, 2500)
    onSample(line === '1')
  })
  return stop
}
