# Worker API checks against `wrangler dev` (see README.md > Testing).
import hashlib, json, os, sys, urllib.request, urllib.error

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8787'
# This suite publishes throwaway collages, so it only ever runs against a local worker.
assert BASE.startswith('http://localhost') or BASE.startswith('http://127.0.0.1'), 'local worker only'
KEY = sys.argv[2] if len(sys.argv) > 2 else 'dev-local-key'
fails = 0

UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36'

def req(method, path, body=None, key=KEY, ctype=None, headers=None):
    h = {'User-Agent': UA, **(headers or {})}
    if key: h['Authorization'] = 'Bearer ' + key
    if ctype: h['Content-Type'] = ctype
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    if isinstance(body, dict): h['Content-Type'] = 'application/json'
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

def check(name, cond, extra=''):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name + ((' :: ' + str(extra)) if not cond and extra != '' else ''))
    if not cond: fails += 1

def fake_jpeg(n, seed):
    return b'\xff\xd8\xff\xe0' + hashlib.sha256(seed).digest() * (n // 32)
def fake_png(n, seed):
    return b'\x89PNG\r\n\x1a\n' + hashlib.sha256(seed).digest() * (n // 32)
H = lambda b: hashlib.sha256(b).hexdigest()

s, h, b = req('GET', '/live', key=None)
check('live empty', s == 200 and json.loads(b) == {'none': True}, b)
check('live CORS *', h.get('Access-Control-Allow-Origin') == '*', h)
check('auth no key 401', req('GET', '/auth', key=None)[0] == 401)
check('auth wrong key 401', req('GET', '/auth', key='nope')[0] == 401)
check('auth ok', req('GET', '/auth')[0] == 200)
s, h, _ = req('GET', '/auth', headers={'Origin': 'https://vaibhavkumar.is-a.dev'})
check('admin CORS allowlisted origin', h.get('Access-Control-Allow-Origin') == 'https://vaibhavkumar.is-a.dev', h)
s, h, _ = req('GET', '/auth', headers={'Origin': 'https://evil.example'})
check('admin CORS foreign origin omitted', 'Access-Control-Allow-Origin' not in h, h)

big = fake_jpeg(2_600_000, b'a')       # 3 chunks
small = fake_png(40_000, b'b')
check('have: both missing', json.loads(req('POST', '/have', {'ids': [H(big), H(small)]})[2])['missing'] == [H(big), H(small)])
check('put src wrong hash 400', req('PUT', '/src/' + H(small), big, ctype='image/jpeg')[0] == 400)
check('put src wrong magic 415', req('PUT', '/src/' + H(big), big, ctype='image/png')[0] == 415)
check('put src bad type 415', req('PUT', '/src/' + H(small), small, ctype='text/html')[0] == 415)
_r = req('PUT', '/src/' + H(small), small, key=None, ctype='image/png'); check('put src no key 401', _r[0] == 401, _r)
check('put src big 201', req('PUT', '/src/' + H(big), big, ctype='image/jpeg')[0] == 201)
check('put src again 200', req('PUT', '/src/' + H(big), big, ctype='image/jpeg')[0] == 200)
check('put src small 201', req('PUT', '/src/' + H(small), small, ctype='image/png')[0] == 201)
s, h, b = req('GET', '/src/' + H(big))
check('get src roundtrip (3 chunks)', s == 200 and b == big and h.get('Content-Type') == 'image/jpeg', (s, len(b)))
check('get src without key 401', req('GET', '/src/' + H(big), key=None)[0] == 401)
check('have: none missing', json.loads(req('POST', '/have', {'ids': [H(big), H(small)]})[2])['missing'] == [])

def renders(tag):
    out = {}
    for name, n in (('full', 900_000), ('preview', 300_000), ('og', 100_000)):
        data = fake_jpeg(n, (tag + name).encode())
        out[name] = (data, {'id': H(data), 'w': 1600, 'h': 2000, 'bytes': len(data)})
    return out

lqip = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD='
doc1 = {'v': 1, 'images': {H(big): {'w': 10, 'h': 10}, H(small): {'w': 5, 'h': 5}}, 'mode': 'grid'}
r1 = renders('one')
body1 = {'title': 'First​ collage', 'W': 800, 'H': 1000, 'lqip': lqip, 'doc': doc1, **{k: v[1] for k, v in r1.items()}}
s, h, b = req('PUT', '/publish', body1)
check('publish before renders 409', s == 409 and sorted(json.loads(b)['missing']) == sorted(v[1]['id'] for v in r1.values()), b)
check('put render no key 401', req('PUT', '/r/' + r1['full'][1]['id'], r1['full'][0], key=None, ctype='image/jpeg')[0] == 401)
for k, (data, meta) in r1.items():
    check('put render ' + k, req('PUT', '/r/' + meta['id'], data, ctype='image/jpeg')[0] == 201)
check('publish bad lqip 400', req('PUT', '/publish', {**body1, 'lqip': 'javascript:alert(1)'})[0] == 400)
check('publish no key 401', req('PUT', '/publish', body1, key=None)[0] == 401)
s, h, b = req('PUT', '/publish', body1)
check('publish 1 ok', s == 200 and 'id' in json.loads(b), b)
id1 = json.loads(b)['id']
s, h, b = req('GET', '/live', key=None)
live = json.loads(b)
check('live after publish', live['id'] == id1 and live['title'] == 'First collage' and live['full']['id'] == r1['full'][1]['id'], live)
s, h, b = req('GET', '/r/' + r1['full'][1]['id'], key=None)
check('public render roundtrip', s == 200 and b == r1['full'][0] and 'immutable' in h.get('Cache-Control', '') and h.get('Access-Control-Allow-Origin') == '*', (s, h))
s, h, b = req('GET', '/r/' + r1['full'][1]['id'], key=None, headers={'If-None-Match': '"' + r1['full'][1]['id'] + '"'})
check('render 304 on etag', s == 304, s)
s, h, b = req('GET', '/og.jpg', key=None)
check('og.jpg serves og render', s == 200 and b == r1['og'][0], (s, len(b)))
s, h, b = req('GET', '/project')
check('project roundtrip', s == 200 and json.loads(b)['doc'] == doc1, b[:200])
check('project without key 401', req('GET', '/project', key=None)[0] == 401)
check('src not public', req('GET', '/r/' + H(big), key=None)[0] == 404)

# publish 2 drops the small photo; publish-1 renders survive as "previous"
doc2 = {'v': 1, 'images': {H(big): {'w': 10, 'h': 10}}, 'mode': 'free'}
r2 = renders('two')
for k, (data, meta) in r2.items(): req('PUT', '/r/' + meta['id'], data, ctype='image/jpeg')
s, h, b = req('PUT', '/publish', {'title': 'Second', 'W': 1000, 'H': 1000, 'lqip': lqip, 'doc': doc2, **{k: v[1] for k, v in r2.items()}})
check('publish 2 ok', s == 200, b)
check('gc: dropped photo deleted', json.loads(req('POST', '/have', {'ids': [H(big), H(small)]})[2])['missing'] == [H(small)])
check('gc: previous renders kept', req('GET', '/r/' + r1['full'][1]['id'], key=None)[0] == 200)
r3 = renders('three')
for k, (data, meta) in r3.items(): req('PUT', '/r/' + meta['id'], data, ctype='image/jpeg')
s, h, b = req('PUT', '/publish', {'title': 'Third', 'W': 1000, 'H': 1000, 'lqip': lqip, 'doc': doc2, **{k: v[1] for k, v in r3.items()}})
check('publish 3 ok', s == 200, b)
check('gc: renders two deploys back deleted', req('GET', '/r/' + r1['full'][1]['id'], key=None)[0] == 404)
check('gc: previous (2) renders kept', req('GET', '/r/' + r2['preview'][1]['id'], key=None)[0] == 200)
check('unknown route 404', req('GET', '/nope')[0] == 404)
s, h, b = req('OPTIONS', '/publish', key=None, headers={'Origin': 'http://localhost:5500', 'Access-Control-Request-Method': 'PUT'})
check('preflight', s == 204 and h.get('Access-Control-Allow-Origin') == 'http://localhost:5500', (s, h))

# drafts: shared by every device with the key
s, h, b = req('GET', '/drafts')
d0 = json.loads(b)
check('drafts: the live project became draft #1', s == 200 and len(d0['drafts']) == 1 and d0['live']['draft'] == d0['drafts'][0]['id']
      and d0['live']['draftRev'] == 1 and d0['drafts'][0]['images'] == [H(big)], d0)
check('drafts need the key', req('GET', '/drafts', key=None)[0] == 401)
check('drafts: listing twice adds nothing', len(json.loads(req('GET', '/drafts')[2])['drafts']) == 1)
other = fake_jpeg(50_000, b'other')
dA = {'v': 1, 'title': 'Beach', 'images': {H(other): {'w': 3, 'h': 3}}, 'mode': 'grid'}
s, h, b = req('PUT', '/drafts/beach0001', {'base': 0, 'doc': dA})
check('draft with a photo not uploaded yet 409 missing', s == 409 and json.loads(b)['missing'] == [H(other)], b)
req('PUT', '/src/' + H(other), other, ctype='image/jpeg')
s, h, b = req('PUT', '/drafts/beach0001', {'base': 0, 'doc': dA, 'preview': lqip})
check('create draft', s == 201 and json.loads(b)['rev'] == 1, b)
check('create it again 409', req('PUT', '/drafts/beach0001', {'base': 0, 'doc': {**dA, 'bg': '#000'}})[0] == 409)
s, h, b = req('GET', '/drafts/beach0001')
check('read draft back', s == 200 and json.loads(b)['doc'] == dA and json.loads(b)['title'] == 'Beach', b[:200])
s, h, b = req('PUT', '/drafts/beach0001', {'base': 1, 'doc': dA, 'preview': lqip})
check('same doc again keeps the rev', s == 200 and json.loads(b)['rev'] == 1, b)
s, h, b = req('PUT', '/drafts/beach0001', {'base': 1, 'doc': {**dA, 'bg': '#111'}})
check('save at the current rev', s == 200 and json.loads(b)['rev'] == 2, b)
s, h, b = req('PUT', '/drafts/beach0001', {'base': 1, 'doc': {**dA, 'bg': '#222'}})
check('save from a stale rev 409 with the current rev', s == 409 and json.loads(b)['rev'] == 2, b)
check('bad draft id 404', req('GET', '/drafts/x')[0] == 404)
check('bad doc 400', req('PUT', '/drafts/beach0002', {'base': 0, 'doc': [1]})[0] == 400)
check('bad preview ignored', req('PUT', '/drafts/beach0002', {'base': 0, 'doc': dA, 'preview': 'javascript:1'})[0] == 201
      and next(d for d in json.loads(req('GET', '/drafts')[2])['drafts'] if d['id'] == 'beach0002')['preview'] is None)
# publish a draft: the live record knows which; photos other drafts use survive the publish
r4 = renders('four')
for k, (data, meta) in r4.items(): req('PUT', '/r/' + meta['id'], data, ctype='image/jpeg')
s, h, b = req('PUT', '/publish', {'title': 'Beach', 'W': 1000, 'H': 1000, 'lqip': lqip, 'doc': {**dA, 'bg': '#111'},
                                  'draft': 'beach0001', 'draftRev': 2, **{k: v[1] for k, v in r4.items()}})
check('publish a draft', s == 200, b)
d1 = json.loads(req('GET', '/drafts')[2])
check('live points at the published draft', d1['live']['draft'] == 'beach0001' and d1['live']['draftRev'] == 2, d1['live'])
check('photos used by other drafts survive a publish', json.loads(req('POST', '/have', {'ids': [H(big), H(other)]})[2])['missing'] == [])
check('live project not public', 'draft' not in json.loads(req('GET', '/live', key=None)[2]))
# delete: a photo nothing uses any more is swept
check('delete draft #1', req('DELETE', '/drafts/' + d0['drafts'][0]['id'])[0] == 200)
check('its only photo is gone', json.loads(req('POST', '/have', {'ids': [H(big), H(other)]})[2])['missing'] == [H(big)])
check('delete again 404', req('DELETE', '/drafts/' + d0['drafts'][0]['id'])[0] == 404)
check('delete twice-used photo kept', req('DELETE', '/drafts/beach0002')[0] == 200
      and json.loads(req('POST', '/have', {'ids': [H(other)]})[2])['missing'] == [])
check('saving a deleted draft 404', req('PUT', '/drafts/beach0002', {'base': 1, 'doc': dA})[0] == 404)
s, h, b = req('OPTIONS', '/drafts/beach0001', key=None, headers={'Origin': 'https://vaibhavkumar.is-a.dev', 'Access-Control-Request-Method': 'DELETE'})
check('preflight allows DELETE', s == 204 and 'DELETE' in h.get('Access-Control-Allow-Methods', ''), (s, h))

print('\n%d failure(s)' % fails)
sys.exit(1 if fails else 0)
