<?php
declare(strict_types=1);
require_once __DIR__.'/../plugins/ratataskr-ui/AliasService.php';
$count=0;
$check=static function(bool $condition) use (&$count): void {
    if (!$condition) throw new RuntimeException('Security boundary check failed');
    ++$count;
};
$reject=static function(string $body,int $status) use ($check): void {
    try { RatataskrAliasService::providerResult($body,$status); }
    catch (RatataskrAccountError $error) {
        $check(!str_contains($error->getMessage(),'synthetic-private-marker'));
        return;
    }
    throw new RuntimeException('Expected provider response rejection');
};
$check(RatataskrAliasService::providerResult('{"result":{"users":[]}}',200)===['users'=>[]]);
foreach ([['synthetic-private-marker',503],['not-json synthetic-private-marker',200],
          ['{"error":"synthetic-private-marker"}',200],['[]',200],
          [str_repeat('x',1024*1024+1),200],['{"result":'.str_repeat('[',65).'0'.str_repeat(']',65).'}',200]] as [$body,$status]) $reject($body,$status);
$directory=sys_get_temp_dir().'/ratataskr-security-'.bin2hex(random_bytes(8));
mkdir($directory,0700);
try {
    $lock=fopen($directory.'/state.lock','c');
    if (!flock($lock,LOCK_EX|LOCK_NB)) throw new RuntimeException('Fixture lock unavailable');
    $service=new RatataskrAliasService(['owners'=>['alice@example.test']],$directory);
    try { $service->listing('alice@example.test');throw new RuntimeException('Lock contention must fail promptly'); }
    catch(RatataskrAccountError $error){$check(str_contains($error->getMessage(),'busy'));}
    flock($lock,LOCK_UN);fclose($lock);
    file_put_contents($directory.'/state.json',str_repeat(' ',4*1024*1024+1));
    try { $service->listing('alice@example.test');throw new RuntimeException('Oversized state must fail closed'); }
    catch(RatataskrAccountError $error){$check(str_contains($error->getMessage(),'review'));}
} finally {
    foreach(glob($directory.'/*') as $file)unlink($file);
    rmdir($directory);
}
echo "PASS: $count additional security-boundary assertions; no network calls.\n";
