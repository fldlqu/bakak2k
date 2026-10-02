// accent_trace.mjs — 公式 AqKanji2Koe.dll の「辞書読み出し」と「アクセント結合ノード」を観測する
//
// 仕組み: v86 の wasm CPU は RAM 外 (>= memory_size) の物理アドレス読み書きだけを JS の
// memory_map_read8/read32 へ委譲する (RAM 内の mmap_register は無視される — 実験で確認済み)。
// そこで辞書イメージを 1GB 以上の 0x40000000 に置いて mmap_register でフックすると、
// DLL が辞書のどのバイトを読んだかが全て見える。
//
// 用法 (work/probes/aqk2k_win/lib/AqKanji2Koe.dll と work/aqdic.bin が必要):
//   node --no-warnings eval/tools/accent_trace.mjs 十年前
//   node --no-warnings eval/tools/accent_trace.mjs --nodes 十年前 話します
//
// 注意: set_hook は Win32 スタブでポート 0xE0.. を使い切るため使えない。自前で空きポートに
// OUT トランポリンを書いてフックする (node_trace 参照)。
// _trace2.mjs — 公式 AqKanji2Koe.dll の辞書読み出しを MMIO フックで完全に観測する。
//
// 仕組み: v86 の wasm CPU は「RAM 外 (>= memory_size)」の物理アドレス読み書きだけを
// JS の memory_map_read8/read32 ハンドラへ委譲する (RAM 内の mmap_register は無視される —
// 実験で確認済み)。そこで辞書イメージを 1GB 以�上の 0x40000000 に置き、
// mmap_register でフックする。これで DLL が辞書のどのバイトを読んだかが全て見える。
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import { V86Emu, REG_EAX, REG_ESP } from "../../../../../dist/v86_emu.js";
import { Heap, reg_read_uint32, reg_write_uint32 } from "../../../../../dist/emu_util.js";
import { push, call } from "../../../../../dist/x86_util.js";
import { to_bytes_uint32, from_bytes_uint32, uint8array_concat } from "../../../../../dist/util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dll = new Uint8Array(fs.readFileSync(path.join(__dirname, "../../work/probes/aqk2k_win/lib/AqKanji2Koe.dll")));
const dict = new Uint8Array(fs.readFileSync(path.join(__dirname, "../../work/aqdic.bin")));
const BASE = 0x10000000;
const DICT_ADDR = 0x40000000;                 // RAM 外 → MMIO パスに乗る
const DICT_LEN = dict.length;

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

// ---------------- 辞書 MMIO + トレース ----------------
const shadow = new Uint8Array(dict);            // 正体 (これだけが真)
const rcount = new Uint32Array(DICT_LEN + 1);   // read8 回数
const wcount = new Uint32Array(DICT_LEN + 1);
const eipOf = new Int32Array(DICT_LEN + 1);     // 最初に読んだ EIP (0 = 未記録)
let tracing = false;
const cpu = emu.cpu;
let ipView = new Int32Array(cpu.wasm_memory.buffer, 556, 1);
const curEip = () => { if (ipView.buffer !== cpu.wasm_memory.buffer) ipView = new Int32Array(cpu.wasm_memory.buffer, 556, 1); return ipView[0] >>> 0; };
const r8 = (a) => {
  const o = a - DICT_ADDR;
  if (tracing && o >= 0 && o < DICT_LEN) { rcount[o]++; if (!eipOf[o]) eipOf[o] = curEip(); }
  return o >= 0 && o < DICT_LEN ? shadow[o] : 0;
};
const r32 = (a) => { const o = a - DICT_ADDR;
  if (tracing && o >= 0 && o + 3 < DICT_LEN) { const e = curEip(); for (let i = 0; i < 4; i++) { rcount[o + i]++; if (!eipOf[o + i]) eipOf[o + i] = e; } }
  return (r8raw(o)) | (r8raw(o + 1) << 8) | (r8raw(o + 2) << 16) | (r8raw(o + 3) << 24) >>> 0;
};
function r8raw(o) { return o >= 0 && o < DICT_LEN ? shadow[o] : 0; }
const w8 = (a, v) => { const o = a - DICT_ADDR; if (o >= 0 && o < DICT_LEN) { wcount[o]++; shadow[o] = v & 0xff; } };
const w32 = (a, v) => { w8(a, v & 255); w8(a + 1, v >>> 8 & 255); w8(a + 2, v >>> 16 & 255); w8(a + 3, v >>> 24 & 255); };
const nblk = Math.ceil((DICT_LEN + 0x1000) / 0x20000);
(cpu.io || cpu).mmap_register(DICT_ADDR, nblk * 0x20000, r8, w8, r32, w32);
cpu.jit_clear_cache?.();

// ---------------- Win32 スタブ ----------------
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
    HeapFree: makeStub(() => 1, 3), HeapReAlloc: makeStub((e, esp) => heap.set_mem_value(e, new Uint8Array(u32at(e, esp, 16))), 4), HeapSize: makeStub(() => 0, 2), GetLastError: makeStub(() => 0, 0), SetLastError: makeStub(() => 0, 1), EnterCriticalSection: makeStub(() => 0, 1), LeaveCriticalSection: makeStub(() => 0, 1), DeleteCriticalSection: makeStub(() => 0, 1), InitializeCriticalSectionAndSpinCount: makeStub(() => 1, 2), GetCurrentProcess: makeStub(() => 1, 0), GetCurrentProcessId: makeStub(() => 1, 0), GetCurrentThreadId: makeStub(() => 1, 0), IsProcessorFeaturePresent: makeStub(() => 1, 1), QueryPerformanceCounter: makeStub(() => 0, 1), GetSystemTimeAsFileTime: makeStub(() => 0, 1), GetStartupInfoW: makeStub(() => 0, 1), GetModuleHandleW: makeStub(() => 0, 1), IsDebuggerPresent: makeStub(() => 0, 0), RtlUnwind: makeStub(() => 0, 4), TlsAlloc: makeStub(() => 0x100, 0), TlsGetValue: makeStub(() => 0, 1), TlsSetValue: makeStub(() => 1, 2), TlsFree: makeStub(() => 1, 1), FreeLibrary: makeStub(() => 1, 1), GetProcAddress: makeStub(() => 0, 2), LoadLibraryExW: makeStub(() => 0, 3), RaiseException: makeStub(() => 0, 3), ExitProcess: makeStub(() => 0, 1), GetModuleHandleExW: makeStub(() => 0, 3), GetModuleFileNameA: makeStub(() => 0, 3), GetModuleFileNameW: makeStub(() => 0, 3), GetACP: makeStub(() => 932, 0), GetOEMCP: makeStub(() => 932, 0), GetCPInfo: makeStub(() => 0, 2), GetCommandLineA: makeStub(() => 0, 0), GetCommandLineW: makeStub(() => 0, 0), MultiByteToWideChar: makeStub(() => 0, 6), WideCharToMultiByte: makeStub(() => 0, 8), GetEnvironmentStringsW: makeStub(() => 0, 0), FreeEnvironmentStringsW: makeStub(() => 0, 1), LCMapStringW: makeStub(() => 0, 6), GetStdHandle: makeStub(() => 0, 1), GetFileType: makeStub(() => 0, 1), GetStringTypeW: makeStub(() => 0, 4), SetStdHandle: makeStub(() => 1, 2), FlushFileBuffers: makeStub(() => 1, 1), WriteFile: makeStub(() => 1, 5), GetConsoleCP: makeStub(() => 0, 0), GetConsoleMode: makeStub(() => 0, 2), SetFilePointerEx: makeStub(() => 0, 4), GetFileSize: makeStub(() => 0, 2), CreateFileA: makeStub(() => -1, 7), CreateFileW: makeStub(() => -1, 7), CloseHandle: makeStub(() => 1, 0), ReadFile: makeStub(() => 0, 5), SetEndOfFile: makeStub(() => 0, 1), GetSystemInfo: makeStub(() => 0, 1), VirtualAlloc: makeStub((e, esp) => heap.set_mem_value(e, new Uint8Array(u32at(e, esp, 8))), 4), VirtualFree: makeStub(() => 1, 3), VirtualProtect: makeStub(() => 1, 4), VirtualQuery: makeStub(() => 0, 4), GetTickCount: makeStub(() => 1, 0), GetVersion: makeStub(() => 0, 0), GetVersionExA: makeStub(() => 0, 1), GetVersionExW: makeStub(() => 0, 1), GetModuleHandleA: makeStub(() => 0, 1), UnhandledExceptionFilter: makeStub(() => 0, 1), SetUnhandledExceptionFilter: makeStub(() => 0, 1), TerminateProcess: makeStub(() => 0, 2), GetCurrentThread: makeStub(() => 1, 0), GetSystemTime: makeStub(() => 0, 1), OutputDebugStringA: makeStub(() => 0, 1), OutputDebugStringW: makeStub(() => 0, 1), Sleep: makeStub(() => 0, 1) };
  for (const [n, a] of Object.entries(hooks)) { if (iatThunks[n] !== undefined) emu.mem_write(BASE + iatThunks[n], to_bytes_uint32(a)); } }

const EXP = getExports(dll);
const errAddr = heap.set_mem_value(emu, new Uint8Array(4));
reg_write_uint32(emu, REG_ESP, 0x30000000);
push(emu, errAddr); push(emu, 0); push(emu, DICT_ADDR);
const rf = heap.set_mem_value(emu, new Uint8Array(1048576).fill(0x90));
emu.set_eip(rf); call(emu, EXP.AqKanji2Koe_Create_Ptr);
tracing = true;
const t0 = Date.now();
try { emu.emu_start(emu.get_eip(), rf); } catch (e) { console.log("Create_Ptr err:", String(e).slice(0, 80)); process.exit(1); }
tracing = false;
const h = reg_read_uint32(emu, REG_EAX) >>> 0;
const createStats = { ms: Date.now() - t0, reads: rcount.reduce((a, b, i) => i < DICT_LEN ? a + b : a, 0), distinct: rcount.subarray(0, DICT_LEN).reduce((a, b) => a + (b ? 1 : 0), 0) };
if (!h) { console.log("Create_Ptr 失敗"); process.exit(1); }

const IN_CAP = 65536, OUT_CAP = 65536;
const ka = heap.set_mem_value(emu, new Uint8Array(IN_CAP));
const ba = heap.set_mem_value(emu, new Uint8Array(OUT_CAP));
const rf2 = heap.set_mem_value(emu, new Uint8Array(1048576).fill(0x90));
const TD = new TextDecoder(), TE = new TextEncoder();

function convert(text, trace = false) {
  const kb = uint8array_concat(TE.encode(text), new Uint8Array([0]));
  emu.mem_write(ka, kb); emu.mem_write(ba, new Uint8Array(OUT_CAP));
  if (trace) { rcount.fill(0); wcount.fill(0); eipOf.fill(0); tracing = true; }
  reg_write_uint32(emu, REG_ESP, 0x30000000);
  push(emu, OUT_CAP); push(emu, ba); push(emu, ka); push(emu, h);
  emu.set_eip(rf2); call(emu, EXP.AqKanji2Koe_Convert_utf8);
  let err = null;
  try { emu.emu_start(emu.get_eip(), rf2); } catch (e) { err = String(e).slice(0, 40); }
  tracing = false;
  const ret = reg_read_uint32(emu, REG_EAX) >>> 0;
  const out = TD.decode(emu.mem_read(ba, OUT_CAP)).split("\0")[0];
  return { ret, out, err };
}
export { convert, rcount, wcount, eipOf, shadow, dict, DICT_ADDR, DICT_LEN, createStats, emu, heap, EXP, BASE, h };

if (process.argv[1] && process.argv[1].endsWith("_trace2.mjs")) {
  console.log("[create]", JSON.stringify(createStats));
  const texts = process.argv.slice(2).filter((a) => !a.startsWith("--")) ;
  const sents = texts.length ? texts : ["話します"];
  const union = new Uint32Array(DICT_LEN);
  for (const t of sents) {
    const t0 = Date.now();
    const r = convert(t, true);
    const nRead = rcount.subarray(0, DICT_LEN).reduce((a, b) => a + b, 0);
    const nDist = rcount.subarray(0, DICT_LEN).reduce((a, b) => a + (b ? 1 : 0), 0);
    console.log(`\n=== ${t} => ${JSON.stringify(r.out)} (${Date.now() - t0}ms)  reads=${nRead} distinct=${nDist}`);
    for (let i = 0; i < DICT_LEN; i++) if (rcount[i]) union[i] = 1;
    // 連続区間にまとめて表示 (1024 バイト以内の隙間は連結)
    const idxs = []; for (let i = 0; i < DICT_LEN; i++) if (rcount[i]) idxs.push(i);
    let s = idxs[0], p = idxs[0]; const segs = [];
    for (const a of idxs.slice(1)) { if (a - p <= 64) { p = a; continue; } segs.push([s, p]); s = a; p = a; }
    if (idxs.length) segs.push([s, p]);
    for (const [a, b] of segs) {
      let n = 0; for (let i = a; i <= b; i++) if (rcount[i]) n++;
      console.log(`   0x${a.toString(16)}..0x${b.toString(16)} bytes=${b - a + 1} distinct=${n} eip=${(eipOf[a] >>> 0).toString(16)}`);
    }
  }
  const idxs = []; for (let i = 0; i < DICT_LEN; i++) if (union[i]) idxs.push(i);
  let s = idxs[0], p = idxs[0]; const segs = [];
  for (const a of idxs.slice(1)) { if (a - p <= 64) { p = a; continue; } segs.push([s, p]); s = a; p = a; }
  if (idxs.length) segs.push([s, p]);
  console.log(`\n[union over ${sents.length} sentences] distinct=${idxs.length}`);
  for (const [a, b] of segs) console.log(`   0x${a.toString(16)}..0x${b.toString(16)} bytes=${b - a + 1}`);
}

// ---------------------------------------------------------------------------
// アクセント結合ディスパッチャ (RVA 0x3bf0) が受け取る語ノード列を記録する。
// set_hook は Win32 スタブでポートを使い切っているため、空きポートに自前で
// OUT トランポリンを書いてフックする。
//   node+0x04 = 拍数 / node+0x24 = 結合バイト数 / node+0x28+4i = cls / node+0x34+4i = val
//   node+0x40 = 核 (u16) / node+0x42 = アクセント句境界型 (u16) / node+0x44 = 句境界マーカー
// ---------------------------------------------------------------------------
const rd32x = (a) => emu.mem_read(a, 4).reduce((acc, v, i) => acc + v * 2 ** (8 * i), 0) >>> 0;
const rd16x = (a) => emu.mem_read(a, 2).reduce((acc, v, i) => acc + v * 2 ** (8 * i), 0);
const DISPATCH = BASE + 0x3bf0;
export function traceNodes(text) {
  let nodes = null;
  const PORT = 0xC7;
  const orig = new Uint8Array(emu.mem_read(DISPATCH, 2));
  emu.mem_write(DISPATCH, new Uint8Array([0xE6, PORT]));
  emu.cpu.io.register_write(PORT, emu, () => {
    if (!nodes) {
      const esp = emu.reg_read(4) >>> 0;
      const vec = rd32x(esp + 4);
      const begin = rd32x(vec), end = rd32x(vec + 4);
      const n = ((end - begin) / 4) | 0;
      nodes = [];
      for (let i = 0; i < n; i++) {
        const nd = rd32x(begin + i * 4);
        const jcnt = rd32x(nd + 0x24);
        const junc = [], jcls = [];
        for (let k = 0; k < Math.min(jcnt, 4); k++) { junc.push(rd32x(nd + 0x34 + k * 4)); jcls.push(rd32x(nd + 0x28 + k * 4)); }
        nodes.push({ mora: rd32x(nd + 4), accent: rd16x(nd + 0x40), t42: rd16x(nd + 0x42), brk: rd16x(nd + 0x44), jcnt, junc, jcls });
      }
    }
    emu.mem_write(DISPATCH, orig);
    emu.set_eip(DISPATCH);
  });
  const r = convert(text);
  emu.mem_write(DISPATCH, orig);
  return { out: r.out, nodes };
}

if (process.argv[1] && process.argv[1].endsWith("accent_trace.mjs")) {
  const args = process.argv.slice(2);
  const showNodes = args.includes("--nodes");
  const texts = args.filter((a) => !a.startsWith("--"));
  const sents = texts.length ? texts : ["十年前"];
  if (showNodes) {
    const K2K = path.resolve(__dirname, "../..");
    const { createDict } = await import(path.join(K2K, "core/engine.js"));
    const dict = createDict(new Uint8Array(fs.readFileSync(path.join(K2K, "work/aqdic.bin"))));
    for (const s of sents) {
      const segs = dict.toKanaDetailed(s).filter((x) => x.reading);
      const { out, nodes } = traceNodes(s);
      console.log(`\n=== ${s} => ${JSON.stringify(out)}`);
      if (!nodes) { console.log("  (no dispatcher call)"); continue; }
      if (nodes.length === segs.length) {
        for (let i = 0; i < nodes.length; i++) {
          const c = segs[i].pos == null ? -1 : (segs[i].pos & 0x7fff);
          console.log(`  ${segs[i].surface}(${segs[i].reading}) mora=${nodes[i].mora} accent=${nodes[i].accent} cls=${c} jcnt=${nodes[i].jcnt} jcls=[${nodes[i].jcls}] junc=[${nodes[i].junc}] t42=${nodes[i].t42} brk=${nodes[i].brk}`);
        }
      } else console.log(`  (segments=${segs.length} != nodes=${nodes.length})`);
    }
  } else {
    // 辞書読み出しのレンジ表示 (元の _trace2 CLI)
    for (const t of sents) {
      convert(t, true);
      const idxs = []; for (let i = 0; i < DICT_LEN; i++) if (rcount[i]) idxs.push(i);
      let s0 = idxs[0], p = idxs[0]; const segs = [];
      for (const a of idxs.slice(1)) { if (a - p <= 64) { p = a; continue; } segs.push([s0, p]); s0 = a; p = a; }
      if (idxs.length) segs.push([s0, p]);
      console.log(`\n=== ${t} => ${JSON.stringify(convert(t).out)}  distinct=${idxs.length}`);
      for (const [a, b] of segs) {
        let n = 0; for (let i = a; i <= b; i++) if (rcount[i]) n++;
        console.log(`   0x${a.toString(16)}..0x${b.toString(16)} bytes=${b - a + 1} distinct=${n}`);
      }
    }
  }
}
