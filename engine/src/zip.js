/**
 * zip.js — minimal in-browser ZIP writer (store / no compression)
 * ===============================================================
 * Enough to package the inline + split builds into one .zip with a folder
 * structure, mirroring the Wags Water ad-builds layout. Text files only
 * (our builds are HTML/JS — image bytes live as base64 inside the JS).
 *
 * Exposed as window.PE.zip.
 */
(function () {
  const PE = (window.PE = window.PE || {});
  const ENC = new TextEncoder();

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
  const u32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  function concat(arrs) {
    let len = 0; for (const a of arrs) len += a.length;
    const out = new Uint8Array(len); let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }

  // files: [{ name, text }] where text is a string OR a Uint8Array (e.g. a nested
  // zip's bytes). Returns the zip as a Uint8Array.
  function createZipBytes(files) {
    const TIME = 0, DATE = 0x21; // fixed 1980-01-01 (Date.* unavailable / determinism)
    const local = [], central = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = ENC.encode(f.name);
      const data = typeof f.text === 'string' ? ENC.encode(f.text) : f.text;
      const crc = crc32(data);
      const lh = concat([
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(TIME), u16(DATE),
        u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0),
        nameBytes, data,
      ]);
      local.push(lh);
      central.push(concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(TIME), u16(DATE),
        u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
      ]));
      offset += lh.length;
    }
    const localBytes = concat(local);
    const centralBytes = concat(central);
    const eocd = concat([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralBytes.length), u32(localBytes.length), u16(0),
    ]);
    return concat([localBytes, centralBytes, eocd]);
  }

  // Same, returned as a downloadable Blob.
  function createZip(files) {
    return new Blob([createZipBytes(files)], { type: 'application/zip' });
  }

  PE.zip = { createZip, createZipBytes };
})();
