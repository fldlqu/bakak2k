// _official.mjs — 可导入的官方 AqKanji2Koe.dll 包装 (由 probe_official_k2k.mjs 抽出)
// 用途: 验证 bakak2k 修改后与官方 DLL 的一致程度 (读音首选 + ' 位置)
// 用法: node probe_official_k2k.mjs [文本...]   (默认: 一组对比词)
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import { V86Emu, REG_EAX, REG_ESP } from "../../../../../dist/v86_emu.js";
import { Heap, reg_read_uint32, reg_write_uint32 } from "../../../../../dist/emu_util.js";
import { push, call } from "../../../../../dist/x86_util.js";
import { to_bytes_uint32, from_bytes_uint32, uint8array_concat } from "../../../../../dist/util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dllPath = [path.join(__dirname, "aqk2k_win/lib/AqKanji2Koe.dll"), path.join(__dirname, "../../work/probes/aqk2k_win/lib/AqKanji2Koe.dll")].find((p) => fs.existsSync(p));
const dictPath = [path.join(__dirname, "../aqdic.bin"), path.join(__dirname, "../../work/aqdic.bin")].find((p) => fs.existsSync(p));
const dll = new Uint8Array(fs.readFileSync(dllPath));
const dict = fs.readFileSync(dictPath);
const BASE = 0x10000000;

// ---------- 解析导出地址 ----------
function getExports(dll) {
  const u16 = (a) => dll[a] | (dll[a + 1] << 8), u32 = (a) => (dll[a] | (dll[a + 1] << 8) | (dll[a + 2] << 16) | (dll[a + 3] << 24)) >>> 0;
  const pe = u32(0x3c), opt = pe + 24, dd = opt + 96, expRVA = u32(dd);
  const nsec = u16(pe + 6), optSize = u16(pe + 20), secBase = pe + 24 + optSize;
  const secs = [];
  for (let i = 0; i < nsec; i++) { const o = secBase + i * 40; secs.push({ va: u32(o + 12), rsize: u32(o + 16), ptr: u32(o + 20) }); }
  const rva2fo = (rva) => { const s = secs.find(s => rva >= s.va && rva < s.va + s.rsize); return s ? rva - s.va + s.ptr : null; };
  const fo = rva2fo(expRVA);
  const nNames = u32(fo + 24), funcsFO = rva2fo(u32(fo + 28)), ordsFO = rva2fo(u32(fo + 36)), namesFO = rva2fo(u32(fo + 32));
  const map = {};
  for (let i = 0; i < nNames; i++) {
    const nameRVA = u32(namesFO + i * 4), nameFO = rva2fo(nameRVA);
    let fn = ""; for (let k = 0; k < 64; k++) { const c = dll[nameFO + k]; if (!c) break; fn += String.fromCharCode(c); }
    const ord = u32(ordsFO + i * 2) & 0xffff;
    map[fn] = BASE + u32(funcsFO + ord * 4);
  }
  return map;
}

const emu = new V86Emu();
await emu.init({ wasmPath: path.join(__dirname, "../../../../../node_modules/v86/build/v86.wasm") });
{ const u16b = (a) => dll[a] | (dll[a + 1] << 8), u32 = (a) => (dll[a] | (dll[a + 1] << 8) | (dll[a + 2] << 16) | (dll[a + 3] << 24)) >>> 0;
  const pe = u32(0x3c), nsec = u16b(pe + 6), optSize = u16b(pe + 20), secBase = pe + 24 + optSize;
  for (let i = 0; i < nsec; i++) { const o = secBase + i * 40; const va = u32(o + 12), vsize = u32(o + 8), ptr = u32(o + 20), rsize = u32(o + 16);
    const sz = Math.max(vsize, rsize); const buf = new Uint8Array(sz); buf.set(dll.slice(ptr, ptr + Math.min(rsize, dll.length - ptr))); emu.mem_write(BASE + va, buf); } }
const heap = new Heap(emu, 0x20000000, 0x10000000);
{ const u16b = (a) => dll[a] | (dll[a + 1] << 8), u32 = (a) => (dll[a] | (dll[a + 1] << 8) | (dll[a + 2] << 16) | (dll[a + 3] << 24)) >>> 0;
  const pe = u32(0x3c), opt = pe + 24, dd = opt + 96, impRVA = u32(dd + 8), nsec = u16b(pe + 6), optSize = u16b(pe + 20), secBase = pe + 24 + optSize;
  const secs = []; for (let i = 0; i < nsec; i++) { const o = secBase + i * 40; secs.push({ va: u32(o + 12), ptr: u32(o + 20), rsize: u32(o + 16) }); }
  const rva2fo = (rva) => { const s = secs.find(s => rva >= s.va && rva < s.va + s.rsize); return s ? rva - s.va + s.ptr : null; };
  const iatThunks = {}; let off = rva2fo(impRVA);
  while (off !== null && off < dll.length) { const nameRVA = u32(off + 12), firstThunk = u32(off + 16); if (!nameRVA && !firstThunk) break; const thunkFO = rva2fo(firstThunk);
    for (let j = 0; j < 128; j++) { const t = u32(thunkFO + j * 4); if (!t) break;
      if (t & 0x80000000) { iatThunks["ord" + (t & 0xffff)] = firstThunk + j * 4; continue; }
      const nfo = rva2fo(t & 0x7fffffff); let fn = ""; if (nfo) for (let k = 2; k < 64; k++) { const c = dll[nfo + k]; if (!c) break; fn += String.fromCharCode(c); } iatThunks[fn] = firstThunk + j * 4; }
    off += 20; }
  const makeStub = (cb, argc) => { const addr = heap.set_mem_value(emu, new Uint8Array([0xc3]));
    emu.set_hook(addr, (e) => { const esp = reg_read_uint32(e, REG_ESP); const retaddr = from_bytes_uint32(e.mem_read(esp, 4)); const r = cb(e, esp);
      reg_write_uint32(e, REG_EAX, r === undefined ? 0 : r); e.set_eip(retaddr); reg_write_uint32(e, REG_ESP, esp + 4 + 4 * argc); }); return addr; };
  const u32at = (e, esp, o) => from_bytes_uint32(e.mem_read(esp + o, 4));
  const hooks = { GetProcessHeap: makeStub(() => 0x1, 0), HeapAlloc: makeStub((e, esp) => heap.set_mem_value(e, new Uint8Array(u32at(e, esp, 12))), 3),
    HeapFree: makeStub(() => 1, 3), HeapReAlloc: makeStub((e, esp) => heap.set_mem_value(e, new Uint8Array(u32at(e, esp, 16))), 4), HeapSize: makeStub(() => 0, 2), GetLastError: makeStub(() => 0, 0), SetLastError: makeStub(() => 0, 1), EnterCriticalSection: makeStub(() => 0, 1), LeaveCriticalSection: makeStub(() => 0, 1), DeleteCriticalSection: makeStub(() => 0, 1), InitializeCriticalSectionAndSpinCount: makeStub(() => 1, 2), GetCurrentProcess: makeStub(() => 1, 0), GetCurrentProcessId: makeStub(() => 1, 0), GetCurrentThreadId: makeStub(() => 1, 0), IsProcessorFeaturePresent: makeStub(() => 1, 1), QueryPerformanceCounter: makeStub(() => 0, 1), GetSystemTimeAsFileTime: makeStub(() => 0, 1), GetStartupInfoW: makeStub(() => 0, 1), GetModuleHandleW: makeStub(() => 0, 1), IsDebuggerPresent: makeStub(() => 0, 0), RtlUnwind: makeStub(() => 0, 4), TlsAlloc: makeStub(() => 0x100, 0), TlsGetValue: makeStub(() => 0, 1), TlsSetValue: makeStub(() => 1, 2), TlsFree: makeStub(() => 1, 1), FreeLibrary: makeStub(() => 1, 1), GetProcAddress: makeStub(() => 0, 2), LoadLibraryExW: makeStub(() => 0, 3), RaiseException: makeStub(() => 0, 3), ExitProcess: makeStub(() => 0, 1), GetModuleHandleExW: makeStub(() => 0, 3), GetModuleFileNameA: makeStub(() => 0, 3), GetModuleFileNameW: makeStub(() => 0, 3), GetACP: makeStub(() => 932, 0), GetOEMCP: makeStub(() => 932, 0), GetCPInfo: makeStub(() => 0, 2), GetCommandLineA: makeStub(() => 0, 0), GetCommandLineW: makeStub(() => 0, 0), MultiByteToWideChar: makeStub(() => 0, 6), WideCharToMultiByte: makeStub(() => 0, 8), GetEnvironmentStringsW: makeStub(() => 0, 0), FreeEnvironmentStringsW: makeStub(() => 0, 1), LCMapStringW: makeStub(() => 0, 6), GetStdHandle: makeStub(() => 0, 1), GetFileType: makeStub(() => 0, 1), GetStringTypeW: makeStub(() => 0, 4), SetStdHandle: makeStub(() => 1, 2), FlushFileBuffers: makeStub(() => 1, 1), WriteFile: makeStub(() => 1, 5), GetConsoleCP: makeStub(() => 0, 0), GetConsoleMode: makeStub(() => 0, 2), SetFilePointerEx: makeStub(() => 1, 4), WriteConsoleW: makeStub(() => 1, 5), DecodePointer: makeStub(() => 0, 1), FindClose: makeStub(() => 1, 1), FindFirstFileExA: makeStub(() => 0, 6), FindNextFileA: makeStub(() => 0, 2), FindFirstFileExW: makeStub(() => 0, 6), FindNextFileW: makeStub(() => 0, 2), UnhandledExceptionFilter: makeStub(() => 0, 1), SetUnhandledExceptionFilter: makeStub(() => 0, 1), TerminateProcess: makeStub(() => 0, 2), InitializeSListHead: makeStub(() => 0, 1), InterlockedFlushSList: makeStub(() => 0, 1), IsValidCodePage: makeStub(() => 1, 1), CreateFileW: makeStub(() => 0xffffffff, 7), CloseHandle: makeStub(() => 1, 1), EncodePointer: makeStub(() => 0, 1) };
  for (const [n, a] of Object.entries(hooks)) { if (iatThunks[n] !== undefined) emu.mem_write(BASE + iatThunks[n], to_bytes_uint32(a)); } }

const EXP = getExports(dll);
const dictAddr = heap.set_mem_value(emu, new Uint8Array(dict));
const errAddr = heap.set_mem_value(emu, new Uint8Array(4));
reg_write_uint32(emu, REG_ESP, 0x30000000);
push(emu, errAddr); push(emu, 0); push(emu, dictAddr);
const rf = heap.set_mem_value(emu, new Uint8Array(1048576).fill(0x90));
emu.set_eip(rf); call(emu, EXP.AqKanji2Koe_Create_Ptr);
try { emu.emu_start(emu.get_eip(), rf); } catch (e) { console.log("Create_Ptr err:", String(e).slice(0, 60)); process.exit(1); }
const h = reg_read_uint32(emu, REG_EAX) >>> 0;
if (!h) { console.log("Create_Ptr 失败"); process.exit(1); }

// 预分配输入/输出/返回帧缓冲, 避免每次调用耗尽模拟器堆
const IN_CAP = 65536, OUT_CAP = 65536;
const ka = heap.set_mem_value(emu, new Uint8Array(IN_CAP));
const ba = heap.set_mem_value(emu, new Uint8Array(OUT_CAP));
const rf2 = heap.set_mem_value(emu, new Uint8Array(1048576).fill(0x90));
const TD = new TextDecoder();
const TE = new TextEncoder();

function convert(text) {
  const kb = uint8array_concat(TE.encode(text), new Uint8Array([0]));
  emu.mem_write(ka, kb);
  emu.mem_write(ba, new Uint8Array(OUT_CAP));
  reg_write_uint32(emu, REG_ESP, 0x30000000);
  push(emu, OUT_CAP); push(emu, ba); push(emu, ka); push(emu, h);
  emu.set_eip(rf2); call(emu, EXP.AqKanji2Koe_Convert_utf8);
  try { emu.emu_start(emu.get_eip(), rf2); } catch (e) { return { err: String(e).slice(0, 40) }; }
  const ret = reg_read_uint32(emu, REG_EAX) >>> 0;
  const out = TD.decode(emu.mem_read(ba, OUT_CAP)).split("\0")[0];
  return { ret, out };
}

export { convert, emu, dictAddr, heap, BASE };
export const DICT_LEN = dict.length;
// Patch the in-emulator dict image at `off` (offset inside aqdic.bin).
export function patch(off, u8) { emu.mem_write(dictAddr + off, u8 instanceof Uint8Array ? u8 : new Uint8Array(u8)); }
export function readPatched(off, len) { return emu.mem_read(dictAddr + off, len); }
// Build a fresh handle (Create) — some state may be cached at Create time.
export function recreate() {
  const errAddr2 = heap.set_mem_value(emu, new Uint8Array(4));
  reg_write_uint32(emu, REG_ESP, 0x30000000);
  push(emu, errAddr2); push(emu, 0); push(emu, dictAddr);
  const rfx = heap.set_mem_value(emu, new Uint8Array(1048576).fill(0x90));
  emu.set_eip(rfx); call(emu, EXP.AqKanji2Koe_Create_Ptr);
  try { emu.emu_start(emu.get_eip(), rfx); } catch (e) { return null; }
  const h2 = reg_read_uint32(emu, REG_EAX) >>> 0;
  return h2 || null;
}
