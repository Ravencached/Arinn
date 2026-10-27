# YggDrive / YggShare

For the recommended two-computer arrangement, use the
[storage role](../../docs/TWO-HOST-QUICKSTART.md#3-configure-and-start-storage).
It runs on the computer with the drive space, binding an explicit existing
local content directory. Home records only its HTTPS address. No network share
or file relay through home is required. The instructions below are alternatives.

The suite's default `yggdrive` profile uses upstream SFTPGo with independent
private user homes and separate loopback-published client/admin ports. Generate
configuration using the root `scripts/configure.py`, then follow the
[install spec](../../docs/INSTALL.md) for first admin/user setup, quotas and MFA.

`windows/` contains optional Windows invitation/recovery sources and disposable
integration tests. It is not included in the Linux container profile. The
helper requires explicit paths and an independent restricted service identity;
quota removal, recovery hooks and monitoring are opt-in.

`prototype/` is a static UI design with synthetic sample data. It has no real
authentication, upload storage or connection to the file service.
