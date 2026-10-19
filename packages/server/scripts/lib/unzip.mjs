// 极简 ZIP 读取（仅解压，基于中央目录 + zlib.inflateRawSync），跨平台无依赖。
// 面向 build 期使用（如 FAA CIFP 的 zip）。
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

/** 解压 zip，返回 Map<文件名, Buffer>。 */
export function unzip(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: 未找到 EOCD');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = new Map();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== CD_SIG) throw new Error('zip: 中央目录格式异常');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('latin1', off + 46, off + 46 + nameLen);

    const lnameLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lnameLen + lextraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    files.set(name, method === 0 ? Buffer.from(comp) : inflateRawSync(comp));

    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
