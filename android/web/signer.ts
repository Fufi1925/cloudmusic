// Browser port of electron/crypto.ts: the very same embedded rust/wasm request
// signer, only with web primitives instead of node's Buffer / crypto.
//
// Differences to the electron main process version:
//  - chromium refuses synchronous `new WebAssembly.Module()` for modules > 4 KB
//    on the main thread, so the module is instantiated asynchronously once.
//  - randomBytes -> crypto.getRandomValues, Buffer -> TextEncoder/TextDecoder.
//  - the dev-only CLOUDMUSIC_DEV_SIGNING_SECRET path does not exist on android
//    (it is unpackaged-electron only in the original too).
import { SIGNER_WASM_BASE64 } from "../../electron/signer";

export interface SignRequestInput {
  method: string;
  path: string;
  body?: string | null;
  timestamp?: number;
}

export interface SignedRequestHeaders {
  signature: string;
  timestamp: number;
  nonce: string;
}

interface WasmSignerExports {
  cloudmusic_alloc: (len: number) => number;
  cloudmusic_dealloc: (ptr: number, len: number) => void;
  cloudmusic_get_result_ptr: () => number;
  cloudmusic_get_result_len: () => number;
  cloudmusic_sign_cover_url: (ptr: number, len: number) => number;
  cloudmusic_sign_request: (
    methodPtr: number,
    methodLen: number,
    pathPtr: number,
    pathLen: number,
    bodyPtr: number,
    bodyLen: number,
    timestamp: bigint,
    noncePtr: number,
    nonceLen: number,
  ) => number;
  cloudmusic_sign_monitor_request: (
    methodPtr: number,
    methodLen: number,
    pathPtr: number,
    pathLen: number,
    bodyPtr: number,
    bodyLen: number,
    timestamp: bigint,
    noncePtr: number,
    nonceLen: number,
  ) => number;
  cloudmusic_sign_raw_payload: (ptr: number, len: number) => number;
  memory: WebAssembly.Memory;
}

// maintains clock delta between client and server (ms), mirrors the main process copy
let serverTimeOffsetMs = 0;

export function syncServerTime(dateHeaderOrMs: string | number | Date): number {
  const serverMs =
    typeof dateHeaderOrMs === "number"
      ? dateHeaderOrMs
      : typeof dateHeaderOrMs === "string"
        ? Date.parse(dateHeaderOrMs)
        : dateHeaderOrMs.getTime();

  if (!Number.isNaN(serverMs) && serverMs > 0) {
    serverTimeOffsetMs = serverMs - Date.now();
  }
  return serverTimeOffsetMs;
}

export function getServerTimeOffset(): number {
  return serverTimeOffsetMs;
}

export function getAdjustedTimestamp(): number {
  return Math.floor((Date.now() + serverTimeOffsetMs) / 1000);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let wasmPromise: Promise<WasmSignerExports> | null = null;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function getWasmExports(): Promise<WasmSignerExports> {
  if (!wasmPromise) {
    wasmPromise = WebAssembly.instantiate(base64ToBytes(SIGNER_WASM_BASE64), {}).then(
      (result) => result.instance.exports as unknown as WasmSignerExports,
    );
    wasmPromise.catch(() => {
      wasmPromise = null;
    });
  }
  return wasmPromise;
}

function passBytesToWasm(exports: WasmSignerExports, bytes: Uint8Array) {
  const ptr = exports.cloudmusic_alloc(bytes.length);
  // view is created after alloc: alloc may grow (and detach) the memory buffer
  new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
  return {
    ptr,
    len: bytes.length,
    free: () => exports.cloudmusic_dealloc(ptr, bytes.length),
  };
}

function passStringToWasm(exports: WasmSignerExports, str: string) {
  return passBytesToWasm(exports, encoder.encode(str));
}

function readResultFromWasm(exports: WasmSignerExports): string {
  const ptr = exports.cloudmusic_get_result_ptr();
  const len = exports.cloudmusic_get_result_len();
  if (!ptr || len === 0) return "";
  return decoder.decode(new Uint8Array(exports.memory.buffer, ptr, len).slice());
}

function randomNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signCoverUrl(payload: string): Promise<string> {
  const wasm = await getWasmExports();
  const payloadBuf = passStringToWasm(wasm, payload);
  try {
    const code = wasm.cloudmusic_sign_cover_url(payloadBuf.ptr, payloadBuf.len);
    if (code !== 0) throw new Error(`wasm sign_cover_url failed with code ${code}`);
    return readResultFromWasm(wasm);
  } finally {
    payloadBuf.free();
  }
}

type RequestSigner = "cloudmusic_sign_request" | "cloudmusic_sign_monitor_request";

async function signCanonical(fn: RequestSigner, input: SignRequestInput): Promise<SignedRequestHeaders> {
  const wasm = await getWasmExports();
  const timestamp = input.timestamp ?? getAdjustedTimestamp();
  const nonce = randomNonce();

  const methodBuf = passStringToWasm(wasm, input.method);
  const pathBuf = passStringToWasm(wasm, input.path);
  const bodyBuf = passStringToWasm(wasm, input.body ?? "");
  const nonceBuf = passStringToWasm(wasm, nonce);

  try {
    const code = wasm[fn](
      methodBuf.ptr,
      methodBuf.len,
      pathBuf.ptr,
      pathBuf.len,
      bodyBuf.ptr,
      bodyBuf.len,
      BigInt(timestamp),
      nonceBuf.ptr,
      nonceBuf.len,
    );
    if (code !== 0) {
      const name = fn === "cloudmusic_sign_request" ? "sign_request" : "sign_monitor_request";
      throw new Error(`wasm ${name} failed with code ${code}`);
    }
    return { signature: readResultFromWasm(wasm), timestamp, nonce };
  } finally {
    methodBuf.free();
    pathBuf.free();
    bodyBuf.free();
    nonceBuf.free();
  }
}

// signs api request with canonical string and hmac-sha256 using server-adjusted timestamp
export function signRequest(input: SignRequestInput): Promise<SignedRequestHeaders> {
  return signCanonical("cloudmusic_sign_request", input);
}

// signs monitor telemetry request using server-adjusted timestamp
export function signMonitorRequest(input: SignRequestInput): Promise<SignedRequestHeaders> {
  return signCanonical("cloudmusic_sign_monitor_request", input);
}

// signs raw byte buffer
export async function signRawPayload(payload: number[] | Uint8Array): Promise<string> {
  const wasm = await getWasmExports();
  const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  const buf = passBytesToWasm(wasm, bytes);
  try {
    const code = wasm.cloudmusic_sign_raw_payload(buf.ptr, buf.len);
    if (code !== 0) throw new Error(`wasm sign_raw_payload failed with code ${code}`);
    return readResultFromWasm(wasm);
  } finally {
    buf.free();
  }
}
