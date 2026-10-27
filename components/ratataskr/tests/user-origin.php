<?php
declare(strict_types=1);
namespace RainLoop {
    final class Api {
        public static array $config=['security'=>['allow_admin_panel'=>true]];
        public static function Actions(): void { self::$config['security']['allow_admin_panel']=true; }
        public static function Config(): object { return new class {
            public function Set($section,$key,$value): void { Api::$config[$section][$key]=$value; }
        }; }
    }
    final class Service {
        public static function Handle(): void {
            if (Api::$config['security']['allow_admin_panel'] !== false) throw new \RuntimeException('User-origin admin policy missing');
        }
    }
}
namespace {
    define('RATATASKR_USER_ENTRY_TEST',true);
    require __DIR__.'/../server/user-entry.php';
    $directory=sys_get_temp_dir().'/ratataskr-origin-'.bin2hex(random_bytes(8));mkdir($directory,0700);
    file_put_contents($directory.'/index.php','<?php if (empty($_ENV["SNAPPYMAIL_INCLUDE_AS_API"])) throw new RuntimeException("Expected deferred service startup");');
    try {
        foreach (['admin','admin/0/Json/','admin/&q[]=0&q[]=Json','custom-admin/0/Json/','%61dmin/0/Json/',''] as $query) {
            $_SERVER['QUERY_STRING']=$query;
            ratataskrUserEndpoint($directory);
        }
        echo "PASS: 6 user-origin policy checks; administrator disabled before dispatch, including custom/encoded routes.\n";
    } finally {unlink($directory.'/index.php');rmdir($directory);}
}
