#!/usr/bin/env node
// Регрессия генератора: хеш высот/биомов/рек 24 миров (K=0,2,3,5; часть с катастрофами) сравнивается с tools/golden.json.
//   node tools/golden.js           проверка (≈20 с); расхождение = география изменилась (ожидаемо только после осознанной правки генератора)
//   node tools/golden.js --write   записать новый эталон
const fs=require('fs'),path=require('path');const { open, ready } = require('./lib');
(async()=>{const {b,p,errs}=await open('?seed=zeta'); await ready(p,'zeta');
 const out=await p.evaluate(()=>{const r={};for(const K of [0,2,3,5])for(let i=1;i<=6;i++){const seed='g'+i+'k';const m=FM.generate({seed,genVersion:2,plateCount:9,landRatio:0.34,epochs:2,continents:K,islands:3,catastrophes:i%2?{meteor:2,rift:2,canyon:2,caldera:1,subsidence:1}:null,W:480,H:320});let a=0;for(let j=0;j<m.h.length;j++)a=(a*31+Math.round(m.h[j]*1000)+m.biome[j]*7+(m.riverMask&&m.riverMask[j]?3:0))|0;r[seed+'/'+K]=a;}return r;});
 const F=path.join(__dirname,'golden.json');
 if(process.argv.includes('--write')){fs.writeFileSync(F,JSON.stringify(out));console.log('записано',Object.keys(out).length,'миров');}
 else{const g=JSON.parse(fs.readFileSync(F,'utf8'));const bad=Object.keys(out).filter(k=>g[k]!==out[k]);console.log(bad.length?'РАСХОЖДЕНИЕ: '+bad.join(', '):'совпадает: '+Object.keys(out).length+' миров');if(bad.length||errs.length)process.exitCode=1;}
 console.log(errs.length?'ошибок страницы: '+errs.length:'ошибок страницы нет');await b.close();})();
