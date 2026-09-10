import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {previousBoundary, nextBoundary, graphemes} from '../src/width.js';
import {lintMarkdown} from '../src/lint.js';

for (const cluster of ['😀','👩‍💻','👍🏽','🇰🇷','e\u0301','한'.normalize('NFD'),'क्ष']) {
  test(`grapheme movement and deletion: ${cluster}`, () => {
    assert.equal([...graphemes(cluster)].length, 1);
    const text=cluster+'ABC';
    assert.equal(nextBoundary(text,0),cluster.length);
    assert.equal(previousBoundary(text,cluster.length),0);
    assert.equal(text.slice(nextBoundary(text,0)),'ABC');
    assert.equal(text.slice(0,previousBoundary(text,cluster.length))+text.slice(cluster.length),'ABC');
    for(let i=1;i<cluster.length;i++) {
      assert.equal(previousBoundary(text,i),0);
      assert.equal(nextBoundary(text,i),cluster.length);
    }
  });
}
test('empty and end-of-line grapheme boundaries are stable',()=>{
  assert.equal(previousBoundary('',0),0);
  assert.equal(nextBoundary('',0),0);
  assert.equal(nextBoundary('ABC',3),3);
  assert.equal(previousBoundary('ABC',0),0);
});
for(const lang of ['ko','ko-KR','en']) for(const command of [[],['config'],['ask']]) {
  test(`CLI help localization ${lang} ${command.join(' ')}`,()=>{
    const text=execFileSync(process.execPath,['--import','tsx','src/index.ts',...command,'--help'],{encoding:'utf8',env:{...process.env,MDOK_LANG:lang}});
    assert.match(text,lang.startsWith('ko')?/사용법:/:/Usage:/);
    assert.match(text,lang.startsWith('ko')?/도움말 표시/:/help/i);
  });
}
test('lint keeps identical locations and severity in both languages',()=>{
  const lines=['#heading','trailing  ','','','```'];
  const en=lintMarkdown(lines,'en'),ko=lintMarkdown(lines,'ko');
  assert.equal(en.length,ko.length);
  assert.ok(ko.length>0);
  for(let i=0;i<en.length;i++) {
    assert.equal(en[i].line,ko[i].line);
    assert.equal(en[i].col,ko[i].col);
    assert.equal(en[i].rule,ko[i].rule);
    assert.notDeepEqual(en[i],ko[i]);
  }
});
