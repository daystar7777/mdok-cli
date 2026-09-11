const {test}=require('node:test');const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
test('VS Code command: explicit argv, dirty cancellation, remote and untrusted rejection',async()=>{
 let handler,launched=[],errors=[],dirty=false,consent, saved=0;
 const uri={scheme:'file',fsPath:'/tmp/한 글 ; $(x).md',toString:()=> 'file:///fixture'};
 const doc={uri,get isDirty(){return dirty},save:async()=>{saved++;return true}};
 const vscode={commands:{registerCommand:(_,fn)=>{handler=fn;return {dispose(){}}}},env:{},workspace:{isTrusted:true,textDocuments:[doc],getConfiguration:()=>({get:()=>'/Applications/mdok.app'})},window:{activeTextEditor:{document:doc},showWarningMessage:async()=>consent,showErrorMessage:e=>errors.push(e),setStatusBarMessage(){}}};
 const mocks={vscode,'node:child_process':{execFile:(exe,args,opts,cb)=>{launched.push({exe,args});cb(null)}},'node:fs/promises':{stat:async()=>({isFile:()=>true,size:10})}};
 const sandbox={exports:{},process:{platform:'darwin'},require:x=>mocks[x]||require(x)};
 vm.runInNewContext(fs.readFileSync(__dirname+'/extension.cjs','utf8'),sandbox);sandbox.exports.activate({subscriptions:[]});
 await handler();assert.equal(launched.length,1);assert.equal(launched[0].args[2],uri.fsPath);
 dirty=true;await handler();assert.equal(launched.length,1);assert.equal(saved,0);
 consent='Save and Open';await handler();assert.equal(launched.length,2);assert.equal(saved,1);
 vscode.env.remoteName='ssh-remote';await handler();assert.match(errors.pop(),/local/);assert.equal(launched.length,2);
 vscode.env.remoteName=undefined;vscode.workspace.isTrusted=false;await handler();assert.match(errors.pop(),/Trust/);
});
