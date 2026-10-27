"""Create an Aring Compose account using private terminal input."""
import argparse
import getpass
from pathlib import Path
import subprocess

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('email')
parser.add_argument('display_name')
args=parser.parse_args()
password=getpass.getpass('New password (14–512 characters): ')
if password != getpass.getpass('Repeat password: '):
    parser.error('Passwords differ')
if not 14 <= len(password) <= 512:
    parser.error('Password must have 14–512 characters')
try:
    subprocess.run(['docker','compose','--profile','aring','exec','-T','aring','node',
                    'scripts/account.mjs',args.email,args.display_name], input=password,
                   text=True, encoding='utf-8',check=True,cwd=Path(__file__).resolve().parents[1])
finally:
    password=''
