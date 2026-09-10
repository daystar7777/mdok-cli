"""Actual PTY scenarios; no user settings, documents or remote services."""
import os, pty, subprocess, select, time, fcntl, termios, struct, re, json, sys
from pathlib import Path

fixture = str(Path(__file__).with_name('audit-tui-fixture.mjs').resolve())
ansi = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
results = []

def run(name, actions, verify, mode='plain', width=120, lang=None, override=None):
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
            if '[Split]' in initial or '[분할]' in initial: break
            initial+=drain(0.25)
        check('[Split]' in initial or '[분할]' in initial,'TUI did not finish initial rendering')
        screens.append(initial)
        for action in actions:
            if isinstance(action,dict):
                os.write(master,action['key'].encode())
            elif isinstance(action,tuple):
                rows,cols=action
                fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0))
                process.send_signal(__import__('signal').SIGWINCH)
            else: os.write(master,action.encode())
            screens.append(drain(action['wait'] if isinstance(action,dict) else 0.22 if action!='\x13' else 0.4))
        # Exit may need confirmation for unsaved fixtures; preserve session evidence.
        if process.poll() is None:
            drain(0.2) # Let the overlay's 300ms opening guard expire before Esc.
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

run('single-file view cycle',['\x0fv','\x0fv','\x0fv'],lambda d,s: check('[View]' in s[2] and 'ALPHA' in s[2] and '[Split]' in s[3],'body missing on mode transition'))
run('two-file View renders both documents',['\x0fv','\x0fv'],lambda d,s:check('ALPHA' in s[-1] and 'BRAVO' in s[-1],'one preview is missing'),mode='two')
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
for mode,cluster in [('zwj','👩‍💻'),('nfd','한')]:
    run('grapheme '+mode+' backspace',['\x1b[C','\x7f','\x13'],lambda d,s:check(d['a']=='ABC','cluster backspace corrupted text: '+repr(d['a'])),mode=mode)
    run('grapheme '+mode+' delete',['\x1b[3~','\x13'],lambda d,s:check(d['a']=='ABC','cluster delete corrupted text: '+repr(d['a'])),mode=mode)
    run('grapheme '+mode+' left',['\x1b[C','\x1b[D','X','\x13'],lambda d,s,c=cluster:check(d['a']=='X'+c+'ABC','left split cluster: '+repr(d['a'])),mode=mode)
print(json.dumps({'total':len(results),'passed':sum(r['status']=='PASS' for r in results),'failed':sum(r['status']=='FAIL' for r in results)},ensure_ascii=False))
sys.exit(1 if any(r['status']=='FAIL' for r in results) else 0)
