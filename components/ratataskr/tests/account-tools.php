<?php
declare(strict_types=1);
require_once __DIR__.'/../plugins/ratataskr-ui/AliasService.php';
$directories = [];
$count = 0;
function check(bool $condition, string $message): void { global $count; if (!$condition) throw new Exception($message); ++$count; }
function rejects(callable $operation, string $message): void {
    try { $operation(); } catch (RatataskrAccountError $error) { check(true, $message); return; }
    throw new Exception('Expected rejection: '.$message);
}
function fixture(array $overrides = []): array {
    global $directories;
    $directory = sys_get_temp_dir().'/ratataskr-test-'.bin2hex(random_bytes(8)); mkdir($directory,0700); $directories[]=$directory;
    $config = array_replace(['enabled'=>true,'domain'=>'example.test','owners'=>['alice@example.test','morgan@example.test'],'administrators'=>['alice@example.test'],'reserved'=>['alice','morgan','sam','postmaster'],'setupUrl'=>'https://mail.example.test/account-setup.php','recipientVerified'=>false,'recipientMode'=>'envelope'], $overrides);
    $provider = (object)['users'=>['alice@example.test','morgan@example.test'],'rules'=>[], 'writes'=>0, 'failAfterWrite'=>false, 'symbolic'=>false, 'created'=>[]];
    $call = function ($action,$request) use ($provider) {
        if ($action==='listDomains') return ['domains'=>[['name'=>'example.test','isShared'=>false,'symbolicSubaddressing'=>$provider->symbolic]]];
        if ($action==='listUser') return ['users'=>$provider->users];
        if ($action==='listRoutingRules') return ['rules'=>$provider->rules];
        if ($action==='createRoutingRule') { $provider->writes++; $provider->rules[]=['id'=>count($provider->rules)+1]+$request; if ($provider->failAfterWrite) throw new RatataskrAccountError('Uncertain network result'); return []; }
        if ($action==='createUser') { $provider->writes++; $provider->users[]=$request['userName'].'@'.$request['domainName']; $provider->created[]=$request; return []; }
        throw new Exception('Unexpected provider operation');
    };
    return [new RatataskrAliasService($config,$directory,$call),$provider,$directory];
}
try {
    [$service,$provider,$directory]=fixture();
    $alias=$service->create('alice@example.test','dev');
    check($alias['receiving']==='active' && $provider->rules[0]['targetAddresses']===['alice@example.test'] && !$provider->rules[0]['prefix'] && !$provider->rules[0]['catchall'],'Exact owner route');
    check(count($service->listing('morgan@example.test')['aliases'])===0,'Cross-user listing isolation');
    rejects(fn()=>$service->create('morgan@example.test','dev'),'Cross-user address claim');
    rejects(fn()=>$service->create('outsider@example.test','steal'),'Unenrolled owner');
    rejects(fn()=>$service->create('alice@example.test','sam'),'Reserved address');
    rejects(fn()=>$service->create('alice@example.test',"bad\naddress"),'Control character');
    $service->create('alice@example.test','dev'); check($provider->writes===1,'Idempotent completed alias');
    $provider->rules[]=['id'=>90,'domainName'=>'example.test','prefix'=>true,'matchUser'=>'work','targetAddresses'=>['morgan@example.test'],'catchall'=>false];
    rejects(fn()=>$service->create('alice@example.test','work-stuff'),'Prefix collision');
    $provider->failAfterWrite=true;
    rejects(fn()=>$service->create('alice@example.test','signup'),'Uncertain write');
    $provider->failAfterWrite=false;
    check($service->create('alice@example.test','signup')['receiving']==='active' && $provider->writes===2,'Reconcile without duplicate write');
    $provider->symbolic=true;
    $provider->users[]='first.last@example.test';
    $provider->users[]='tagged_user@example.test';
    rejects(fn()=>$service->create('alice@example.test','firstlast'),'Normalized mailbox collision');
    rejects(fn()=>$service->create('alice@example.test','tagged'),'Symbolic mailbox collision');
    check($service->create('alice@example.test','symbolic')['receiving']==='active','Plain name with symbolic subaddressing');
    rejects(fn()=>$service->create('alice@example.test','symbolic.tag'),'Dotted symbolic address');
    rejects(fn()=>$service->create('alice@example.test','symbolic_tag'),'Tagged symbolic address');
    rejects(fn()=>$service->create('alice@example.test','symbolic-tag'),'Hyphenated symbolic address');
    $provider->symbolic=false;
    rejects(fn()=>$service->invitation('morgan@example.test','newuser','new@example.com'),'Invitation admin privilege');
    rejects(fn()=>$service->invitation('alice@example.test','newuser','newuser@example.test'),'Independent recovery');
    $invitation=$service->invitation('alice@example.test','newuser','new@example.com'); $token=explode('#',$invitation['url'])[1];
    check(!str_contains(file_get_contents($directory.'/state.json'),$token),'Invitation plaintext not persisted');
    rejects(fn()=>$service->redeem($token,'sixteencharacterpassword','wrong@example.com'),'Invitation identity binding');
    check($service->redeem($token,'sixteencharacterpassword','new@example.com')==='newuser@example.test','Invitation enrollment');
    rejects(fn()=>$service->redeem($token,'sixteencharacterpassword','new@example.com'),'One-time invitation');
    check($service->listing('newuser@example.test')['enabled'],'New owner enrollment');
    check(!str_contains(file_get_contents($directory.'/state.json'),'sixteencharacterpassword'),'Password not persisted');
    $revocable=$service->invitation('alice@example.test','another','another@example.com');
    rejects(fn()=>$service->revoke('morgan@example.test',$revocable['id']),'Revoke admin privilege');
    $service->revoke('alice@example.test',$revocable['id']);
    rejects(fn()=>$service->redeem(explode('#',$revocable['url'])[1],'sixteencharacterpassword','another@example.com'),'Revoked token');
    check($service->invitation('alice@example.test','another','another@example.com')['id']!==$revocable['id'],'Reissue fresh token');
    check($service->invitations('morgan@example.test')===[],'Private invitation list');
    [$uncertain,$up]=fixture(); $up->failAfterWrite=true;
    rejects(fn()=>$uncertain->create('alice@example.test','uncertain'),'Unconfirmed write');
    $up->rules=[]; $up->failAfterWrite=false;
    rejects(fn()=>$uncertain->create('alice@example.test','uncertain'),'No automatic second write');
    check($up->writes===1,'Pending reservation retained');
    [$disabled]=fixture(['enabled'=>false]); rejects(fn()=>$disabled->create('alice@example.test','dev'),'Disabled provider');
    $script=RatataskrAliasService::sieve([['address'=>'dev@example.test','receiving'=>'active','folder'=>'Dev "quoted" \\folder']], 'envelope');
    check(str_contains($script,'Dev \\"quoted\\" \\\\folder'),'Sieve quoting');
    rejects(fn()=>RatataskrAliasService::sieve([['address'=>'dev@example.test','receiving'=>'active','folder'=>"bad\nfolder"]], 'envelope'),'Sieve injection');
    rejects(fn()=>RatataskrAliasService::sieve([], 'header', 'bad:header'),'Header validation');
    [$filters,$p,$d]=fixture(['recipientVerified'=>true]); $filters->create('alice@example.test','dev');
    $server=(object)['scripts'=>['foreign'=>['name'=>'foreign','active'=>true,'body'=>'keep;']], 'puts'=>0];
    $load=fn()=>['Capa'=>['fileinto','envelope'],'Scripts'=>$server->scripts];
    $put=function($name,$body) use($server){$server->puts++; $server->scripts[$name]=['name'=>$name,'active'=>false,'body'=>$body];return true;};
    $activate=function($name)use($server){foreach($server->scripts as &$script)$script['active']=$script['name']===$name;return true;};
    rejects(fn()=>$filters->folder('alice@example.test','dev@example.test','Dev',['INBOX','Dev'],$load,$put,$activate),'Preserve foreign active script');
    check($server->puts===0,'No foreign overwrite');
    $server->scripts=[];
    rejects(fn()=>$filters->folder('morgan@example.test','dev@example.test','Dev',['Dev'],$load,$put,$activate),'Cross-user folder mapping');
    rejects(fn()=>$filters->folder('alice@example.test','dev@example.test','Missing',['Dev'],$load,$put,$activate),'Folder membership');
    $filters->folder('alice@example.test','dev@example.test','Dev',['Dev','INBOX'],$load,$put,$activate);
    check($filters->listing('alice@example.test')['aliases'][0]['filter']==='active','Validated inactive script activation');
    $filters->folder('alice@example.test','dev@example.test','INBOX',['Dev','INBOX'],$load,$put,$activate);
    check(count($server->scripts)===2,'Previous filter retained for rollback');
    foreach($server->scripts as &$script)if($script['active'])$script['body'].='\n# external edit'; unset($script);
    rejects(fn()=>$filters->folder('alice@example.test','dev@example.test','Dev',['Dev'],$load,$put,$activate),'External edit conflict');
    [$recovery,$rp,$rd]=fixture(['readOnly'=>true,'recipientVerified'=>true]);
    rejects(fn()=>$recovery->create('alice@example.test','newalias'),'Recovery alias writes disabled');
    rejects(fn()=>$recovery->invitation('alice@example.test','newuser','new@example.com'),'Recovery invitations disabled');
    rejects(fn()=>$recovery->revoke('alice@example.test','any'),'Recovery revocation disabled');
    rejects(fn()=>$recovery->redeem(str_repeat('a',64),'sixteencharacterpassword','new@example.com'),'Recovery enrollment disabled');
    $externalCalls=0;
    $external=function()use(&$externalCalls){++$externalCalls;return [];};
    rejects(fn()=>$recovery->folder('alice@example.test','dev@example.test','Dev',['Dev'],$external,$external,$external),'Recovery filter writes disabled before contacting Sieve');
    check($rp->writes===0 && $externalCalls===0 && !is_file($rd.'/state.json'),'No recovery side effects');
    check($recovery->listing('morgan@example.test')['aliases']===[],'Recovery listing remains available');
    echo "PASS: $count account-tool assertions. No live provider calls.\n";
} finally {
    foreach($directories as $directory){foreach(glob($directory.'/*') as $file)unlink($file); foreach(glob($directory.'/.*') as $file)if(is_file($file))unlink($file);rmdir($directory);}
}
