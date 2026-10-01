//go:build linux

package admin

import (
	"bufio"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

const maxDSMReadBytes = 1024 * 1024

type Reader struct { root string }

func NewReader(root string) *Reader {
	if root == "" { root = "/" }
	return &Reader{root:filepath.Clean(root)}
}

func (r *Reader) p(abs string) string {
	return filepath.Join(r.root, filepath.FromSlash(strings.TrimPrefix(abs,"/")))
}

func (r *Reader) readSmall(abs string) ([]byte,error) {
	f,err:=os.Open(r.p(abs))
	if err!=nil {
		if errors.Is(err,os.ErrNotExist) || errors.Is(err,os.ErrPermission) { return nil,nil }
		return nil,err
	}
	defer f.Close()
	info,err:=f.Stat()
	if err!=nil { return nil,err }
	if !info.Mode().IsRegular() { return nil,nil }
	if info.Size()>maxDSMReadBytes { return nil,nil }
	data,err:=os.ReadFile(r.p(abs))
	if errors.Is(err,os.ErrPermission) || errors.Is(err,os.ErrNotExist) { return nil,nil }
	return data,err
}

func sensitiveKey(key string) bool {
	k:=strings.ToLower(strings.ReplaceAll(key,"-","_"))
	for _,marker:=range []string{"password","passwd","secret","token","credential","private_key","privatekey","api_key","apikey"} {
		if strings.Contains(k,marker) { return true }
	}
	return false
}

func parseKV(data []byte) map[string]string {
	out:=map[string]string{}
	scanner:=bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line:=strings.TrimSpace(scanner.Text())
		if line=="" || strings.HasPrefix(line,"#") { continue }
		key,value,ok:=strings.Cut(line,"=")
		if !ok { continue }
		key=strings.TrimSpace(key)
		if key=="" || sensitiveKey(key) { continue }
		value=strings.TrimSpace(value)
		value=strings.Trim(value,"\"'")
		out[key]=value
	}
	return out
}

func parseUintField(data []byte,key string) uint64 {
	for _,line:=range strings.Split(string(data),"\n") {
		fields:=strings.Fields(line)
		if len(fields)>=2 && strings.TrimSuffix(fields[0],":")==key {
			n,_:=strconv.ParseUint(fields[1],10,64)
			return n
		}
	}
	return 0
}

func (r *Reader) SystemInfo() (SystemInfo,error) {
	var out SystemInfo
	out.Version=map[string]string{}
	if data,err:=r.readSmall("/etc/VERSION"); err!=nil { return out,err } else if data!=nil { out.Version=parseKV(data) }
	if data,err:=r.readSmall("/etc/hostname"); err!=nil { return out,err } else { out.Hostname=strings.TrimSpace(string(data)) }
	if data,err:=r.readSmall("/proc/uptime"); err!=nil { return out,err } else {
		fields:=strings.Fields(string(data)); if len(fields)>0 { out.UptimeSeconds,_=strconv.ParseFloat(fields[0],64) }
	}
	if data,err:=r.readSmall("/proc/loadavg"); err!=nil { return out,err } else {
		fields:=strings.Fields(string(data))
		if len(fields)>=3 { out.Load1,_=strconv.ParseFloat(fields[0],64); out.Load5,_=strconv.ParseFloat(fields[1],64); out.Load15,_=strconv.ParseFloat(fields[2],64) }
	}
	if data,err:=r.readSmall("/proc/meminfo"); err!=nil { return out,err } else {
		out.MemoryTotalKB=parseUintField(data,"MemTotal")
		out.MemoryAvailableKB=parseUintField(data,"MemAvailable")
	}
	return out,nil
}

func (r *Reader) StorageInfo() (StorageInfo,error) {
	out:=StorageInfo{Volumes:[]VolumeInfo{}}
	data,err:=r.readSmall("/proc/mounts")
	if err!=nil { return out,err }
	for _,line:=range strings.Split(string(data),"\n") {
		fields:=strings.Fields(line)
		if len(fields)<3 || !strings.HasPrefix(fields[1],"/volume") { continue }
		volume:=VolumeInfo{Source:fields[0],MountPoint:fields[1],Filesystem:fields[2]}
		var st unix.Statfs_t
		if err:=unix.Statfs(r.p(fields[1]),&st); err==nil {
			bs:=uint64(st.Bsize)
			volume.TotalBytes=uint64(st.Blocks)*bs
			volume.AvailableBytes=uint64(st.Bavail)*bs
		}
		out.Volumes=append(out.Volumes,volume)
	}
	sort.Slice(out.Volumes,func(i,j int)bool{return out.Volumes[i].MountPoint<out.Volumes[j].MountPoint})
	return out,nil
}

func (r *Reader) NetworkInfo() (NetworkInfo,error) {
	out:=NetworkInfo{Interfaces:[]NetworkInterface{}}
	base:=r.p("/sys/class/net")
	entries,err:=os.ReadDir(base)
	if err!=nil {
		if errors.Is(err,os.ErrNotExist)||errors.Is(err,os.ErrPermission){return out,nil}
		return out,err
	}
	for _,entry:=range entries {
		if !entry.IsDir() { continue }
		name:=entry.Name()
		state,_:=os.ReadFile(filepath.Join(base,name,"operstate"))
		address,_:=os.ReadFile(filepath.Join(base,name,"address"))
		out.Interfaces=append(out.Interfaces,NetworkInterface{Name:name,State:strings.TrimSpace(string(state)),Address:strings.TrimSpace(string(address))})
	}
	sort.Slice(out.Interfaces,func(i,j int)bool{return out.Interfaces[i].Name<out.Interfaces[j].Name})
	return out,nil
}

func (r *Reader) PackageStatus() (PackageStatus,error) {
	out:=PackageStatus{Packages:[]PackageInfo{}}
	base:=r.p("/var/packages")
	entries,err:=os.ReadDir(base)
	if err!=nil {
		if errors.Is(err,os.ErrNotExist)||errors.Is(err,os.ErrPermission){return out,nil}
		return out,err
	}
	for _,entry:=range entries {
		if !entry.IsDir() { continue }
		data,err:=os.ReadFile(filepath.Join(base,entry.Name(),"INFO"))
		if err!=nil { continue }
		if len(data)>maxDSMReadBytes { continue }
		kv:=parseKV(data)
		pkg:=PackageInfo{Package:kv["package"],Version:kv["version"],DisplayName:kv["displayname"]}
		if pkg.Package=="" { pkg.Package=entry.Name() }
		out.Packages=append(out.Packages,pkg)
	}
	sort.Slice(out.Packages,func(i,j int)bool{return out.Packages[i].Package<out.Packages[j].Package})
	return out,nil
}

func (r *Reader) UserGroupInfo() (UserGroupInfo,error) {
	out:=UserGroupInfo{Users:[]UserInfo{},Groups:[]GroupInfo{}}
	if data,err:=r.readSmall("/etc/passwd"); err!=nil { return out,err } else {
		for _,line:=range strings.Split(string(data),"\n") {
			if line=="" { continue }
			f:=strings.Split(line,":")
			if len(f)<7 { continue }
			uid,e1:=strconv.Atoi(f[2]); gid,e2:=strconv.Atoi(f[3]); if e1!=nil||e2!=nil { continue }
			out.Users=append(out.Users,UserInfo{Name:f[0],UID:uid,GID:gid,Home:f[5],Shell:f[6]})
		}
	}
	if data,err:=r.readSmall("/etc/group"); err!=nil { return out,err } else {
		for _,line:=range strings.Split(string(data),"\n") {
			if line=="" { continue }
			f:=strings.Split(line,":")
			if len(f)<4 { continue }
			gid,err:=strconv.Atoi(f[2]); if err!=nil { continue }
			members:=[]string{}; if f[3]!="" { members=strings.Split(f[3],",") }
			out.Groups=append(out.Groups,GroupInfo{Name:f[0],GID:gid,Members:members})
		}
	}
	sort.Slice(out.Users,func(i,j int)bool{return out.Users[i].Name<out.Users[j].Name})
	sort.Slice(out.Groups,func(i,j int)bool{return out.Groups[i].Name<out.Groups[j].Name})
	return out,nil
}

func (r *Reader) SharedFolderInfo() (SharedFolderInfo,error) {
	out:=SharedFolderInfo{Shares:[]SharedFolder{}}
	rootEntries,err:=os.ReadDir(r.root)
	if err!=nil { return out,err }
	for _,volume:=range rootEntries {
		if !volume.IsDir() || !isVolumeName(volume.Name()) { continue }
		volumePath:=filepath.Join(r.root,volume.Name())
		children,err:=os.ReadDir(volumePath)
		if err!=nil { continue }
		for _,child:=range children {
			if !child.IsDir() || strings.HasPrefix(child.Name(),"@") { continue }
			out.Shares=append(out.Shares,SharedFolder{Name:child.Name(),Path:"/"+filepath.ToSlash(filepath.Join(volume.Name(),child.Name()))})
		}
	}
	sort.Slice(out.Shares,func(i,j int)bool{return out.Shares[i].Path<out.Shares[j].Path})
	return out,nil
}

func isVolumeName(name string) bool {
	if !strings.HasPrefix(name,"volume") || len(name)<=6 { return false }
	_,err:=strconv.Atoi(name[6:])
	return err==nil
}

func (r *Reader) UpdateInfo() (UpdateInfo,error) {
	out:=UpdateInfo{Current:map[string]string{},Defaults:map[string]string{}}
	if data,err:=r.readSmall("/etc/VERSION"); err!=nil { return out,err } else if data!=nil { out.Current=parseKV(data) }
	if data,err:=r.readSmall("/etc.defaults/VERSION"); err!=nil { return out,err } else if data!=nil { out.Defaults=parseKV(data) }
	return out,nil
}
