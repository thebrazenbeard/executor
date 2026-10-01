package admin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func put(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(rel,"/")))
	if err := os.MkdirAll(filepath.Dir(full),0700); err != nil { t.Fatal(err) }
	if err := os.WriteFile(full,[]byte(content),0600); err != nil { t.Fatal(err) }
}

func TestDSMReadAdaptersFromFixtureTree(t *testing.T) {
	root := t.TempDir()
	put(t,root,"/etc/VERSION","majorversion=\"7\"\nminorversion=\"2\"\nbuildnumber=\"72806\"\nproductversion=\"7.2.2\"\n")
	put(t,root,"/etc.defaults/VERSION","productversion=\"7.2.2\"\n")
	put(t,root,"/etc/hostname","DS216\n")
	put(t,root,"/proc/uptime","12345.67 100.00\n")
	put(t,root,"/proc/loadavg","0.10 0.20 0.30 1/100 123\n")
	put(t,root,"/proc/meminfo","MemTotal:         524288 kB\nMemAvailable:     262144 kB\n")
	put(t,root,"/proc/mounts","/dev/md2 /volume1 ext4 rw,relatime 0 0\nproc /proc proc rw 0 0\n")
	put(t,root,"/sys/class/net/eth0/operstate","up\n")
	put(t,root,"/sys/class/net/eth0/address","00:11:22:33:44:55\n")
	put(t,root,"/var/packages/Plex/INFO","package=\"PlexMediaServer\"\nversion=\"1.2.3\"\ndisplayname=\"Plex\"\npassword=\"DO-NOT-LEAK\"\ntoken=\"DO-NOT-LEAK-EITHER\"\n")
	put(t,root,"/etc/passwd","root:x:0:0:root:/root:/bin/ash\npatrick:x:1026:100:Patrick:/var/services/homes/patrick:/bin/sh\n")
	put(t,root,"/etc/group","administrators:x:101:patrick\nusers:x:100:patrick\n")
	if err := os.MkdirAll(filepath.Join(root,"volume1","media"),0700); err != nil { t.Fatal(err) }
	if err := os.MkdirAll(filepath.Join(root,"volume1","@appstore"),0700); err != nil { t.Fatal(err) }

	r := NewReader(root)

	system, err := r.SystemInfo()
	if err != nil { t.Fatal(err) }
	if system.Hostname!="DS216" || system.Version["productversion"]!="7.2.2" || system.MemoryTotalKB!=524288 {
		t.Fatalf("system=%+v",system)
	}

	storage, err := r.StorageInfo()
	if err != nil { t.Fatal(err) }
	if len(storage.Volumes)!=1 || storage.Volumes[0].MountPoint!="/volume1" { t.Fatalf("storage=%+v",storage) }

	network, err := r.NetworkInfo()
	if err != nil { t.Fatal(err) }
	if len(network.Interfaces)!=1 || network.Interfaces[0].Name!="eth0" || network.Interfaces[0].State!="up" { t.Fatalf("network=%+v",network) }

	packages, err := r.PackageStatus()
	if err != nil { t.Fatal(err) }
	if len(packages.Packages)!=1 || packages.Packages[0].Package!="PlexMediaServer" { t.Fatalf("packages=%+v",packages) }

	users, err := r.UserGroupInfo()
	if err != nil { t.Fatal(err) }
	if len(users.Users)!=2 || len(users.Groups)!=2 { t.Fatalf("users=%+v",users) }

	shares, err := r.SharedFolderInfo()
	if err != nil { t.Fatal(err) }
	if len(shares.Shares)!=1 || shares.Shares[0].Path!="/volume1/media" { t.Fatalf("shares=%+v",shares) }

	update, err := r.UpdateInfo()
	if err != nil { t.Fatal(err) }
	if update.Current["productversion"]!="7.2.2" { t.Fatalf("update=%+v",update) }
}

func TestAdminOutputsDoNotExposeSecretFieldsOrPasswordColumns(t *testing.T) {
	root := t.TempDir()
	put(t,root,"/etc/VERSION","productversion=\"7.2.2\"\nprivate_key=\"KEY-MATERIAL\"\ncredential=\"CREDS\"\n")
	put(t,root,"/var/packages/Test/INFO","package=\"Test\"\nversion=\"1\"\nsecret=\"LEAK\"\napi_token=\"TOKEN\"\npassword=\"PASSWORD\"\n")
	put(t,root,"/etc/passwd","user:HASH-MUST-NOT-LEAK:1000:100:User:/home/user:/bin/sh\n")
	put(t,root,"/etc/group","users:GROUP-HASH-MUST-NOT-LEAK:100:user\n")

	r:=NewReader(root)
	values:=[]any{}
	if v,err:=r.SystemInfo(); err==nil { values=append(values,v) } else { t.Fatal(err) }
	if v,err:=r.PackageStatus(); err==nil { values=append(values,v) } else { t.Fatal(err) }
	if v,err:=r.UserGroupInfo(); err==nil { values=append(values,v) } else { t.Fatal(err) }
	raw,_:=json.Marshal(values)
	text:=string(raw)
	for _, forbidden:=range []string{"KEY-MATERIAL","CREDS","LEAK","TOKEN","PASSWORD","HASH-MUST-NOT-LEAK","GROUP-HASH-MUST-NOT-LEAK","private_key","credential","api_token"} {
		if strings.Contains(text,forbidden) { t.Fatalf("admin output leaked %q: %s",forbidden,text) }
	}
}

func TestMissingOrDeniedDSMSourceDegradesWithoutReaderFailure(t *testing.T) {
	r:=NewReader(t.TempDir())
	system,err:=r.SystemInfo()
	if err!=nil { t.Fatal(err) }
	if system.Hostname!="" { t.Fatalf("unexpected hostname: %+v",system) }
	packages,err:=r.PackageStatus()
	if err!=nil { t.Fatal(err) }
	if len(packages.Packages)!=0 { t.Fatalf("packages=%+v",packages) }
}
