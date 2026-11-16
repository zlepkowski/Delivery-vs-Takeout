'use strict';
// D-039 amendment (2026-11-16, Phase 10 dry run): tools/build-stores.py ranged reads.
//  - a 200 to a Range request is retried, the body is never read (closed early);
//  - RANGE_TRIES = 6 attempts, SLEEP(RANGE_BACKOFF = (1, 2, 4, 8, 16)) before attempts 2..6;
//  - any other status (416, 404) and a 206 with the wrong Content-Length fail at once.
// The test serves a zip it builds itself from a local http server (127.0.0.1 only; no live
// network) and scripts each Range answer. Python does the reading: a harness loads the tool by
// absolute path, replaces SLEEP with a recorder and reads both members through zipfile.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const TOOL = path.join(__dirname, '..', '..', 'tools', 'build-stores.py');
const STREAM_BYTES = 64 * 1024 * 1024; // the body of a 200 answer: never read by the client

// Members, written out here by hand so the expected bytes don't come from the code under test.
const MEMBERS = [
  { name: 'a.txt', data: Buffer.from('alpha: the first member, stored, not compressed\n', 'utf8') },
  { name: 'b.bin', data: Buffer.from(Array.from({ length: 1500 }, (_, i) => (i * 7 + 3) & 255)) },
];

const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// A stored (method 0) zip with no comment.
function buildZip(members) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  let cenSize = 0;
  for (const m of members) {
    const name = Buffer.from(m.name, 'utf8');
    const len = m.data.length;
    const crc = crc32(m.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12); // date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(len, 18);
    local.writeUInt32LE(len, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, m.data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(33, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(len, 20);
    cen.writeUInt32LE(len, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    cenSize += 46 + name.length;
    offset += 30 + name.length + len;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(cenSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

const ZIP = buildZip(MEMBERS);

// Scripted server. plan(n) gives the answer to the n-th Range request (1-based, across the run).
// HEAD is always answered 200 with the zip's Content-Length.
function startServer(plan) {
  const st = { ranges: 0, heads: 0, streams: [] };
  const server = http.createServer((req, res) => {
    res.on('error', () => {}); // a client that closes early makes later writes fail
    if (req.method === 'HEAD') {
      st.heads++;
      res.writeHead(200, { 'Content-Length': ZIP.length });
      res.end();
      return;
    }
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (!m) {
      res.writeHead(400, { 'Content-Length': 0 });
      res.end();
      return;
    }
    st.ranges++;
    const start = Number(m[1]);
    const end = Number(m[2]);
    const want = end - start + 1;
    const behavior = plan(st.ranges);
    if (behavior === 'stream200') {
      // A 200 with the whole file: 64 MB of zeros, written with backpressure. The client
      // should close the connection before the last byte goes out.
      const rec = { finished: false, closed: false };
      st.streams.push(rec);
      res.on('finish', () => { rec.finished = true; });
      res.on('close', () => { rec.closed = true; });
      res.writeHead(200, { 'Content-Length': STREAM_BYTES, 'Content-Type': 'application/octet-stream' });
      const chunk = Buffer.alloc(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < STREAM_BYTES) {
          sent += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', pump);
            return;
          }
        }
        res.end();
      };
      pump();
    } else if (behavior === 'part') {
      res.writeHead(206, {
        'Content-Range': 'bytes ' + start + '-' + end + '/' + ZIP.length,
        'Content-Length': want,
      });
      res.end(ZIP.subarray(start, end + 1));
    } else if (behavior === 'badlen') {
      // 206 whose Content-Length is not the requested count (the body is consistent with it).
      res.writeHead(206, {
        'Content-Range': 'bytes ' + start + '-' + end + '/' + ZIP.length,
        'Content-Length': want + 5,
      });
      res.end(Buffer.alloc(want + 5));
    } else if (behavior === 'destroy') {
      // The connection drops before any response: a network error, not a status.
      req.socket.destroy();
    } else if (typeof behavior === 'number') {
      res.writeHead(behavior, { 'Content-Length': 0 });
      res.end();
    } else {
      throw new Error('bad plan entry: ' + behavior);
    }
  });
  server.on('connection', (sock) => sock.on('error', () => {}));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: 'http://127.0.0.1:' + server.address().port + '/fixture.zip',
        st,
        stop: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

// Condition wait with a deadline (not a fixed sleep). Resolves to whether the condition held.
async function until(pred, ms) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
  return true;
}

const HARNESS = [
  'import base64, importlib.util, json, sys, zipfile',
  'spec = importlib.util.spec_from_file_location("bs", sys.argv[1])',
  'mod = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(mod)',
  'sleeps = []',
  'mod.SLEEP = lambda s: sleeps.append(s)',
  'out = {"ok": False, "error": None, "sleeps": sleeps, "retries": None, "members": {}}',
  'reader = None',
  'try:',
  '    reader = mod.HttpRangeFile(sys.argv[2])',
  '    zf = zipfile.ZipFile(reader)',
  '    for name in ["a.txt", "b.bin"]:',
  '        out["members"][name] = base64.b64encode(zf.read(name)).decode("ascii")',
  '    out["ok"] = True',
  'except Exception as e:',
  '    out["error"] = type(e).__name__ + ": " + str(e)',
  'out["retries"] = getattr(reader, "retries", None)',
  'print(json.dumps(out))',
].join('\n');

function runHarness(url) {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, {
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    });
    execFile('python3', ['-I', '-c', HARNESS, TOOL, url],
      { env, timeout: 20000, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => {
        const line = String(stdout || '').trim().split('\n').pop() || '';
        let parsed = null;
        try { parsed = JSON.parse(line); } catch (e) { /* reported below */ }
        if (!parsed) {
          reject(new Error('harness printed no JSON (' + (err ? err.message : 'exit 0') + '): ' + stderr));
          return;
        }
        resolve(parsed);
      });
  });
}

// Runs one scripted scenario: the harness reads the zip through HttpRangeFile.
async function scenario(plan) {
  const srv = await startServer(plan);
  try {
    const out = await runHarness(srv.url);
    const settled = await until(() => srv.st.streams.every((s) => s.closed), 5000);
    return { out, st: srv.st, settled };
  } finally {
    await srv.stop();
  }
}

function assertMembers(out) {
  for (const m of MEMBERS) {
    assert.ok(out.members[m.name] !== undefined, 'member ' + m.name + ' was not read');
    assert.deepEqual(Buffer.from(out.members[m.name], 'base64'), m.data, 'member ' + m.name + ' bytes differ');
  }
}

test('D-039 a 200 to a Range request is retried: two 200s then 206 reads both members, sleeps 1 and 2', async () => {
  const { out, st } = await scenario((n) => (n <= 2 ? 'stream200' : 'part'));
  assert.equal(out.error, null);
  assert.equal(out.ok, true);
  assertMembers(out);
  assert.deepEqual(out.sleeps, [1, 2]);
  assert.equal(out.retries, 2);
  assert.equal(st.streams.length, 2, 'the server should have answered 200 twice');
});

test('D-039 a 200 body is never read: the client closes each 200 before its 64 MB is sent', async () => {
  const { out, st, settled } = await scenario((n) => (n <= 2 ? 'stream200' : 'part'));
  assert.equal(out.ok, true, 'the read should still succeed after the 200s');
  assert.equal(st.streams.length, 2);
  assert.ok(settled, 'every 200 response should have ended (client closed) within 5 s');
  for (const [i, rec] of st.streams.entries()) {
    assert.equal(rec.finished, false, '200 answer ' + (i + 1) + ': all 64 MB were sent, so the client read the body');
    assert.equal(rec.closed, true, '200 answer ' + (i + 1) + ': the client never closed it');
  }
});

test('D-039 200 to every Range request: 6 attempts, sleeps 1 2 4 8 16, then the read fails', async () => {
  const { out, st, settled } = await scenario(() => 'stream200');
  assert.equal(out.ok, false);
  assert.ok(out.error && out.error.includes('after 6 attempts'),
    'error should contain "after 6 attempts", got: ' + out.error);
  assert.deepEqual(out.sleeps, [1, 2, 4, 8, 16]);
  assert.equal(out.retries, 5, 'five retried attempts for six tries');
  assert.equal(st.ranges, 6, 'exactly RANGE_TRIES Range requests');
  assert.ok(settled, 'every 200 response should have been closed by the client');
  assert.ok(st.streams.every((s) => s.finished === false), 'no 200 body should have been read to the end');
});

test('D-039 416 to a Range request fails at once: no retry, no sleep', async () => {
  const { out, st } = await scenario(() => 416);
  assert.equal(out.ok, false);
  assert.ok(out.error && out.error.includes('416'), 'error should name the 416, got: ' + out.error);
  assert.deepEqual(out.sleeps, []);
  assert.equal(st.ranges, 1, 'exactly one Range request for the failing read');
});

test('D-039 404 to a Range request fails at once: no retry, no sleep', async () => {
  const { out, st } = await scenario(() => 404);
  assert.equal(out.ok, false);
  assert.ok(out.error && out.error.includes('404'), 'error should name the 404, got: ' + out.error);
  assert.deepEqual(out.sleeps, []);
  assert.equal(st.ranges, 1, 'exactly one Range request for the failing read');
});

test('D-039 503 to the first Range request is retried: then 206, sleeps [1], retries 1', async () => {
  const { out } = await scenario((n) => (n === 1 ? 503 : 'part'));
  assert.equal(out.error, null);
  assert.equal(out.ok, true);
  assertMembers(out);
  assert.deepEqual(out.sleeps, [1]);
  assert.equal(out.retries, 1);
});

test('D-039 a dropped connection on the first Range request is retried: then 206, sleeps [1], retries 1', async () => {
  const { out } = await scenario((n) => (n === 1 ? 'destroy' : 'part'));
  assert.equal(out.error, null);
  assert.equal(out.ok, true);
  assertMembers(out);
  assert.deepEqual(out.sleeps, [1]);
  assert.equal(out.retries, 1);
});

test('D-039 206 with a wrong Content-Length fails at once: no retry, no sleep', async () => {
  const { out, st } = await scenario(() => 'badlen');
  assert.equal(out.ok, false);
  assert.ok(out.error && out.error.includes('Content-Length'), 'error should name Content-Length, got: ' + out.error);
  assert.deepEqual(out.sleeps, []);
  assert.equal(st.ranges, 1, 'exactly one Range request for the failing read');
});

test('D-039 all 206: both members read with no sleep and no retry', async () => {
  const { out, st } = await scenario(() => 'part');
  assert.equal(out.error, null);
  assert.equal(out.ok, true);
  assertMembers(out);
  assert.deepEqual(out.sleeps, []);
  assert.equal(out.retries, 0);
  assert.equal(st.streams.length, 0);
});
