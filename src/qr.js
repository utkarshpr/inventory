/* A small QR code encoder (byte mode, error correction level M, versions 1-10: up to 213 characters).
   Written for this app so it needs no extra package. Used to show a scannable UPI payment code. */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256)
;(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] })()
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0)
const rsGen = (n) => { let g = [1]; for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]) } g = next } return g }
const rsEncode = (data, n) => { const g = rsGen(n), res = new Array(n).fill(0); for (const d of data) { const f = d ^ res[0]; res.shift(); res.push(0); if (f) for (let i = 0; i < n; i++) res[i] ^= gmul(g[i + 1], f) } return res }

// level M: [error-correction codewords per block, [[blocks, data codewords per block], ...]]
const M_TABLE = { 1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]], 6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]] }
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }
const dataCapacity = (v) => M_TABLE[v][1].reduce((n, [c, d]) => n + c * d, 0)

export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)))
  let version = 0
  for (let v = 1; v <= 10 && !version; v++) { const countBits = v < 10 ? 8 : 16; if (4 + countBits + bytes.length * 8 <= dataCapacity(v) * 8) version = v }
  if (!version) throw new Error('QR text is too long')
  const [ecLen, groups] = M_TABLE[version], capacity = dataCapacity(version)

  // 1. bit stream
  const bits = []
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(0b0100, 4); put(bytes.length, version < 10 ? 8 : 16); bytes.forEach(b => put(b, 8))
  put(0, Math.min(4, capacity * 8 - bits.length)); while (bits.length % 8) bits.push(0)
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad)

  // 2. split into blocks, add error correction, interleave
  const blocks = []; let at = 0
  for (const [count, size] of groups) for (let k = 0; k < count; k++) { const d = data.slice(at, at + size); at += size; blocks.push({ d, e: rsEncode(d, ecLen) }) }
  const out = [], maxD = Math.max(...blocks.map(b => b.d.length))
  for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]) })
  for (let i = 0; i < ecLen; i++) blocks.forEach(b => out.push(b.e[i]))

  // 3. function patterns
  const size = 17 + 4 * version
  const mod = Array.from({ length: size }, () => new Array(size).fill(false)), fn = Array.from({ length: size }, () => new Array(size).fill(false))
  const setFn = (x, y, dark) => { if (x < 0 || y < 0 || x >= size || y >= size) return; mod[y][x] = dark; fn[y][x] = true }
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); setFn(cx + dx, cy + dy, d !== 2 && d !== 4) }
  const pos = ALIGN[version], last = pos.length - 1
  pos.forEach((cy, i) => pos.forEach((cx, j) => { if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1) }))
  const formatBits = (mask) => { const d = (0 << 3) | mask; let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537); return ((d << 10) | rem) ^ 0x5412 }
  const drawFormat = (mask) => {
    const b = formatBits(mask), bit = (i) => ((b >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i)); setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8)); for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i)); for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i)); setFn(8, size - 8, true)
  }
  drawFormat(0)
  if (version >= 7) { let rem = version; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25); const vb = (version << 12) | rem; for (let i = 0; i < 18; i++) { const bit = ((vb >>> i) & 1) !== 0, a = size - 11 + (i % 3), b = Math.floor(i / 3); setFn(a, b, bit); setFn(b, a, bit) } }

  // 4. place data (zigzag, right to left, skipping function modules)
  const stream = []; out.forEach(c => { for (let i = 7; i >= 0; i--) stream.push((c >>> i) & 1) })
  let k = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert
      if (!fn[y][x] && k < stream.length) mod[y][x] = stream[k++] === 1
    }
  }

  // 5. choose the mask with the lowest penalty
  const masks = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0]
  const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[m](x, y)) mod[y][x] = !mod[y][x] }
  const penalty = () => {
    let p = 0
    const line = (get) => { for (let a = 0; a < size; a++) { let run = 1; for (let b = 1; b <= size; b++) { if (b < size && get(a, b) === get(a, b - 1)) run++; else { if (run >= 5) p += 3 + (run - 5); run = 1 } } } }
    line((a, b) => mod[a][b]); line((a, b) => mod[b][a])
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3
    const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
    const scan = (get) => { for (let a = 0; a < size; a++) for (let b = 0; b + 11 <= size; b++) { let ma = true, mb = true; for (let t = 0; t < 11; t++) { const v = get(a, b + t) ? 1 : 0; if (v !== A[t]) ma = false; if (v !== B[t]) mb = false; if (!ma && !mb) break } if (ma) p += 40; if (mb) p += 40 } }
    scan((a, b) => mod[a][b]); scan((a, b) => mod[b][a])
    let dark = 0; mod.forEach(r => r.forEach(v => { if (v) dark++ }))
    p += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10
    return p
  }
  let best = 0, bestP = Infinity
  for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const p = penalty(); if (p < bestP) { bestP = p; best = m } applyMask(m) }
  applyMask(best); drawFormat(best)
  return mod
}
