<?php
namespace RainLoop\Plugins { class AbstractPlugin { public $manager; public function Manager() { return $this->manager; } } }
namespace {
require __DIR__.'/../plugins/ratataskr-ui/index.php';
$folder = new class { public $FullName = 'dev'; public function Selectable() { return true; } };
$actions = new class($folder) {
    public $folder; public $parent = ''; public $fail = false;
    public function __construct($folder) { $this->folder = $folder; }
    public function GetActionParam($key, $default) { return $key === 'folder' ? 'dev' : $this->parent; }
    public function ImapClient() { return $this; }
    public function FolderHierarchyDelimiter($parent) { return '/'; }
    public function MailClient() { return $this; }
    public function Folders(...$args) { if ($this->fail) throw new \RuntimeException(); return [$this->folder]; }
    public function DefaultResponse($folder) { return ['Result'=>['fullName'=>$folder->FullName]]; }
};
$plugin = new \RatataskrUiPlugin();
$plugin->manager = new class($actions) { public $actions; public function __construct($a) { $this->actions=$a; } public function Actions() { return $this->actions; } };
$check = function($condition) { if (!$condition) throw new \RuntimeException('Folder response test failed'); };
$response = ['Result'=>null]; $plugin->RecoverCreatedFolder($response); $check($response['Result']['fullName']==='dev');
$actions->parent='INBOX'; $folder->FullName='INBOX/dev';
$response = ['Result'=>null]; $plugin->RecoverCreatedFolder($response); $check($response['Result']['fullName']==='INBOX/dev');
$folder->FullName='other/dev'; $response=['Result'=>null]; $plugin->RecoverCreatedFolder($response); $check($response['Result']===null);
$response=['Result'=>false]; $plugin->RecoverCreatedFolder($response); $check($response['Result']===false);
$response=['Result'=>['existing'=>true]]; $plugin->RecoverCreatedFolder($response); $check($response['Result']===['existing'=>true]);
$actions->fail=true; $response=['Result'=>null]; $plugin->RecoverCreatedFolder($response); $check($response['Result']===null);
echo "6 folder response checks passed\n";
}
