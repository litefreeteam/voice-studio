const fs=require('node:fs'),path=require('node:path');
module.exports=async context=>{
 if(context.electronPlatformName==='darwin'){
  const {execFileSync}=require('node:child_process'),crypto=require('node:crypto');
  const app=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app');
  const executable=path.join(app,'Contents/MacOS',context.packager.appInfo.productFilename);
  const framework=path.join(app,'Contents/Frameworks/Electron Framework.framework/Electron Framework');
  const guard=path.join(app,'Contents/Frameworks/ShengyueArchiveGuard.dylib');
  const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(app,'Contents/Resources/app.asar'))).digest('hex');
  const arch=execFileSync('/usr/bin/lipo',['-archs',executable],{encoding:'utf8'}).trim();
  if(!['arm64','x86_64'].includes(arch))throw Error('Unsupported archive-guard architecture: '+arch);
  execFileSync('/usr/bin/xcrun',['clang','-arch',arch,'-mmacosx-version-min=14.0','-dynamiclib','-O2','-Wno-deprecated-declarations',
   '-DEXPECTED_ASAR_SHA256="'+digest+'"',path.join(context.packager.projectDir,'native/archive-guard.c'),
   '-Wl,-reexport_library,'+framework,'-Wl,-install_name,@rpath/ShengyueArchiveGuard.dylib','-o',guard],{stdio:'inherit'});
  execFileSync('/usr/bin/install_name_tool',['-change','@rpath/Electron Framework.framework/Electron Framework','@rpath/ShengyueArchiveGuard.dylib',executable],{stdio:'inherit'});
  return;
 }
 if(context.electronPlatformName!=='win32')return;
 const PE=require('pe-library'),R=require('resedit');
 const file=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.exe');
 const exe=PE.NtExecutable.from(fs.readFileSync(file),{ignoreCert:true}),resources=PE.NtExecutableResource.from(exe);
 const icons=R.Data.IconFile.from(fs.readFileSync(path.join(context.packager.projectDir,'resources/icon.ico')));
 const groups=R.Resource.IconGroupEntry.fromEntries(resources.entries);
 for(const group of groups)R.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icons.icons.map(i=>i.data));
 const versions=R.Resource.VersionInfo.fromEntries(resources.entries),version=context.packager.appInfo.version.split('.').map(Number);
 for(const info of versions){info.setFileVersion(...version,0,1033);info.setProductVersion(...version,0,1033);for(const lang of info.getAllLanguagesForStringValues())info.setStringValues(lang,{FileDescription:'声悦',ProductName:'声悦',CompanyName:'声悦',OriginalFilename:'声悦.exe',InternalName:'Shengyue',LegalCopyright:'Copyright 2026 声悦'});info.outputToResourceEntries(resources.entries);}
 resources.outputResource(exe);const bytes=Buffer.from(exe.generate()),check=PE.NtExecutable.from(bytes);
 const actual=R.Resource.VersionInfo.fromEntries(PE.NtExecutableResource.from(check).entries)[0];
 if(actual.getStringValues({lang:1033,codepage:1200}).ProductName!=='声悦')throw Error('Windows 产品资源校验失败');
 fs.writeFileSync(file,bytes);
};
