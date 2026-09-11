const vscode=require('vscode');
const {execFile}=require('node:child_process');
const {stat}=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
exports.activate=context=>{
  context.subscriptions.push(vscode.commands.registerCommand('mdok.open',async uri=>{
    try{
      if(!vscode.workspace.isTrusted)throw Error('Trust this workspace before opening external applications.');
      uri=uri||vscode.window.activeTextEditor?.document.uri;
      if(!uri||uri.scheme!=='file'||vscode.env.remoteName)throw Error('Only local saved files are supported. Download remote documents first.');
      if(process.platform!=='darwin')throw Error('mdok desktop currently supports macOS only.');
      if(!/\.(md|markdown)$/i.test(uri.fsPath))throw Error('Select a Markdown document.');
      const doc=vscode.workspace.textDocuments.find(d=>d.uri.toString()===uri.toString());
      if(doc?.isDirty){
        if(await vscode.window.showWarningMessage('Save the latest changes before opening in mdok?',{modal:true},'Save and Open')!=='Save and Open')return;
        if(!await doc.save())return;
      }
      const info=await stat(uri.fsPath);if(!info.isFile()||info.size>1048576)throw Error('Select a file no larger than 1 MiB.');
      const configured=vscode.workspace.getConfiguration('mdok').get('appPath');
      const candidates=configured?[configured]:['/Applications/mdok.app',path.join(os.homedir(),'Applications/mdok.app')];
      let app;
      for(const p of candidates){if(!path.isAbsolute(p)||!p.endsWith('.app'))continue;try{if((await stat(path.join(p,'Contents/MacOS/mdok-desktop'))).isFile()){app=p;break;}}catch{}}
      if(!app)throw Error('Install mdok.app or configure mdok.appPath in User Settings.');
      await new Promise((resolve,reject)=>execFile('/usr/bin/open',['-a',app,uri.fsPath],{timeout:10000,maxBuffer:65536},e=>e?reject(e):resolve()));
      vscode.window.setStatusBarMessage('mdok: open requested',3000);
    }catch(e){vscode.window.showErrorMessage(String(e));}
  }));
};
