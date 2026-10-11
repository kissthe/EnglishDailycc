// 把单文件演示版整理成 Artifact 需要的格式：去掉 doctype/html/head/body 外壳，脚本放在 #root 之后
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-demo/demo.html', 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>English Daily</title>';
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]);
const scripts = [...html.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0].replace(/ crossorigin/, ''));
const out = [title, ...styles, '<div id="root"></div>', ...scripts].join('\n');
writeFileSync('dist-demo/english-daily-demo.html', out);
console.log(`dist-demo/english-daily-demo.html  ${(out.length / 1024).toFixed(0)} KB`);
