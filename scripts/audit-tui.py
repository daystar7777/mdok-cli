"""Actual PTY scenarios; no user settings, documents or remote services."""
import os, pty, subprocess, select, time, fcntl, termios, struct, re, json, sys
from pathlib import Path

fixture = str(Path(__file__).with_name('audit-tui-fixture.mjs').resolve())
ansi = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
results = []

def run(name, actions, verify, mode='plain', width=120, lang=None, override=None, start_edit=True):
    if len(sys.argv)>1 and sys.argv[1] not in name: return
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH',30,width,0,0))
    env = dict(os.environ, TERM='xterm-256color', NO_COLOR='1')
    if lang is not None: env['MDOK_AUDIT_LANG']=lang
    if override is not None: env['MDOK_LANG']=override
    process = subprocess.Popen(['node',fixture,mode],stdin=slave,stdout=slave,stderr=slave,env=env)
    os.close(slave)
    output = bytearray()
    def drain(seconds):
        start=len(output); until=time.monotonic()+seconds
        while time.monotonic()<until:
            if select.select([master],[],[],max(0,until-time.monotonic()))[0]:
                try: chunk=os.read(master,65536)
                except OSError: break
                if not chunk: break
                output.extend(chunk)
        return ansi.sub('',output[start:].decode('utf8','replace'))
    screens=[]
    try:
        initial=drain(0.5)
        for _ in range(10):
            if '[View]' in initial or '[보기]' in initial: break
            initial+=drain(0.25)
        check('[View]' in initial or '[보기]' in initial,'TUI did not start in viewer mode')
        # Existing editor regressions now explicitly enter editing first.
        if start_edit:
            os.write(master,b'\r')
            initial=drain(0.3)
            for _ in range(10):
                if '[Split]' in initial or '[분할]' in initial: break
                initial+=drain(0.25)
            check('[Split]' in initial or '[분할]' in initial,'Enter did not enter split editing')
        screens.append(initial)
        for action in actions:
            if isinstance(action,dict):
                if 'click' in action:
                    import unicodedata
                    label=action['click']
                    rows=screens[-1].splitlines()
                    row=next(i for i,line in enumerate(rows) if label in line)
                    before=rows[row].split(label)[0]
                    col=sum(0 if unicodedata.combining(c) else 2 if unicodedata.east_asian_width(c) in ('W','F') else 1 for c in before)+2
                    os.write(master,f'\x1b[<0;{col};{row+1}M'.encode())
                else: os.write(master,action['key'].encode())
            elif isinstance(action,tuple):
                rows,cols=action
                fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0))
                process.send_signal(__import__('signal').SIGWINCH)
            else: os.write(master,action.encode())
            # Worker-backed math/comparison opens asynchronously. Keep one screen
            # per action so assertions retain their exact event indices.
            screens.append(drain(action.get('wait',0.5) if isinstance(action,dict) else 0.8 if name.startswith('math ') else 0.4 if name.startswith('explore ') else 0.22 if action!='\x13' else 0.4))
        # Exit may need confirmation for unsaved fixtures; preserve session evidence.
        if process.poll() is None:
            drain(0.2) # Let the overlay's 300ms opening guard expire before Esc.
            os.write(master,b'\x1b');drain(0.4)
            # Search is nested inside comparison: first Esc closes the query,
            # second closes the comparison before requesting application exit.
            if process.poll() is None:
                os.write(master,b'\x1b');drain(0.4)
        for _ in range(4):
            if process.poll() is not None: break
            try: os.write(master,b'\x11')
            except OSError: break
            drain(0.22)
        process.wait(timeout=3)
        raw=output.decode('utf8','replace')
        match=re.search(r'AUDIT_RESULT=(.+)',raw)
        if not match: raise AssertionError('fixture did not return final snapshot')
        data=json.loads(match.group(1))
        verify(data,screens)
        result={'name':name,'status':'PASS'}
    except Exception as error:
        result={'name':name,'status':'FAIL','reason':str(error)}
        result['screens']=[screen[-2500:] for screen in screens]
        if b'AUDIT_RESULT=' not in output: result['tail']=ansi.sub('',output.decode('utf8','replace'))[-1400:]
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=1)
            except subprocess.TimeoutExpired: process.kill();process.wait()
        os.close(master)
    results.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)

def check(condition,message):
    if not condition: raise AssertionError(message)
def unchanged(d,s): check(d['a'].startswith('ALPHA'),'View-mode typing changed file: '+repr(d['a'][:24]))
def buffer(d,i=0):
    f=d['session']['files'][i];return f.get('content',d['a'] if f['path'].endswith('a.md') else d['b'])
def final_frame(s):
    return re.split(r'(?=\[>\] mdok)',s)[-1]

run('single-file view cycle',['\x0fv','\x0fv','\x0fv'],lambda d,s: check('[View]' in s[2] and 'ALPHA' in s[2] and '[Split]' in s[3],'body missing on mode transition'))
run('two-file View renders only selected document',['\x0fv','\x0fv','\x0f2'],lambda d,s:check('ALPHA' in final_frame(s[-2]) and 'BRAVO' not in final_frame(s[-2]) and 'BRAVO' in final_frame(s[-1]) and 'ALPHA' not in final_frame(s[-1]),'inactive document visible or selected document missing'),mode='two')
run('selected document Split mouse tab switching',['\x1b[<0;12;2M'],lambda d,s:check('ALPHA' in final_frame(s[0]) and 'BRAVO' not in final_frame(s[0]) and 'BRAVO' in final_frame(s[-1]) and 'ALPHA' not in final_frame(s[-1]) and '[Split]' in final_frame(s[-1]),'Split did not show only selected document'),mode='two')
run('selected document preserves unsaved buffers',['X','\x0f2','Y','\x0f1'],lambda d,s:check(buffer(d,0).startswith('XALPHA') and buffer(d,1).startswith('YBRAVO') and 'XALPHA' in final_frame(s[-1]) and 'YBRAVO' not in final_frame(s[-1]),'switch lost or mixed unsaved buffers'),mode='two')
run('selected document narrow name navigation',['\x1b[<0;11;2M'],lambda d,s:check('BRAVO' in final_frame(s[-1]) and 'ALPHA' not in final_frame(s[-1]) and '[2 b.md]' in final_frame(s[-1]),'narrow tab navigation failed'),mode='two',width=40,start_edit=False)
run('selected document second source mouse edit',['\x0f2','\x1b[<0;8;5M','X','\x13'],lambda d,s:check(d['a'].startswith('ALPHA') and 'X' in d['b'] and d['b'].replace('X','')=='BRAVO document','mouse edit targeted wrong document'),mode='two')
run('selected document ten unicode names resize',['\x0f9',(30,40),(30,120)],lambda d,s:check('DOCUMENT_9_ONLY' in final_frame(s[-1]) and 'DOCUMENT_8_ONLY' not in final_frame(s[-1]) and 'ALPHA' not in final_frame(s[-1]) and len(d['session']['files'])==10,'many names lost selected content or buffers'),mode='many',start_edit=False)
run('selected document narrow opens another file',['\x0ff','3','2'],lambda d,s:check(len(d['session']['files'])==2 and 'BRAVO' in final_frame(s[-1]) and 'ALPHA' not in final_frame(s[-1]),'narrow open still constrained by document count'),width=40)
run('View Tab cannot edit hidden source',['\x0fv','\x0fv','\t','X','\x13'],unchanged)
run('emoji backspace keeps valid text',['\x1b[C','\x7f','\x13'],lambda d,s:check(d['a']=='ABC','saved '+repr(d['a'])),mode='emoji')
run('emoji delete keeps valid text',['\x1b[3~','\x13'],lambda d,s:check(d['a']=='ABC','saved '+repr(d['a'])),mode='emoji')
run('left arrow crosses emoji',['\x1b[C','\x1b[D','X','\x13'],lambda d,s:check(d['a']=='X😀ABC','saved '+repr(d['a'])),mode='emoji')
run('rapid cross-tab typing remains undoable',['X','\x0f2','Y','\x1a','\x13'],lambda d,s:check(d['b']=='BRAVO document','undo left '+repr(d['b'])),mode='two')
run('ASCII undo redo save',['X','\x1a','\x19','\x13'],lambda d,s:check(d['a'].startswith('XALPHA'),'redo did not restore edit'))
run('dirty close confirmation via separate leader keys',['X','\x0f','w','\x0f','w'],lambda d,s:check(len(d['session']['files'])==1,'tab remains after second close confirmation'),mode='two')
run('sidebar on/off retains View content',['\x0fv','\x0fv','\x0fb','\x0fb'],lambda d,s:check('ALPHA' in s[-1],'sidebar toggle lost preview'))
run('View page down changes visible lines',['\x0fv','\x0fv','\x1b[6~'],lambda d,s:check('ALPHA line 26' in s[-1],'page-down did not scroll'))
run('resize View narrow and restore',['\x0fv','\x0fv',(20,40),(30,120)],lambda d,s:check('ALPHA' in s[-1],'resize lost preview'))
run('file menu creates a new tab',['\x0ff','2'],lambda d,s:check(len(d['session']['files'])==2,'new file missing'))
run('QR opens then closes without document changes',['\x0fr','q'],lambda d,s:check('MDOK1' in s[1] and 'ALPHA' in s[2] and d['a'].startswith('ALPHA'),'QR transition failed'))
run('help closes back to document',['\x0f?','q'],lambda d,s:check('ALPHA' in s[-1],'help did not return to document'))
run('new file can be typed and saved',['\x0ff','2','NEW','\x13'],lambda d,s:check(d['saved'].get('untitled-1.md')=='NEW','new file save failed'))
run('file menu opens existing second file',['\x0ff','3','2'],lambda d,s:check(len(d['session']['files'])==2 and 'BRAVO' in s[-1],'existing file open failed'))
run('clean tab closes without warning',['\x0fw'],lambda d,s:check(len(d['session']['files'])==1 and d['session']['files'][0]['path'].endswith('b.md'),'clean tab close failed'),mode='two')
run('search overlay does not edit document',['\x0f/','ALPHA','\r','\x13'],unchanged)
run('settings Escape returns to document',['\x0fc',{'key':'','wait':0.2},{'key':'\x1b','wait':0.4}],lambda d,s:check('ALPHA' in s[-1],'settings did not close'))
run('mouse View button changes mode',['\x1b[<0;11;1M'],lambda d,s:check('[Src]' in s[-1],'header click missed View button'))
run('saving A then switching B does not dirty B',['X',{'key':'\x13','wait':0.01},'\x0f2',{'key':'','wait':0.6}],lambda d,s:check('content' not in d['session']['files'][1],'save completion incorrectly changed B baseline'),mode='slow-save')
run('Markdown formatting is undoable',['\x0fF','\x1a','\x13'],lambda d,s:check(d['a']=='TRAIL \n\n\nEND','format cannot be undone: '+repr(d['a'])),mode='format')
run('table formatting is undoable',['\x0f|','\x1a','\x13'],lambda d,s:check(d['a']=='|a|b|\n|---|---|\n|c|d|','table format cannot be undone: '+repr(d['a'])),mode='table')
run('shell output opens and closes',['\x0f!','printf AUDIT_OK','\r',{'key':'','wait':0.4},'\x1b'],lambda d,s:check(any('AUDIT_OK' in screen for screen in s[3:]) and 'ALPHA' in s[-1],'shell panel transition failed'))
run('HTML export writes current document',['\x0ff','5'],lambda d,s:check(d['html'] is not None and 'ALPHA' in d['html'],'HTML export missing'))
run('i18n Korean file menu translated',['\x0ff'],lambda d,s:check('저장' in s[-1] and '│ File' not in s[-1],'file menu title remains English'),lang='ko')
run('i18n environment overrides English config',['\x0fr'],lambda d,s:check('암호화' in s[-1],'MDOK_LANG=ko ignored by TUI'),lang='en',override='ko')
run('i18n environment overrides Korean config',['\x0fr'],lambda d,s:check('NOT encrypted' in s[-1],'MDOK_LANG=en ignored by TUI'),lang='ko',override='en')
run('i18n multilingual text paste save',['한글 日本語 中文 العربية עברית é 👩‍💻','\x13'],lambda d,s:check(d['a'].startswith('한글 日本語 中文 العربية עברית é 👩‍💻'),'Unicode input changed'),lang='ko')
run('i18n Korean sidebar uses translated title',['\x0fb'],lambda d,s:check('Files' not in s[-1] and '파일' in s[-1],'sidebar has hardcoded English Files'),lang='ko')
run('i18n settings switches English to Korean and persists',['\x0fc']+['\x1b[B']*5+['\r','\x1b'],lambda d,s:check(d['language']=='ko' and any('언어:' in screen for screen in s),'language switch/persistence failed'),lang='en')
run('i18n settings switches Korean to English and persists',['\x0fc']+['\x1b[B']*5+['\r','\x1b'],lambda d,s:check(d['language']=='en' and any('language:' in screen for screen in s),'language switch/persistence failed'),lang='ko')
run('extra Korean File button mouse hitbox',['\x1b[<0;91;1M'],lambda d,s:check('저장' in s[-1] and 'HTML' in s[-1],'translated File button hitbox missed'),lang='ko')
run('extra Korean active search status',['\x0f/','ALPHA','\r'],lambda d,s:check('찾기 "ALPHA"' in s[-1],'active search status is not translated'),lang='ko')
run('extra shell mini field deletes whole emoji',['\x0f!','printf 👩‍💻','\x7f','AUDIT_MINI','\r',{'key':'','wait':0.4},'\x1b'],lambda d,s:check(any('AUDIT_MINI' in screen for screen in s[5:]) and not any('�' in screen for screen in s) and 'output:' not in s[-1],'mini field or shell output failed'))
run('integration File menu exposes external tools',['\x0ff'],lambda d,s:check('VS Code' in s[-1] and 'Pandoc' in s[-1],'external tool entries missing'))
run('integration Pandoc profile cycles',['\x0ff','9','1','1'],lambda d,s:check('commonmark' in s[-2] and 'pandoc' in s[-1] and 'MathML' in s[-1],'profile switch failed'))
run('integration VS Code rejects dirty buffer',['X','\x0ff','8'],lambda d,s:check('Ctrl+S' in s[-1] and buffer(d).startswith('XALPHA') and d['a'].startswith('ALPHA'),'dirty buffer guard failed'))
run('viewer default rejects text input',['X','\x13'],lambda d,s:check('[View]' in s[0] and 'Enter edit' in s[0] and d['a'].startswith('ALPHA') and buffer(d).startswith('ALPHA'),'default viewer allowed editing'),start_edit=False)
run('viewer Enter enters split without newline',['\r','X','\x13'],lambda d,s:check('[Split]' in s[1] and d['a'].startswith('XALPHA'),'Enter inserted text or failed to focus editor'),start_edit=False)
run('viewer second Enter inserts newline',['\r','\r','\x13'],lambda d,s:check(d['a'].startswith('\nALPHA'),'editing Enter did not insert newline'),start_edit=False)
run('viewer Korean Enter hint',['\r'],lambda d,s:check('Enter 편집' in s[0] and '[분할]' in s[1] and d['a'].startswith('ALPHA'),'Korean viewer transition failed'),lang='ko',start_edit=False)
run('viewer file menu Enter does not enter editor',['\x0ff','\r'],lambda d,s:check(not any('[Split]' in screen for screen in s) and d['a'].startswith('ALPHA'),'menu Enter leaked into edit mode'),start_edit=False)
run('math tools menu and body unchanged',['\x0fM'],lambda d,s:check('Math tools' in s[-1] and 'Engine' in s[-1] and buffer(d)==d['a'],'math menu changed buffer'),mode='math')
run('math KaTeX actual engine diagnostics',['\x0fM','1',{'key':'','wait':0.7},'3'],lambda d,s:check('could not parse' in s[-1] and 'Unclosed' in s[-1],'engine/structure diagnostics missing'),mode='math-bad')
run('math MathJax actual engine diagnostics',['\x0fM','1','1',{'key':'','wait':0.7},'3'],lambda d,s:check('could not parse' in s[-1],'MathJax warning missing'),mode='math-bad')
run('math conversion applies only on y',['\x0fM','5','y','\x13'],lambda d,s:check('\\[x^2\\]' in d['a'] and '\\(y\\)' in d['a'] and '`$code$`' in d['a'],'conversion failed'),mode='math')
run('math conversion Undo restores exact source',['\x0fM','5','y','\x1a','\x13'],lambda d,s:check(d['a']=='# Math\n\n$$x^2$$\n\nInline $y$.\n\n`$code$`','conversion Undo failed'),mode='math')
run('math conversion Enter does not apply',['\x0fM','5','\r','\x1b'],lambda d,s:check(buffer(d)==d['a'] and '$$x^2$$' in buffer(d),'Enter unexpectedly applied conversion'),mode='math')
run('math Korean tool translations',['\x0fM'],lambda d,s:check('수식 도구' in s[-1] and '엔진' in s[-1],'math labels not translated'),lang='ko',mode='math')
run('math compare buffer disk read only',['X','\x0fD','\r','\r','\x1b','\x13'],lambda d,s:check(d['a'].startswith('XALPHA') and not d['a'].startswith('\n'),'comparison Enter leaked into editor'))
run('math compare raw and wide toggle',['X','\x0fD','\r','r','r','\t'],lambda d,s:check('Raw' in s[4] and '│' in s[-1] and buffer(d).startswith('XALPHA'),'comparison toggle failed'))
run('math compare long diff beyond 60 lines',['\x0fD']+['\x7f']*5+['b.md','\r','r']+['\x1b[6~']*12,lambda d,s:check(any('line 99' in screen for screen in s[8:]),'long diff is truncated'),mode='compare-long')
run('math compare query jump and Escape stays in comparison',['X','\x0fD','\r','/',':1','\r','/','\x1b'],lambda d,s:check('Markdown comparison' in s[-1] and buffer(d).startswith('XALPHA'),'search/jump leaked'))
run('math narrow compare query remains visible',['X','\x0fD','\r','/'],lambda d,s:check('Markdown comparison' in s[-1] and '/' in s[-1] and buffer(d).startswith('XALPHA'),'narrow comparison overflow'),width=40)
run('math narrow diagnostics returns to document',['\x0fM','3','\x1b'],lambda d,s:check('Unclosed' in s[-2] and '[Split]' in s[-1],'narrow diagnostics overflow'),width=40,mode='math-bad')
run('explore header mouse opens full screen',[{'click':'[Explore]'}],lambda d,s:check('[Explore] mdok' in s[-1] and 'New MD' in s[-1] and 'ALPHA line 1' not in s[-1],'Explore did not replace document screen'))
run('explore Escape preserves cursor and source',['\x1b[C','\x0fE','\x1b','X','\x13'],lambda d,s:check(d['a'].startswith('AXLPHA') and len(d['session']['files'])==1,'return changed editor state'))
run('explore open replaces document in viewer',['\x0fE','/','b.md','\r','\x1b[B','\r'],lambda d,s:check('[View]' in s[-1] and 'BRAVO document' in s[-1] and len(d['session']['files'])==1 and d['session']['files'][0]['path'].endswith('b.md'),'open did not replace current document'))
run('explore dirty cancel retains document',['X','\x0fE','/','b.md','\r','\x1b[B','\r','c','\x1b'],lambda d,s:check(buffer(d).startswith('XALPHA') and d['a'].startswith('ALPHA'),'cancel lost changes'))
run('explore dirty save before opening',['X','\x0fE','/','b.md','\r','\x1b[B','\r','s'],lambda d,s:check(d['a'].startswith('XALPHA') and d['session']['files'][0]['path'].endswith('b.md'),'save/open failed'))
run('explore dirty discard before opening',['X','\x0fE','/','b.md','\r','\x1b[B','\r','d'],lambda d,s:check(d['a'].startswith('ALPHA') and d['session']['files'][0]['path'].endswith('b.md'),'discard/open failed'))
run('explore creates Korean Markdown in split',['\x0fE','n','새 문서','\r','HELLO','\x13'],lambda d,s:check(d['saved'].get('새 문서.md')=='HELLO' and len(d['session']['files'])==1 and '[Split]' in s[-3],'new Markdown failed'))
run('explore existing name never overwritten',['\x0fE','n','a.md','\r'],lambda d,s:check(d['a'].startswith('ALPHA') and 'EEXIST' in s[-1],'existing file overwritten or failure hidden'))
run('explore mouse selects and opens',['\x0fE','\x1b[<0;8;7M',{'click':'[Open]'}],lambda d,s:check('[View]' in s[-1] and 'BRAVO document' in s[-1],'mouse Open failed'))
run('explore double click opens file',['\x0fE',{'key':'\x1b[<0;8;7M','wait':0.1},{'key':'\x1b[<0;8;7M','wait':0.5}],lambda d,s:check('BRAVO document' in s[-1] and '[View]' in s[-1],'double click failed'))
run('explore narrow screen and Korean',['\x0fE','\x1b'],lambda d,s:check('[Explore] mdok' in s[-2] and '돌아' not in buffer(d) and '[분할]' in s[-1],'narrow explorer failed'),width=40,lang='ko')
run('explore remembers selection and search on return',['\x0fE','/','b.md','\r','\x1b[B','\x1b','\x0fE','\r'],lambda d,s:check(d['session']['files'][0]['path'].endswith('b.md'),'explorer state was lost'))
run('explore folder path and child open',['\x0fE','p','\x15','folder','\r','\x1b[B','\r'],lambda d,s:check('CHILD document' in s[-1] and d['session']['files'][0]['path'].endswith('folder/child.md'),'folder navigation failed'),mode='explorer')
run('explore same path navigation completes',['\x0fE','p','\x15','.','\r'],lambda d,s:check('Loading' not in s[-1].rsplit('[Explore] mdok',1)[-1] and 'b.md' in s[-1].rsplit('[Explore] mdok',1)[-1],'same path stuck loading'))
run('explore save and reopen same file preserves saved content',['X','\x0fE','/','a.md','\r','\x1b[B','\r','s'],lambda d,s:check(d['a'].startswith('XALPHA') and buffer(d).startswith('XALPHA'),'reopen loaded stale disk content'))
run('explore hidden toggle and large list scrolling',['\x0fE','h','\x1b[F'],lambda d,s:check('.hidden.md' in s[-2] and 'doc-44.md' in s[-1],'hidden/large listing failed'),mode='explorer')
run('explore binary open keeps current document',['\x0fE','m','/','binary.bin','\r','\x1b[B','\r'],lambda d,s:check('Binary files' in s[-1] and buffer(d).startswith('ALPHA'),'binary input replaced document'),mode='explorer')
run('explore narrow mouse back button',['\x0fE',{'click':'[돌아가기]'}],lambda d,s:check('[분할]' in s[-1] and buffer(d).startswith('ALPHA'),'narrow mouse Back failed'),width=40,lang='ko')
run('explore split mouse bytes do not pollute filename',['\x0fE','n',{'key':'\x1b[<','wait':0.01},{'key':'64;8;7M','wait':0.3},'mouse-clean','\r'],lambda d,s:check('mouse-clean.md' in d['saved'] and len(d['saved'])==3,'mouse bytes entered filename'))
run('explore mouse save confirmation at fixed bottom row',['X','\x0fE','/','b.md','\r','\x1b[B','\r','\x1b[<0;3;29M'],lambda d,s:check(d['a'].startswith('XALPHA') and d['session']['files'][0]['path'].endswith('b.md'),'bottom Save mouse hitbox failed'))
for mode,cluster in [('zwj','👩‍💻'),('nfd','한')]:
    run('grapheme '+mode+' backspace',['\x1b[C','\x7f','\x13'],lambda d,s:check(d['a']=='ABC','cluster backspace corrupted text: '+repr(d['a'])),mode=mode)
    run('grapheme '+mode+' delete',['\x1b[3~','\x13'],lambda d,s:check(d['a']=='ABC','cluster delete corrupted text: '+repr(d['a'])),mode=mode)
    run('grapheme '+mode+' left',['\x1b[C','\x1b[D','X','\x13'],lambda d,s,c=cluster:check(d['a']=='X'+c+'ABC','left split cluster: '+repr(d['a'])),mode=mode)
print(json.dumps({'total':len(results),'passed':sum(r['status']=='PASS' for r in results),'failed':sum(r['status']=='FAIL' for r in results)},ensure_ascii=False))
sys.exit(1 if any(r['status']=='FAIL' for r in results) else 0)
