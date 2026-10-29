"""Hold a test directory without FILE_SHARE_DELETE; release when stdin closes."""
import ctypes
import sys
from ctypes import wintypes

kernel = ctypes.WinDLL("kernel32", use_last_error=True)
kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                              ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
kernel.CreateFileW.restype = wintypes.HANDLE
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
handle = kernel.CreateFileW(sys.argv[1], 1, 1 | 2, None, 3, 0x02000000, None)
if handle == wintypes.HANDLE(-1).value:
    raise ctypes.WinError(ctypes.get_last_error())
try:
    probe = kernel.CreateFileW(sys.argv[1], 0x00010000, 1 | 2 | 4, None, 3, 0x02000000, None)
    if probe != wintypes.HANDLE(-1).value:
        kernel.CloseHandle(probe)
        raise AssertionError("Directory lock did not deny delete access")
    if ctypes.get_last_error() != 32:
        raise ctypes.WinError(ctypes.get_last_error())
    print("READY:DELETE_DENIED", flush=True)
    sys.stdin.read(1)
finally:
    kernel.CloseHandle(handle)
