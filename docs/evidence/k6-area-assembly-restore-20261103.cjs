'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),archive=JSON.parse(fs.readFileSync(path.join(__dirname,'k6-area-assembly-20261103.json'),'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(archive.schema,'k6-native-assembly-reference-archive-v1');assert.equal(archive.encoding,'external-json-pointers-v1');
const sources=new Map();
for(const s of archive.sources){
 assert(/^docs\/evidence\/[A-Za-z0-9._-]+\.json$/.test(s.path));assert(!sources.has(s.id));
 const b=fs.readFileSync(path.join(root,s.path));assert.equal(sha(b),s.sha256,'source digest mismatch: '+s.path);sources.set(s.id,JSON.parse(b));
}
function decode(v){
 if(Array.isArray(v))return v.map(decode);
 if(v&&typeof v==='object'){
  if(Object.hasOwn(v,'$source')){assert.deepEqual(Object.keys(v),['$source','pointer']);assert(sources.has(v.$source));let x=sources.get(v.$source);if(v.pointer!=='')for(const k of v.pointer.slice(1).split('/'))x=x[k.replace(/~1/g,'/').replace(/~0/g,'~')];assert.notEqual(x,undefined);return x;}
  return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]));
 }
 return v;
}
const bytes=Buffer.from(JSON.stringify(decode(archive.nativeResultTemplate))+'\n');
assert.equal(bytes.length,archive.decodedNativeBytes);assert.equal(sha(bytes),archive.decodedNativeSHA256,'decoded native digest mismatch');
process.stdout.write(bytes);
