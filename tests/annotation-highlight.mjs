import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync('src/annotation-highlight.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { annotatedSegments, markerBaseColor, markerStroke, quoteThreads, quoteFragments } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const highlighted = (text, quotes) => annotatedSegments(text, quotes).filter(part => part.highlighted).map(part => part.text);
assert.deepEqual(highlighted('前句。只划这一句。后句。', ['只划这一句。']), ['只划这一句。']);
assert.deepEqual(highlighted('前句。只划这一句。后句。', []), []);
assert.deepEqual(highlighted('这里有\n  换行，也有\t间隔。', ['有 换行，也有 间隔']), ['有\n  换行，也有\t间隔']);
assert.deepEqual(highlighted('abcdef', ['abc', 'bcde', 'abc']), ['abcde']);
assert.deepEqual(highlighted('一句。中间。一句。', ['一句。']), ['一句。', '一句。']);
assert.deepEqual(highlighted('一句。一句。', ['一句。']), ['一句。一句。']);
assert.deepEqual(highlighted('整段的页边', [undefined]), ['整段的页边']);
assert.deepEqual(highlighted('原文已经修订', ['旧引用']), ['原文已经修订']);
assert.deepEqual(highlighted('只标有位置的句子。其余保留。', ['只标有位置的句子。', '旧引用']), ['只标有位置的句子。']);
for (const text of ['  标注\n 保留原文  ', 'emoji 🐳 与中文。', '多句。多句。', '']) {
  assert.equal(annotatedSegments(text, ['标注 保留原文', '中文']).map(part => part.text).join(''), text);
}
assert.equal(markerBaseColor('#6f8f55'), 'rgb(111, 143, 85)');
assert.equal(markerBaseColor('#ffffff'), 'rgb(175, 175, 175)');
assert.equal(markerBaseColor('invalid'), 'rgb(17, 17, 17)');
for (const fontSize of [14, 17, 18, 23, 28]) {
  for (const [state, opacity] of [['idle', .27], ['active', .39]]) {
    const uri = markerStroke('#ffffff', fontSize)[`--reader-marker-${state}`];
    const svg = decodeURIComponent(uri.slice('url("data:image/svg+xml,'.length, -2));
    assert.equal((svg.match(/fill-opacity=/g) || []).length, 1, 'Ink opacity must be applied once, never at a join');
    assert.ok(svg.includes(`fill-opacity="${opacity}"`));
    assert.ok(svg.includes('fill="rgb(175, 175, 175)"'));
    assert.ok(svg.includes(`width:min(${Number((fontSize * .4).toFixed(3))}px,50%)`));
    assert.ok(svg.includes('mask="url(#nib)"'));
    assert.ok(svg.includes('transform="translate(-10 0)"'));
  }
}
assert.deepEqual(quoteThreads('第一句。第二句。', [{quote:'第一句。',id:1},{quote:'第二句。',id:2},{quote:'第一句。',id:3}]).map(thread=>thread.notes.map(note=>note.id)), [[1,3],[2]]);
assert.deepEqual(quoteFragments('abcdef', ['abc','bcde']).map(fragment=>[fragment.text,fragment.quotes]), [['a',['abc']],['bc',['abc','bcde']],['de',['bcde']],['f',[]]]);
assert.equal(quoteThreads('有\n 换行', [{quote:'有 换行'}])[0].quote,'有\n 换行');
console.log('PASS: sentence ranges, original whitespace, overlapping/shared notes, repeated quotes, legacy notes, and pale custom themes.');
